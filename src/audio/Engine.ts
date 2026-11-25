import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import { readCachedStem, type ByteProgress } from '../lib/stemCache';
import type { SongSource, StemSource } from '../lib/types';
import type { ChordBuffers } from './chordDetect';
import { Metronome, firstBeatAtOrAfter, type MetronomeSettings } from './metronome';
import { enterPlaybackSession, leavePlaybackSession } from './audioSession';
import { computePeaks } from './peaks';
import { FALLBACK_PITCH_DELAY, measurePitchDelay } from './pitchDelay';

/** Slider position that equals unity gain (Moises shows the thumb at ~75% by default). */
export const DEFAULT_VOLUME = 0.75;
/** Bass stem gain multiplier when Bass boost is active on BassPage (~+4.9 dB). */
export const BASS_BOOST_GAIN = 1.75;
/** Backing-band gain multiplier while Bass boost is active and bass is unmuted (~-2.9 dB). */
export const BASS_BOOST_BAND_GAIN = 0.72;
/** Minimum A-B loop span in seconds. */
export const MIN_LOOP_DURATION = 0.25;
const TICK_MS = 25;
/** Sources are scheduled this far in the future so every stem starts on the same audio frame. */
const START_DELAY = 0.05;
/** Stems decoded in parallel (bounds peak memory: decoded data). Fetching isn't limited. */
const DECODE_CONCURRENCY = 2;
/** Byte progress reaches the store at most this often while stems download. */
const BYTES_REPORT_MS = 100;

export interface LoopState {
  start: number | null;
  end: number | null;
  enabled: boolean;
}

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
  /** Bytes of the stems read so far / in all (total grows as each stem's size becomes known). */
  bytesLoaded: number;
  bytesTotal: number;
  error?: string;
  playing: boolean;
  duration: number;
  stems: StemState[];
  speed: number; // 0.5 .. 1.5
  pitch: number; // semitones -12 .. 12
  bassBoost: boolean;
  loop: LoopState;
  metronome: MetronomeSettings & { detecting: boolean };
}

interface Track {
  buffer: AudioBuffer | null;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  /** Waveform overview (see computePeaks), filled in right after decoding. */
  peaks: Float32Array | null;
}

/** Converts a slider position to a gain value (DEFAULT_VOLUME = unity, max ≈ +5 dB). */
export function sliderToGain(v: number): number {
  return Math.pow(v / DEFAULT_VOLUME, 2);
}

/**
 * Sample-accurate multitrack player. Every stem is decoded to an AudioBuffer and all
 * AudioBufferSourceNodes are started with the same `when` on the AudioContext clock, so stems
 * can't drift apart. Graph: source → gain → master → limiter → [SoundTouch] → output → destination;
 * the metronome joins at `output`.
 */
export class Engine {
  readonly ctx: AudioContext;
  private tracks: Track[];
  private master: GainNode;
  private limiter: DynamicsCompressorNode;
  /** Final limiter on music + metronome. A loud click briefly ducks the mix instead of clipping. */
  private output: DynamicsCompressorNode;
  /** SoundTouch node while engaged (speed ≠ 1 or pitch ≠ 0), else null (bypassed). */
  private pitchNode: SoundTouchNode | null = null;
  private pitchReady: Promise<boolean>;
  /** How late the music is heard because of SoundTouch (context seconds); 0 when bypassed. */
  private musicDelay = 0;
  private metronome: Metronome;
  private timer: number | undefined;
  private listeners = new Set<() => void>();
  private disposed = false;
  /** Cancels stem downloads when the player closes. */
  private abort = new AbortController();
  /** Playback anchor: track time `anchorOffset` plays at AudioContext time `anchorTime`. */
  private anchorTime = 0;
  private anchorOffset = 0;
  /** Paused position. */
  private offset = 0;
  /** Unwrapped track time where the current playback pass started (preserved across setSpeed). */
  private startOffset = 0;
  /** True while the active AudioBufferSourceNodes use native source.loop = true. */
  private loopingPass = false;
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
    this.output = this.ctx.createDynamicsCompressor();
    this.output.threshold.value = -1;
    this.output.knee.value = 0;
    this.output.ratio.value = 20;
    this.output.attack.value = 0.001;
    this.output.release.value = 0.05;
    this.output.connect(this.ctx.destination);
    this.master.connect(this.limiter);
    this.limiter.connect(this.output);
    this.metronome = new Metronome(this.ctx, this.output);

    this.tracks = song.stems.map(() => {
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      return { buffer: null, gain, source: null, peaks: null };
    });

    this.state = {
      status: 'loading',
      loaded: 0,
      loadPhases: song.stems.map(() => 'queued'),
      bytesLoaded: 0,
      bytesTotal: 0,
      playing: false,
      duration: 0,
      stems: song.stems.map((s) => ({ name: s.name, volume: DEFAULT_VOLUME, muted: false })),
      speed: 1,
      pitch: 0,
      bassBoost: false,
      loop: { start: null, end: null, enabled: false },
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
      .then(() => true)
      .catch((e) => {
        if (!this.disposed) console.warn('Pitch shifting unavailable', e);
        return false;
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
    // Every stem downloads at once (a slow network is the bottleneck, and saved stems are instant);
    // only decoding is limited, to cap memory.
    const bytes = song.stems.map(() => ({ loaded: 0, total: 0 }));
    let reported = 0;
    const report = (force = false) => {
      const now = performance.now();
      if (this.disposed || (!force && now - reported < BYTES_REPORT_MS)) return;
      reported = now;
      this.set({ bytesLoaded: bytes.reduce((a, b) => a + b.loaded, 0), bytesTotal: bytes.reduce((a, b) => a + b.total, 0) });
    };
    this.set({ loadPhases: song.stems.map(() => 'fetching') });
    const reads = song.stems.map((stem, i) =>
      readStem(
        stem,
        (loaded, total) => {
          bytes[i] = { loaded, total };
          report();
        },
        this.abort.signal,
      ).finally(() => report(true)),
    );
    reads.forEach((r) => r.catch(() => undefined)); // failures surface when the decoder awaits them

    let next = 0;
    let loaded = 0;
    const worker = async () => {
      while (next < song.stems.length && !this.disposed) {
        const i = next++;
        const stem = song.stems[i];
        try {
          const data = await reads[i];
          if (this.disposed) return;
          this.setLoadPhase(i, 'decoding');
          const buffer = await this.ctx.decodeAudioData(data);
          this.tracks[i].buffer = buffer;
          this.tracks[i].peaks = computePeaks(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)));
        } catch {
          throw new Error(navigator.onLine ? `Could not load "${stem.name}"` : "You're offline and this song isn't saved on this device yet");
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
  private activeLoop(): { start: number; end: number } | null {
    const { start, end, enabled } = this.state.loop;
    if (!enabled || start === null || end === null || end - start < MIN_LOOP_DURATION) return null;
    return { start, end };
  }

  private minBufferDuration(): number {
    let min = Infinity;
    for (const t of this.tracks) {
      if (t.buffer) min = Math.min(min, t.buffer.duration);
    }
    return min === Infinity ? 0 : min;
  }

  private canNativeLoop(end: number): boolean {
    return this.tracks.some((t) => !!t.buffer) && this.minBufferDuration() >= end - 0.005;
  }

  private get rawPosition(): number {
    if (!this.state.playing) return this.offset;
    const elapsed = Math.max(0, this.ctx.currentTime - this.anchorTime) * this.state.speed;
    return this.anchorOffset + elapsed;
  }

  private wrapRaw(raw: number): { pos: number; cycle: number } {
    const loop = this.loopingPass ? this.activeLoop() : null;
    if (loop && raw >= loop.end) {
      const len = loop.end - loop.start;
      const cycle = Math.floor((raw - loop.start) / len);
      return { pos: loop.start + (raw - loop.start - cycle * len), cycle };
    }
    return { pos: Math.max(0, Math.min(raw, this.state.duration)), cycle: 0 };
  }

  get position(): number {
    return this.state.playing ? this.wrapRaw(this.rawPosition).pos : this.offset;
  }

  /** AudioContext time at which unwrapped track time `t` leaves the sources (valid while playing). */
  private toCtxTime = (t: number) => this.anchorTime + (t - this.anchorOffset) / this.state.speed;

  /** AudioContext time at which unwrapped track time `t` is heard, after SoundTouch's processing delay. */
  private toHeardTime = (t: number) => this.toCtxTime(t) + this.musicDelay;

  /** Track time and loop cycle currently coming out of the speakers (lags `position` while SoundTouch is engaged). */
  private get heardState(): { pos: number; cycle: number } {
    if (!this.state.playing) return { pos: this.offset, cycle: 0 };
    const rawHeard = Math.max(this.startOffset, this.rawPosition - this.musicDelay * this.state.speed);
    return this.wrapRaw(rawHeard);
  }

  private get heardPosition(): number {
    return this.heardState.pos;
  }

  async play() {
    if (this.state.status !== 'ready' || this.state.playing) return;
    // Before the first await, so it still runs inside the tap (iOS silent switch).
    enterPlaybackSession();
    await this.ctx.resume();
    const loop = this.activeLoop();
    if (loop && this.offset >= loop.end - 0.02) this.offset = loop.start;
    else if (this.offset >= this.state.duration - 0.05) this.offset = 0;
    this.startSources(this.offset);
    this.set({ playing: true });
    this.startMetronome();
  }

  pause() {
    if (!this.state.playing) return;
    this.offset = this.position;
    this.loopingPass = false;
    this.stopSources();
    this.metronome.stop();
    leavePlaybackSession();
    this.set({ playing: false });
  }

  toggle() {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  replay() {
    if (this.state.status !== 'ready') return;
    this.offset = 0;
    if (this.state.playing) {
      this.startSources(0);
      this.startMetronome();
      this.listeners.forEach((fn) => fn());
    } else {
      this.listeners.forEach((fn) => fn());
      void this.play();
    }
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
    // SoundTouch keeps whatever it had buffered (e.g. from before a pause or seek) and would play
    // it first, pushing the music further behind the metronome. Start from an empty pipeline.
    if (this.pitchNode) this.connectPitchNode();
    const loop = this.activeLoop();
    const minDur = this.minBufferDuration();
    const nativeEnd = loop ? Math.min(loop.end, minDur) : 0;
    const useNative = !!loop && offset < loop.end && this.canNativeLoop(loop.end) && nativeEnd - loop.start >= MIN_LOOP_DURATION;
    const when = this.ctx.currentTime + START_DELAY;
    for (const track of this.tracks) {
      if (!track.buffer || offset >= track.buffer.duration) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = track.buffer;
      source.playbackRate.value = this.state.speed;
      if (useNative) {
        source.loop = true;
        source.loopStart = loop.start;
        source.loopEnd = nativeEnd;
      }
      source.connect(track.gain);
      source.start(when, offset);
      track.source = source;
    }
    this.anchorTime = when;
    this.anchorOffset = offset;
    this.startOffset = offset;
    this.loopingPass = useNative;
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
    const loop = this.activeLoop();
    if (this.loopingPass && loop) {
      this.metronome.schedule(this.toHeardTime, this.state.duration, loop);
      return;
    }
    if (loop && !this.loopingPass && this.startOffset < loop.end && this.position >= loop.end) {
      this.seek(loop.start);
      return;
    }
    if (this.position >= this.state.duration) {
      this.loopingPass = false;
      this.stopSources();
      this.metronome.stop();
      this.offset = this.state.duration;
      leavePlaybackSession();
      this.set({ playing: false });
      return;
    }
    this.metronome.schedule(this.toHeardTime, this.state.duration, null);
  }

  /** Test/debug hook: per-stem start offsets, effective gains, and the shared start time. */
  syncReport() {
    return {
      anchorTime: this.anchorTime,
      anchorOffset: this.anchorOffset,
      musicDelay: this.musicDelay,
      loopingPass: this.loopingPass,
      gains: this.state.stems.map((_, i) => this.stemGain(i)),
      sources: this.tracks.map((t) =>
        t.source
          ? {
              rate: t.source.playbackRate.value,
              loop: t.source.loop,
              loopStart: t.source.loopStart,
              loopEnd: t.source.loopEnd,
            }
          : null,
      ),
    };
  }

  // ---------- mixer ----------
  setBassBoost(enabled: boolean) {
    if (this.state.bassBoost === enabled) return;
    this.set({ bassBoost: enabled });
    this.applyGains();
  }
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
  /** Unmute every stem, keeping current volumes. */
  unmuteAll() {
    this.set({ stems: this.state.stems.map((s) => ({ ...s, muted: false })) });
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

  private bassStemIndex(): number {
    return this.state.stems.findIndex((s) => /bass/i.test(s.name));
  }

  private stemGain(i: number): number {
    if (!Engine.audible(this.state.stems, i)) return 0;
    const base = sliderToGain(this.state.stems[i].volume);
    if (!this.state.bassBoost) return base;
    const bassIdx = this.bassStemIndex();
    if (bassIdx < 0 || !Engine.audible(this.state.stems, bassIdx)) return base;
    return i === bassIdx ? base * BASS_BOOST_GAIN : base * BASS_BOOST_BAND_GAIN;
  }

  private applyGains() {
    const now = this.ctx.currentTime;
    this.state.stems.forEach((_, i) => {
      this.tracks[i].gain.gain.setTargetAtTime(this.stemGain(i), now, 0.015);
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
      // Re-anchor with unwrapped rawPosition so source timing and loopCycles stay continuous across wraps.
      const now = this.ctx.currentTime;
      this.anchorOffset = this.rawPosition;
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

  // ---------- A-B loop ----------
  private updateLoop(next: LoopState, seekToStart = false) {
    // Capture wrapped position BEFORE state.loop changes so wrapRaw uses the previous bounds.
    const curPos = this.position;
    const dur = this.state.duration;
    const start = next.start === null ? null : Math.max(0, Math.min(next.start, dur));
    const end = next.end === null ? null : Math.max(0, Math.min(next.end, dur));
    const sanitized: LoopState = {
      start,
      end,
      enabled: next.enabled && start !== null && end !== null && end - start >= MIN_LOOP_DURATION,
    };
    this.set({ loop: sanitized });
    const active = this.activeLoop();
    if (!this.state.playing) {
      if (seekToStart && active) {
        this.offset = active.start;
        this.listeners.forEach((fn) => fn());
      }
      return;
    }
    if ((seekToStart && active) || (active && curPos >= active.end)) {
      this.startSources(active.start);
      this.startMetronome();
      return;
    }
    const now = this.ctx.currentTime;
    this.anchorOffset = curPos;
    this.anchorTime = Math.max(now, this.anchorTime);
    this.startOffset = curPos;
    const minDur = this.minBufferDuration();
    const nativeEnd = active ? Math.min(active.end, minDur) : 0;
    const useNative = !!active && this.canNativeLoop(active.end) && nativeEnd - active.start >= MIN_LOOP_DURATION;
    for (const t of this.tracks) {
      if (!t.source) continue;
      if (useNative && active) {
        t.source.loopStart = active.start;
        t.source.loopEnd = nativeEnd;
        t.source.loop = true;
      } else {
        t.source.loop = false;
      }
    }
    this.loopingPass = useNative;
    this.startMetronome();
  }

  setLoopA(time?: number) {
    const dur = this.state.duration;
    if (dur < MIN_LOOP_DURATION) return;
    const a = Math.max(0, Math.min(time ?? this.position, dur - MIN_LOOP_DURATION));
    const { end, enabled } = this.state.loop;
    const next: LoopState =
      end !== null && a <= end - MIN_LOOP_DURATION ? { start: a, end, enabled } : { start: a, end: null, enabled: false };
    this.updateLoop(next, false);
  }

  setLoopB(time?: number) {
    const dur = this.state.duration;
    if (dur < MIN_LOOP_DURATION) return;
    const rawB = Math.max(0, Math.min(time ?? this.position, dur));
    const curA = this.state.loop.start;
    let start: number;
    let end: number;
    if (curA === null) {
      start = 0;
      end = Math.min(dur, Math.max(MIN_LOOP_DURATION, rawB));
    } else if (rawB < curA - MIN_LOOP_DURATION) {
      start = rawB;
      end = curA;
    } else {
      end = Math.min(dur, Math.max(curA + MIN_LOOP_DURATION, rawB));
      start = end - curA < MIN_LOOP_DURATION ? Math.max(0, end - MIN_LOOP_DURATION) : curA;
    }
    this.updateLoop({ start, end, enabled: true }, false);
  }

  setLoop(start: number, end: number, options?: { enabled?: boolean; seekToStart?: boolean }) {
    const dur = this.state.duration;
    if (dur < MIN_LOOP_DURATION) return;
    let a = Math.max(0, Math.min(start, end, dur));
    let b = Math.min(dur, Math.max(start, end, 0));
    if (b - a < MIN_LOOP_DURATION) {
      b = Math.min(dur, a + MIN_LOOP_DURATION);
      if (b - a < MIN_LOOP_DURATION) a = Math.max(0, b - MIN_LOOP_DURATION);
    }
    this.updateLoop({ start: a, end: b, enabled: options?.enabled ?? true }, options?.seekToStart ?? false);
  }

  toggleLoop() {
    const { start, end, enabled } = this.state.loop;
    if (start === null || end === null || end - start < MIN_LOOP_DURATION) return;
    this.updateLoop({ start, end, enabled: !enabled }, false);
  }

  clearLoop() {
    this.updateLoop({ start: null, end: null, enabled: false }, false);
  }

  private async updatePitchNode() {
    if (!(await this.pitchReady) || this.disposed) return;
    const { speed, pitch } = this.state;
    // Bypass SoundTouch when it has nothing to do, for the cleanest sound (and no delay).
    if (speed === 1 && pitch === 0) {
      if (this.pitchNode) {
        this.pitchNode.disconnect();
        this.pitchNode = null;
        this.limiter.disconnect();
        this.limiter.connect(this.output);
      }
    } else if (!this.pitchNode) this.connectPitchNode();
    else this.applyPitchParams(this.pitchNode);
    void this.updateMusicDelay();
  }

  /** Routes the music through a new, empty SoundTouch node (replacing any current one). */
  private connectPitchNode() {
    this.pitchNode?.disconnect();
    const node = new SoundTouchNode({ context: this.ctx });
    this.applyPitchParams(node);
    this.limiter.disconnect();
    this.limiter.connect(node);
    node.connect(this.output);
    this.pitchNode = node;
  }

  private applyPitchParams(node: SoundTouchNode) {
    node.playbackRate.value = this.state.speed;
    node.pitchSemitones.value = this.state.pitch;
  }

  /** Delays the clicks by SoundTouch's processing delay so they stay on the beat. */
  private async updateMusicDelay() {
    const { speed, pitch } = this.state;
    const engaged = !!this.pitchNode;
    if (engaged && !this.musicDelay) this.setMusicDelay(FALLBACK_PITCH_DELAY);
    const delay = engaged ? await measurePitchDelay(processorUrl, this.ctx.sampleRate, speed, pitch) : 0;
    if (this.disposed || speed !== this.state.speed || pitch !== this.state.pitch) return;
    this.setMusicDelay(delay);
  }

  private setMusicDelay(delay: number) {
    if (delay === this.musicDelay) return;
    this.musicDelay = delay;
    if (this.state.playing) this.startMetronome();
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
    if (this.state.playing) {
      const { pos, cycle } = this.heardState;
      this.metronome.reset(pos, cycle);
    }
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
    const pos = this.heardPosition;
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
    const anchor = this.nearestClick(this.heardPosition);
    const period = 60 / b;
    this.setMetronome({ bpm: b, beats: null, offset: ((anchor % period) + period) % period });
  }

  /**
   * Waveform overview of stem `i` and the fraction of the song's duration it spans (stems can be
   * shorter than the longest one). Null until the stem is decoded.
   */
  peaksFor(i: number): { peaks: Float32Array; span: number } | null {
    const { buffer, peaks } = this.tracks[i] ?? {};
    if (!buffer || !peaks || !this.state.duration) return null;
    return { peaks, span: Math.min(1, buffer.duration / this.state.duration) };
  }

  /** Decoded audio used for BPM detection: the drums if present, else the first stem. */
  tempoBuffer(): AudioBuffer | null {
    const idx = this.state.stems.findIndex((s) => /drum|perc|beat/i.test(s.name));
    return this.tracks[idx >= 0 ? idx : 0]?.buffer ?? null;
  }

  /** Decoded drums stem for the drum strip; null when the song has none (no other stem stands in). */
  drumBuffer(): AudioBuffer | null {
    const idx = this.state.stems.findIndex((s) => /drum|perc|beat/i.test(s.name));
    return idx >= 0 ? (this.tracks[idx]?.buffer ?? null) : null;
  }

  /** Decoded bass stem for the bass tab strip; null when the song has none (no other stem stands in). */
  bassBuffer(): AudioBuffer | null {
    const idx = this.state.stems.findIndex((s) => /bass/i.test(s.name));
    return idx >= 0 ? (this.tracks[idx]?.buffer ?? null) : null;
  }

  /**
   * Decoded audio used for chord detection: the pitched stems (no drums or vocals; everything but
   * the drums when that leaves nothing), and the bass stem on its own for the roots.
   */
  chordBuffers(): ChordBuffers {
    const named = this.state.stems.map((s, i) => ({ name: s.name, buffer: this.tracks[i]?.buffer })).filter((s) => !!s.buffer);
    const drums = /drum|perc|beat/i;
    let harmonic = named.filter((s) => !drums.test(s.name) && !/vocal|voice|vox/i.test(s.name));
    if (!harmonic.length) harmonic = named.filter((s) => !drums.test(s.name));
    if (!harmonic.length) harmonic = named;
    return {
      harmonic: harmonic.map((s) => s.buffer!),
      bass: named.find((s) => /bass/i.test(s.name))?.buffer ?? null,
    };
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    window.clearInterval(this.timer);
    this.metronome.stop();
    this.stopSources();
    leavePlaybackSession();
    this.tracks.forEach((t) => {
      t.buffer = null;
      t.peaks = null;
    });
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

/** Imported stems are read from the File; library stems come from the device cache or the network. */
async function readStem(stem: StemSource, onProgress: ByteProgress, signal: AbortSignal): Promise<ArrayBuffer> {
  if (stem.file) {
    const data = await stem.file.arrayBuffer();
    onProgress(data.byteLength, data.byteLength);
    return data;
  }
  return readCachedStem(stem.url!, onProgress, signal);
}
