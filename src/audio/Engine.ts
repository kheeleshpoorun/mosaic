import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import type { SongSource, StemSource } from '../lib/types';
import { Metronome, firstBeatAtOrAfter, type MetronomeSettings } from './metronome';

/** Slider position that equals unity gain (Moises shows the thumb at ~75% by default). */
export const DEFAULT_VOLUME = 0.75;
const TICK_MS = 25;
/** Sources are scheduled this far in the future so every stem starts on the same audio frame. */
const START_DELAY = 0.05;
/** Stems decoded in parallel (bounds peak memory: compressed + decoded data). */
const DECODE_CONCURRENCY = 2;

export interface StemState {
  name: string;
  volume: number; // slider position 0..1
  muted: boolean;
}

/** Where each stem is in the load pipeline (drives the loading modal). */
export type StemLoadPhase = 'queued' | 'fetching' | 'decoding' | 'done';

export interface EngineState {
  status: 'loading' | 'ready' | 'error';
  loaded: number; // stems decoded
  loadPhases: StemLoadPhase[]; // per stem, same order as `stems`
  error?: string;
  playing: boolean;
  duration: number;
  stems: StemState[];
  speed: number; // 0.5 .. 1.5
  pitch: number; // semitones -12 .. 12
  metronome: MetronomeSettings & { detecting: boolean };
}

interface Track {
  buffer: AudioBuffer | null;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

/** Converts a slider position to a gain value (DEFAULT_VOLUME = unity, max ≈ +5 dB). */
export function sliderToGain(v: number): number {
  return Math.pow(v / DEFAULT_VOLUME, 2);
}

/**
 * Sample-accurate multitrack player. Every stem is decoded to an AudioBuffer and all
 * AudioBufferSourceNodes are started with the same `when` on the AudioContext clock, so stems
 * can't drift apart. Graph: source → gain → master → limiter → [SoundTouch] → destination.
 */
export class Engine {
  readonly ctx: AudioContext;
  private tracks: Track[];
  private master: GainNode;
  private limiter: DynamicsCompressorNode;
  private pitchNode: SoundTouchNode | null = null;
  private pitchReady: Promise<void>;
  private metronome: Metronome;
  private timer: number | undefined;
  private listeners = new Set<() => void>();
  private disposed = false;
  /** Playback anchor: track time `anchorOffset` plays at AudioContext time `anchorTime`. */
  private anchorTime = 0;
  private anchorOffset = 0;
  /** Paused position. */
  private offset = 0;
  state: EngineState;

  constructor(song: SongSource) {
    this.ctx = createContext();
    this.master = this.ctx.createGain();
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    this.metronome = new Metronome(this.ctx);

    this.tracks = song.stems.map(() => {
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      return { buffer: null, gain, source: null };
    });

    this.state = {
      status: 'loading',
      loaded: 0,
      loadPhases: song.stems.map(() => 'queued'),
      playing: false,
      duration: 0,
      stems: song.stems.map((s) => ({ name: s.name, volume: DEFAULT_VOLUME, muted: false })),
      speed: 1,
      pitch: 0,
      metronome: {
        enabled: false,
        bpm: song.bpm ?? 120,
        offset: song.offset ?? 0,
        volume: 0.7,
        beats: null,
        downbeat: 0,
        detecting: false,
      },
    };

    this.pitchReady = SoundTouchNode.register(this.ctx, processorUrl)
      .then(() => {
        this.pitchNode = new SoundTouchNode({ context: this.ctx });
      })
      .catch((e) => {
        if (!this.disposed) console.warn('Pitch shifting unavailable', e);
      });

    void this.load(song);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  // ---------- store ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  // ---------- loading ----------
  private async load(song: SongSource) {
    let next = 0;
    let loaded = 0;
    const worker = async () => {
      while (next < song.stems.length && !this.disposed) {
        const i = next++;
        const stem = song.stems[i];
        try {
          this.setLoadPhase(i, 'fetching');
          const data = await readStem(stem);
          if (this.disposed) return;
          this.setLoadPhase(i, 'decoding');
          this.tracks[i].buffer = await this.ctx.decodeAudioData(data);
        } catch {
          throw new Error(`Could not load "${stem.name}"`);
        }
        loaded += 1;
        if (!this.disposed) this.set({ loaded });
        this.setLoadPhase(i, 'done');
      }
    };
    try {
      await Promise.all(Array.from({ length: DECODE_CONCURRENCY }, worker));
      if (this.disposed) return;
      const duration = Math.max(...this.tracks.map((t) => t.buffer?.duration ?? 0));
      this.applyGains();
      this.set({ status: 'ready', duration });
    } catch (e) {
      if (!this.disposed) this.set({ status: 'error', error: (e as Error).message });
    }
  }

  private setLoadPhase(i: number, phase: StemLoadPhase) {
    if (this.disposed) return;
    this.set({ loadPhases: this.state.loadPhases.map((p, j) => (j === i ? phase : p)) });
  }

  // ---------- transport ----------
  get position(): number {
    if (!this.state.playing) return this.offset;
    const elapsed = Math.max(0, this.ctx.currentTime - this.anchorTime) * this.state.speed;
    return Math.min(this.anchorOffset + elapsed, this.state.duration);
  }

  /** AudioContext time at which track time `t` is heard (valid while playing). */
  private toCtxTime = (t: number) => this.anchorTime + (t - this.anchorOffset) / this.state.speed;

  async play() {
    if (this.state.status !== 'ready' || this.state.playing) return;
    await this.ctx.resume();
    if (this.offset >= this.state.duration - 0.05) this.offset = 0;
    this.startSources(this.offset);
    this.set({ playing: true });
    this.startMetronome();
  }

  pause() {
    if (!this.state.playing) return;
    this.offset = this.position;
    this.stopSources();
    this.metronome.stop();
    this.set({ playing: false });
  }

  toggle() {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  seek(time: number) {
    const t = Math.max(0, Math.min(time, this.state.duration - 0.01));
    this.offset = t;
    if (this.state.playing) {
      this.startSources(t);
      this.startMetronome();
    }
    this.listeners.forEach((fn) => fn());
  }

  skip(delta: number) {
    this.seek(this.position + delta);
  }

  /** (Re)creates every source and starts them all on the same audio frame at track time `offset`. */
  private startSources(offset: number) {
    this.stopSources();
    const when = this.ctx.currentTime + START_DELAY;
    for (const track of this.tracks) {
      if (!track.buffer || offset >= track.buffer.duration) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = track.buffer;
      source.playbackRate.value = this.state.speed;
      source.connect(track.gain);
      source.start(when, offset);
      track.source = source;
    }
    this.anchorTime = when;
    this.anchorOffset = offset;
  }

  private stopSources() {
    for (const track of this.tracks) {
      if (!track.source) continue;
      try {
        track.source.stop();
      } catch {
        // already stopped
      }
      track.source.disconnect();
      track.source = null;
    }
  }

  private tick() {
    if (!this.state.playing) return;
    if (this.position >= this.state.duration) {
      this.stopSources();
      this.metronome.stop();
      this.offset = this.state.duration;
      this.set({ playing: false });
      return;
    }
    this.metronome.schedule(this.toCtxTime, this.state.duration);
  }

  /** Test/debug hook: per-stem start offsets and the shared start time. */
  syncReport() {
    return {
      anchorTime: this.anchorTime,
      anchorOffset: this.anchorOffset,
      sources: this.tracks.map((t) => (t.source ? { rate: t.source.playbackRate.value } : null)),
    };
  }

  // ---------- mixer ----------
  setVolume(i: number, volume: number) {
    this.updateStem(i, { volume, muted: false });
  }
  toggleMute(i: number) {
    this.updateStem(i, { muted: !this.state.stems[i].muted });
  }
  /**
   * Solo is a shortcut over mute: it mutes every other stem and unmutes this one.
   * If this stem is already the only one playing, it unmutes everything instead.
   */
  toggleSolo(i: number) {
    const unmuteAll = Engine.isSolo(this.state.stems, i);
    this.set({ stems: this.state.stems.map((s, j) => ({ ...s, muted: !unmuteAll && j !== i })) });
    this.applyGains();
  }
  resetStem(i: number) {
    this.updateStem(i, { volume: DEFAULT_VOLUME, muted: false });
  }
  /** Restore every stem to default volume and unmuted. */
  resetMix() {
    this.set({ stems: this.state.stems.map((s) => ({ ...s, volume: DEFAULT_VOLUME, muted: false })) });
    this.applyGains();
  }

  private updateStem(i: number, patch: Partial<StemState>) {
    this.set({ stems: this.state.stems.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
    this.applyGains();
  }

  static audible(stems: StemState[], i: number): boolean {
    return !stems[i].muted;
  }

  /** True when stem `i` is the only unmuted stem. */
  static isSolo(stems: StemState[], i: number): boolean {
    return stems.every((s, j) => s.muted === (j !== i));
  }

  private applyGains() {
    const now = this.ctx.currentTime;
    this.state.stems.forEach((s, i) => {
      const gain = Engine.audible(this.state.stems, i) ? sliderToGain(s.volume) : 0;
      this.tracks[i].gain.gain.setTargetAtTime(gain, now, 0.015);
    });
  }

  // ---------- speed & pitch ----------
  /**
   * Speed is applied as playbackRate on every source (same audio frame → stays in sync).
   * SoundTouch is told the rate and compensates the pitch shift, then applies transposition.
   */
  setSpeed(speed: number) {
    const s = Math.round(Math.max(0.5, Math.min(1.5, speed)) * 100) / 100;
    if (this.state.playing) {
      // Re-anchor so position stays continuous across the rate change.
      const now = this.ctx.currentTime;
      this.anchorOffset = this.position;
      this.anchorTime = Math.max(now, this.anchorTime);
      for (const t of this.tracks) t.source?.playbackRate.setValueAtTime(s, this.anchorTime);
    }
    this.set({ speed: s });
    void this.updatePitchNode();
    if (this.state.playing) this.startMetronome();
  }

  setPitch(semitones: number) {
    const p = Math.max(-12, Math.min(12, Math.round(semitones)));
    this.set({ pitch: p });
    void this.updatePitchNode();
  }

  private async updatePitchNode() {
    await this.pitchReady;
    const node = this.pitchNode;
    if (!node || this.disposed) return;
    const { speed, pitch } = this.state;
    node.playbackRate.value = speed;
    node.pitchSemitones.value = pitch;
    // Bypass SoundTouch when it has nothing to do, for the cleanest sound.
    this.limiter.disconnect();
    node.disconnect();
    if (speed === 1 && pitch === 0) this.limiter.connect(this.ctx.destination);
    else {
      this.limiter.connect(node);
      node.connect(this.ctx.destination);
    }
  }

  // ---------- metronome ----------
  setMetronome(patch: Partial<EngineState['metronome']>) {
    const m = { ...this.state.metronome, ...patch };
    this.set({ metronome: m });
    this.metronome.configure(m);
    if (this.state.playing) this.startMetronome();
  }

  private startMetronome() {
    this.metronome.configure(this.state.metronome);
    if (this.state.playing) this.metronome.reset(this.position);
  }

  /** Track time of the click nearest to `t` (tracked beats or fixed grid, offset applied). */
  private nearestClick(t: number): number {
    const { beats, offset, bpm } = this.state.metronome;
    if (beats?.length) {
      const i = firstBeatAtOrAfter(beats, t - offset);
      const candidates = [beats[i - 1], beats[i]].filter((b) => b !== undefined).map((b) => b + offset);
      return candidates.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
    }
    const period = 60 / bpm;
    return offset + Math.round((t - offset) / period) * period;
  }

  /** "Beat is here": shift the clicks so the nearest one lands on the current position. */
  alignBeatHere() {
    const pos = this.position;
    this.setMetronome({ offset: this.state.metronome.offset + (pos - this.nearestClick(pos)) });
  }

  /** Nudge every click earlier/later by `delta` seconds. */
  nudgeMetronome(delta: number) {
    this.setMetronome({ offset: this.state.metronome.offset + delta });
  }

  /**
   * Manually set a tempo. Switches from tracked beats to a fixed grid that stays locked to the
   * click nearest the current position, so the change doesn't jump the phase.
   */
  setTempo(bpm: number) {
    const b = Math.max(30, Math.min(300, Math.round(bpm * 10) / 10));
    const anchor = this.nearestClick(this.position);
    const period = 60 / b;
    this.setMetronome({ bpm: b, beats: null, offset: ((anchor % period) + period) % period });
  }

  /** Decoded audio used for BPM detection: the drums if present, else the first stem. */
  tempoBuffer(): AudioBuffer | null {
    const idx = this.state.stems.findIndex((s) => /drum|perc|beat/i.test(s.name));
    return this.tracks[idx >= 0 ? idx : 0]?.buffer ?? null;
  }

  dispose() {
    this.disposed = true;
    window.clearInterval(this.timer);
    this.metronome.stop();
    this.stopSources();
    this.tracks.forEach((t) => (t.buffer = null));
    void this.ctx.close();
    this.listeners.clear();
  }
}

function createContext(): AudioContext {
  // 44.1 kHz matches typical stem exports, so decoded buffers aren't upsampled (less memory).
  try {
    return new AudioContext({ latencyHint: 'playback', sampleRate: 44100 });
  } catch {
    return new AudioContext({ latencyHint: 'playback' });
  }
}

async function readStem(stem: StemSource): Promise<ArrayBuffer> {
  if (stem.file) return stem.file.arrayBuffer();
  const res = await fetch(stem.url!);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}
