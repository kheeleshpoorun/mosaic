const LOOKAHEAD = 0.12; // seconds of clicks scheduled ahead

export interface MetronomeSettings {
  enabled: boolean;
  /** Tempo of the fixed grid (also shown as the song's tempo when beats are tracked). */
  bpm: number;
  /** Seconds added to every click: first-beat time for the fixed grid, a nudge for tracked beats. */
  offset: number;
  volume: number;
  /** Tracked beat times (track seconds). When set, clicks follow these instead of a fixed grid. */
  beats: number[] | null;
  /** Index of the first downbeat in `beats` (accent every 4th beat from there). */
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
  private settings: MetronomeSettings = { enabled: false, bpm: 120, offset: 0, volume: 0.7, beats: null, downbeat: 0 };
  private nextBeat = 0;
  private active = false;

  constructor(private ctx: AudioContext) {
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
  }

  configure(s: MetronomeSettings) {
    this.settings = { ...s };
    this.out.gain.value = s.volume;
  }

  /** Track time of click `k`, or null past the last tracked beat. */
  private beatTime(k: number): number | null {
    const { beats, offset, bpm } = this.settings;
    if (beats) return k < beats.length ? beats[k] + offset : null;
    return offset + (k * 60) / bpm;
  }

  private isAccent(k: number): boolean {
    const base = this.settings.beats ? k - this.settings.downbeat : k;
    return ((base % 4) + 4) % 4 === 0;
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
      if (at >= now - 0.02) this.click(Math.max(now, at), this.isAccent(this.nextBeat));
      this.nextBeat += 1;
    }
  }

  private click(at: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1600 : 1000;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(accent ? 1 : 0.7, at + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    osc.connect(env).connect(this.out);
    osc.start(at);
    osc.stop(at + 0.06);
  }
}
