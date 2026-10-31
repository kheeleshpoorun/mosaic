const LOOKAHEAD = 0.12; // seconds of clicks scheduled ahead
/** Gain at full slider: +12 dB, so the click still cuts through a mix that already peaks at 0 dBFS. */
const MAX_GAIN = 4;

/** Slider position 0..1 → click gain (quadratic, like the stem sliders). */
export function metronomeGain(volume: number): number {
  const v = Math.max(0, Math.min(1, volume));
  return v * v * MAX_GAIN;
}

/**
 * One short, bright "tick" (the same sound on every beat, as in Moises): a woody 2.6 kHz body
 * with a slight pitch drop, plus a band-limited noise transient for the attack. Peak-normalised
 * to 1. Most of its energy sits at 2–5 kHz, above where bass, kick and vocals pile up.
 */
export function renderClick(sampleRate: number): Float32Array<ArrayBuffer> {
  const len = Math.round(sampleRate * 0.04);
  const out = new Float32Array(len);
  let seed = 7;
  let prev = 0;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const freq = 2000 + 600 * Math.exp(-t / 0.004);
    phase += (2 * Math.PI * freq) / sampleRate;
    const body = Math.sin(phase) * Math.exp(-t / 0.008);
    // First difference of white noise ≈ high-passed noise: a crisp "t" at the onset.
    const white = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff - 1;
    const hiss = (white - prev) * 0.5 * Math.exp(-t / 0.0015);
    prev = white;
    const attack = Math.min(1, i / (sampleRate * 0.0005));
    out[i] = attack * (0.8 * body + 0.6 * hiss);
  }
  let peak = 0;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  for (let i = 0; i < len; i++) out[i] /= peak;
  return out;
}

export interface MetronomeSettings {
  enabled: boolean;
  /** Tempo of the fixed grid (also shown as the song's tempo when beats are tracked). */
  bpm: number;
  /** Seconds added to every click: first-beat time for the fixed grid, a nudge for tracked beats. */
  offset: number;
  volume: number;
  /** Tracked beat times (track seconds). When set, clicks follow these instead of a fixed grid. */
  beats: number[] | null;
  /** Index of the first downbeat in `beats` (from the beat tracker; the click itself is unaccented). */
  downbeat: number;
}

/** Index of the first beat at or after `t` (beats sorted ascending). */
export function firstBeatAtOrAfter(beats: number[], t: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Click track scheduled on the AudioContext clock, aligned to track time. Bypasses pitch shifting. */
export class Metronome {
  private out: GainNode;
  private sound: AudioBuffer;
  private settings: MetronomeSettings = { enabled: false, bpm: 120, offset: 0, volume: 0.7, beats: null, downbeat: 0 };
  private nextBeat = 0;
  private active = false;

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.connect(destination);
    const samples = renderClick(ctx.sampleRate);
    this.sound = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    this.sound.copyToChannel(samples, 0);
  }

  configure(s: MetronomeSettings) {
    this.settings = { ...s };
    this.out.gain.value = metronomeGain(s.volume);
  }

  /** Track time of click `k`, or null past the last tracked beat. */
  private beatTime(k: number): number | null {
    const { beats, offset, bpm } = this.settings;
    if (beats) return k < beats.length ? beats[k] + offset : null;
    return offset + (k * 60) / bpm;
  }


  /** Call when playback (re)starts at `pos` seconds of track time. */
  reset(pos: number) {
    const { beats, offset, bpm } = this.settings;
    this.nextBeat = beats
      ? firstBeatAtOrAfter(beats, pos - offset - 1e-6)
      : Math.ceil((pos - offset) / (60 / bpm) - 1e-6);
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  /**
   * Schedule clicks that fall within the look-ahead window.
   * `toCtxTime` maps track time → AudioContext time; `limit` = track time to stop at (song end).
   */
  schedule(toCtxTime: (trackTime: number) => number, limit: number) {
    if (!this.active || !this.settings.enabled) return;
    const now = this.ctx.currentTime;
    for (;;) {
      const beatTime = this.beatTime(this.nextBeat);
      if (beatTime === null || beatTime >= limit) return;
      const at = toCtxTime(beatTime);
      if (at > now + LOOKAHEAD) return;
      if (at >= now - 0.02) this.click(Math.max(now, at));
      this.nextBeat += 1;
    }
  }

  private click(at: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.sound;
    src.connect(this.out);
    src.start(at);
  }
}
