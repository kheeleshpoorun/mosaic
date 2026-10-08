/**
 * Beat tracking for the metronome.
 *
 * 1. Onset envelope (100 frames/s): half-wave-rectified rise in log energy of a high band
 *    (snare/hats) and a low band (kick).
 * 2. Tempo: autocorrelation of the envelope, weighted towards ~110 BPM, refined to a fractional period.
 * 3. Beats: dynamic programming (Ellis 2007, "Beat Tracking by Dynamic Programming") — picks the
 *    sequence of beat times that best lines up with onsets while keeping a steady-ish spacing, so the
 *    grid follows small tempo drifts instead of piling up error.
 * 4. Downbeat: the beat phase (of 4) with the strongest kick energy gets the accent.
 *
 * Pure function of the samples so it can be unit-tested with synthetic audio.
 */

export interface BeatAnalysis {
  /** Beat times in seconds of track time. */
  beats: number[];
  /** Median tempo. */
  bpm: number;
  /** Index into `beats` of the first downbeat (0..3). */
  downbeat: number;
}

/** Target analysis frame rate; the real rate is sampleRate / round(sampleRate / TARGET_FPS). */
const TARGET_FPS = 100;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** How strongly beats are held to the estimated period (higher = stiffer grid). */
const TIGHTNESS = 100;

export function analyzeBeats(channels: Float32Array[], sampleRate: number): BeatAnalysis {
  const hop = Math.round(sampleRate / TARGET_FPS);
  // Use the exact frame rate — rounding the hop otherwise stretches the timeline (0.2% at 22.05 kHz).
  const fps = sampleRate / hop;
  const { onset, low } = onsetEnvelope(channels, hop, fps);
  const period = estimatePeriod(onset, fps);
  const frames = trackBeats(onset, period);
  // Each onset frame marks the rise *into* frame t; its centre is half a hop later.
  const beats = frames.map((f) => (f + 0.5) / fps);
  return { beats, bpm: medianBpm(beats, period, fps), downbeat: findDownbeat(frames, low) };
}

function onsetEnvelope(channels: Float32Array[], hop: number, fps: number) {
  const sampleRate = hop * fps;
  const length = channels[0].length;
  const n = Math.floor(length / hop);
  const hi = new Float32Array(n);
  const lo = new Float32Array(n);
  // One-pole low-pass at ~150 Hz isolates the kick.
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  let lp = 0;
  let prev = 0;
  const inv = 1 / channels.length;
  for (let f = 0; f < n; f++) {
    let eh = 0;
    let el = 0;
    const end = (f + 1) * hop;
    for (let i = f * hop; i < end; i++) {
      let x = 0;
      for (const ch of channels) x += ch[i];
      x *= inv;
      lp += a * (x - lp);
      const d = x - prev; // first difference ≈ high-pass
      prev = x;
      eh += d * d;
      el += lp * lp;
    }
    hi[f] = Math.log(1e-6 + eh / hop);
    lo[f] = Math.log(1e-6 + el / hop);
  }

  const onset = new Float32Array(n);
  const low = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const dl = Math.max(0, lo[f] - lo[f - 1]);
    onset[f] = Math.max(0, hi[f] - hi[f - 1]) + dl;
    low[f] = dl;
  }
  // Remove the slowly varying part (local mean over ~0.5 s) and normalise.
  const w = Math.round(fps * 0.25);
  const prefix = new Float64Array(n + 1);
  for (let f = 0; f < n; f++) prefix[f + 1] = prefix[f] + onset[f];
  let sumSq = 0;
  for (let f = 0; f < n; f++) {
    const lo2 = Math.max(0, f - w);
    const hi2 = Math.min(n, f + w + 1);
    const mean = (prefix[hi2] - prefix[lo2]) / (hi2 - lo2);
    onset[f] = Math.max(0, onset[f] - mean);
    sumSq += onset[f] * onset[f];
  }
  const std = Math.sqrt(sumSq / Math.max(1, n)) || 1;
  for (let f = 0; f < n; f++) onset[f] /= std;
  return { onset, low };
}

/** Beat period in frames (fractional). */
function estimatePeriod(onset: Float32Array, fps: number): number {
  const minLag = Math.floor((60 / MAX_BPM) * fps);
  const maxLag = Math.ceil((60 / MIN_BPM) * fps);
  const n = onset.length;
  const score = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += onset[i] * onset[i - lag];
    const bpm = (60 * fps) / lag;
    // Prior: musicians count quarter notes, so prefer ~70–130 BPM over the eighth-note pulse
    // (log-Gaussian centred on 100 BPM, ~0.6 octave wide).
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 100) / 0.6, 2));
    score[lag] = (s / (n - lag)) * prior;
  }
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (score[lag] > score[best]) best = lag;
  // Parabolic interpolation around the peak for sub-frame precision.
  const y0 = score[best - 1];
  const y1 = score[best];
  const y2 = score[best + 1];
  const denom = y0 - 2 * y1 + y2;
  const delta = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  return best + Math.max(-0.5, Math.min(0.5, delta));
}

function trackBeats(onset: Float32Array, period: number): number[] {
  const n = onset.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const r = Math.log((t - p) / period);
      const s = score[p] - TIGHTNESS * r * r;
      if (arg < 0 || s > best) {
        best = s;
        arg = p;
      }
    }
    score[t] = onset[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // End on the best-scoring frame within the last period.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.ceil(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) frames.push(t);
  frames.reverse();
  // Extend the grid back to the start of the track (silent intros) at the detected period.
  while (frames.length && frames[0] - period >= 0) frames.unshift(frames[0] - period);
  return frames;
}

function findDownbeat(frames: number[], low: Float32Array): number {
  const sums = [0, 0, 0, 0];
  frames.forEach((f, i) => {
    const t = Math.round(f);
    let m = 0;
    for (let d = -2; d <= 2; d++) m = Math.max(m, low[t + d] ?? 0);
    sums[i % 4] += m;
  });
  return sums.indexOf(Math.max(...sums));
}

function medianBpm(beats: number[], period: number, fps: number): number {
  if (beats.length < 3) return (60 * fps) / period;
  const gaps = beats.slice(1).map((b, i) => b - beats[i]).sort((x, y) => x - y);
  return Math.round((60 / gaps[Math.floor(gaps.length / 2)]) * 10) / 10;
}
