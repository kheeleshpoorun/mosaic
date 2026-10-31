/**
 * Drum transcription for the drum strip and the drum sheet.
 *
 * 1. Bands: STFT of the drums stem (512-sample window, ~200 frames/s) folded into kick (30–100 Hz),
 *    low tom (100–180 Hz), high tom (180–400 Hz), snare body (200–800 Hz), snare wires (1.5–5 kHz) and
 *    cymbal (7 kHz+) energies.
 * 2. Hits: the rise of each band's energy. Linear energy, not log, so the little a loud kick leaks
 *    into the other bands stays little. A snare needs its wires and some body; a quieter one is a
 *    ghost note. A tom is low-mid energy without wires that out-rises the kick band. A cymbal is a
 *    closed hat, an open hat or a crash depending on how long it rings.
 * 3. Feel: where the off-beat cymbals land inside the beat (0.5 straight, ~0.67 swung). Swung songs
 *    get a triplet grid (3 steps per beat), straight ones a sixteenth grid (4 steps per beat).
 * 4. Grid: every tracked beat is split into those steps (so the grid follows tempo drift, like the
 *    metronome) and each hit is snapped to the nearest one.
 * 5. Meter: 3/4 when beats repeat every 3 clearly better than every 4; otherwise 4/4 from the beat
 *    tracker's downbeat.
 * 6. Grooves: bars are clustered by a distance that mostly looks at kick and snare (hats vary bar to
 *    bar without the groove changing). A bar of the same groove as the bar before is a repeat (𝄎). A
 *    one-off bar that's busier than usual, uses toms, or piles up hits on its last beat is a fill.
 *
 * Pure function of the samples so it can be unit-tested with synthetic audio.
 */

import { FFT } from './chords';

export type DrumLane = 'crash' | 'openHat' | 'hat' | 'highTom' | 'snare' | 'lowTom' | 'kick';
/** Lane order of `steps`: top to bottom, as on a drum staff. */
export const LANES: DrumLane[] = ['crash', 'openHat', 'hat', 'highTom', 'snare', 'lowTom', 'kick'];
export const CYMBALS: DrumLane[] = ['crash', 'openHat', 'hat'];
const L = Object.fromEntries(LANES.map((lane, i) => [lane, i])) as Record<DrumLane, number>;

/** Velocity stored for a ghost note; real hits are 0.5..1. */
const GHOST_VELOCITY = 0.25;
export const isGhost = (v: number) => v > 0 && v < 0.4;

export interface DrumBar {
  start: number;
  end: number;
  /** Start of each beat of the bar (`meter` entries; a pickup bar's first ones are extrapolated). */
  beats: number[];
  kind: 'groove' | 'fill' | 'rest';
  /** Groove number (0, 1, … in order of first appearance); -1 for fills and rests. */
  groove: number;
  /** Same groove as the bar right before it: shown as a repeat sign. */
  repeat: boolean;
  /** Velocity 0..1 (0 = no hit, under 0.4 = ghost note) per lane (LANES order) and step. */
  steps: number[][];
}

export interface DrumAnalysis {
  meter: 3 | 4;
  /** Steps per beat: 4 (sixteenths) when straight, 3 (triplets) when swung. */
  division: 3 | 4;
  swing: boolean;
  bars: DrumBar[];
}

export interface DrumInput {
  /** Mono drums stem. */
  samples: Float32Array;
  sampleRate: number;
  /** Beat times in seconds of track time. */
  beats: number[];
  /** Index into `beats` of the first downbeat (from the beat tracker). */
  downbeat: number;
  duration: number;
}

const TARGET_FPS = 200;
const FFT_SIZE = 512;
const B = { kick: 0, lowTom: 1, highTom: 2, body: 3, wires: 4, cym: 5 };
const BANDS: [number, number][] = [
  [30, 100],
  [100, 180],
  [180, 400],
  [200, 800],
  [1500, 5000],
  [7000, Infinity],
];
/** Frames back to compare against when measuring an energy rise. */
const RISE_LOOKBACK = 3;
/** A hit at least this much louder than the frames before it. */
const ONSET_RATIO = 1.4;
/** A hit snaps to a step when it's within this fraction of a step from it. */
const SNAP = 0.4;
/** Minimum rise (relative to the band's loud hits) for a hit. */
const HIT = { cym: 0.15, snare: 0.2, kick: 0.15, tom: 0.1 };
/** A snare between these is a ghost note. */
const GHOST = 0.04;
/** A band whose loud hits are this far under the loudest band's is leakage (the song lacks it: ~50 dB). */
const PRESENCE = 1e-5;
/** A snare's body rises at least this much against its wires (a hat's barely does). */
const SNARE_BODY_RAW = 0.05;
/** A snare also needs this much body, so a kick's beater click isn't taken for one. */
const SNARE_BODY = 0.1;
/** A tom has (almost) no wires. */
const TOM_MAX_WIRES = 0.15;
/** Cymbal still ringing (energy vs its peak) 50 ms after the hit: open hat or crash, not closed hat. */
const RING_SHORT = 0.25;
/** …and most of a step after, loud: a crash. */
const RING_LONG = 0.4;
const CRASH_MIN = 0.6;
/** Off-beat cymbal positions looked at for swing (straight sixteenths at 0.75 stay outside). */
const SWING_WINDOW: [number, number] = [0.42, 0.72];
const SWING_MIN = 0.58;
/** Lane weights in the bar distance: kick and snare define a groove, cymbals barely do. */
const LANE_WEIGHT: Record<DrumLane, number> = { crash: 0, openHat: 0.25, hat: 0.25, highTom: 0.5, snare: 1, lowTom: 0.5, kick: 1 };
const WEIGHTS = LANES.map((lane) => LANE_WEIGHT[lane]);

const EMPTY: DrumAnalysis = { meter: 4, division: 4, swing: false, bars: [] };

export function analyzeDrums({ samples, sampleRate, beats, downbeat, duration }: DrumInput): DrumAnalysis {
  if (beats.length < 2) return EMPTY;
  const hop = Math.round(sampleRate / TARGET_FPS);
  // Use the exact frame rate — rounding the hop otherwise stretches the timeline.
  const fps = sampleRate / hop;
  const { energy, rises } = bandFeatures(samples, sampleRate, hop);

  const swing = detectSwing(rises[B.cym], beats, fps) > SWING_MIN;
  const division = swing ? 3 : 4;
  const { strength, at } = stepStrengths(rises, beats, fps, division);
  const lanes = classify(strength, at[B.cym], energy[B.cym], fps, beats, division);

  const meter = detectMeter(lanes, division);
  const first = meter === 4 ? ((downbeat % 4) + 4) % 4 : waltzDownbeat(lanes, division);
  const bars = makeBars(lanes, beats, meter, division, first, duration);
  labelBars(bars, division);
  return { meter, division, swing, bars };
}

// ---------- features ----------

/** Per band and frame: energy, and how much it rose over the last few frames (≥ 0). */
function bandFeatures(x: Float32Array, sampleRate: number, hop: number) {
  const size = FFT_SIZE;
  const frames = Math.max(1, Math.ceil(x.length / hop));
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const ranges = BANDS.map(([lo, hi]) => {
    const kLo = Math.max(1, Math.round((lo * size) / sampleRate));
    const kHi = Math.min(size / 2 - 1, Math.round((hi * size) / sampleRate));
    return [kLo, Math.max(kLo, kHi)];
  });
  const energy = BANDS.map(() => new Float32Array(frames));

  const fft = new FFT(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  // Frame f is centred on sample f·hop, so its time is f / fps.
  const load = (buf: Float64Array, f: number) => {
    const start = f * hop - size / 2;
    for (let i = 0; i < size; i++) {
      const j = start + i;
      buf[i] = f < frames && j >= 0 && j < x.length ? x[j] * win[i] : 0;
    }
  };
  // Two real frames per complex FFT: frame f in the real part, frame f + 1 in the imaginary part.
  for (let f = 0; f < frames; f += 2) {
    load(re, f);
    load(im, f + 1);
    fft.transform(re, im);
    ranges.forEach(([kLo, kHi], b) => {
      let ea = 0;
      let eb = 0;
      for (let k = kLo; k <= kHi; k++) {
        const zr = re[k];
        const zi = im[k];
        const wr = re[size - k];
        const wi = im[size - k];
        ea += (zr + wr) * (zr + wr) + (zi - wi) * (zi - wi);
        eb += (zi + wi) * (zi + wi) + (zr - wr) * (zr - wr);
      }
      const n = 4 * (kHi - kLo + 1);
      energy[b][f] = ea / n;
      if (f + 1 < frames) energy[b][f + 1] = eb / n;
    });
  }

  const rises = energy.map((raw) => {
    // A 3-frame mean steadies the flutter of noisy, ringing sounds (a crash's sustain).
    const e = new Float32Array(frames);
    for (let f = 0; f < frames; f++) e[f] = (raw[Math.max(0, f - 1)] + raw[f] + raw[Math.min(frames - 1, f + 1)]) / 3;
    const rise = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      let lo = e[f - 1];
      for (let d = 2; d <= RISE_LOOKBACK && f - d >= 0; d++) lo = Math.min(lo, e[f - d]);
      // Ignore the flutter of something already ringing (a crash's sustain): a hit clearly adds energy.
      rise[f] = e[f] > ONSET_RATIO * lo ? e[f] - lo : 0;
    }
    return rise;
  });
  return { energy, rises };
}

/** Beat interval k: [beats[k], beats[k+1]); the last one is as long as the one before. */
function beatEnd(beats: number[], k: number): number {
  return k + 1 < beats.length ? beats[k + 1] : 2 * beats[k] - beats[k - 1];
}

/** Median position of the strongest off-beat cymbal in the beat, or 0.5 when there are too few. */
function detectSwing(cym: Float32Array, beats: number[], fps: number): number {
  const peak: number[] = [];
  const off: { u: number; v: number }[] = [];
  for (let k = 0; k < beats.length; k++) {
    const t0 = beats[k];
    const len = beatEnd(beats, k) - t0;
    let max = 0;
    let best = { u: 0, v: 0 };
    for (let f = Math.max(0, Math.ceil(t0 * fps)); f < cym.length && f / fps < t0 + len; f++) {
      const u = (f / fps - t0) / len;
      max = Math.max(max, cym[f]);
      if (u >= SWING_WINDOW[0] && u <= SWING_WINDOW[1] && cym[f] > best.v) best = { u, v: cym[f] };
    }
    peak.push(max);
    if (best.v > 0) off.push(best);
  }
  const ref = percentile(peak, 0.9);
  if (!ref) return 0.5;
  const us = off.filter((o) => o.v > HIT.cym * ref).map((o) => o.u);
  if (us.length < Math.max(8, beats.length / 4)) return 0.5;
  return percentile(us, 0.5);
}

/** Strongest rise per band and step (beat k → steps k·division …), and the frame it peaked on. */
function stepStrengths(rises: Float32Array[], beats: number[], fps: number, division: number) {
  const steps = beats.length * division;
  const strength = rises.map(() => new Float32Array(steps));
  const at = rises.map(() => new Int32Array(steps).fill(-1));
  const frames = rises[0].length;
  for (let k = 0; k < beats.length; k++) {
    const t0 = beats[k];
    const len = beatEnd(beats, k) - t0;
    for (let f = Math.max(0, Math.ceil(t0 * fps)); f < frames && f / fps < t0 + len; f++) {
      const w = ((f / fps - t0) / len) * division;
      const s = Math.round(w);
      if (Math.abs(w - s) > SNAP) continue;
      const g = k * division + s;
      if (g >= steps) continue;
      rises.forEach((r, b) => {
        if (r[f] > strength[b][g]) {
          strength[b][g] = r[f];
          at[b][g] = f;
        }
      });
    }
  }
  return { strength, at };
}

/** Hits per lane (LANES order) and step, with velocities in tenths (ghost notes at GHOST_VELOCITY). */
function classify(strength: Float32Array[], cymAt: Int32Array, cymEnergy: Float32Array, fps: number, beats: number[], division: number): number[][] {
  const refs = strength.map(loudHit);
  // A band far under the loudest one is leakage, not a drum (a song without toms, say).
  const floor = Math.max(...refs) * PRESENCE;
  const norm = (b: number, g: number, ref = refs[b]) => (ref > floor ? strength[b][g] / ref : 0);
  const vel = (r: number) => Math.max(0.5, round(Math.min(1, Math.sqrt(r)), 10));
  // Toms are measured against the loudest drum, so a song without toms doesn't promote leakage.
  const drumRef = Math.max(refs[B.kick], refs[B.body]);
  const steps = beats.length * division;
  const lanes = LANES.map(() => new Array<number>(steps).fill(0));

  for (let g = 0; g < steps; g++) {
    const raw = strength.map((s) => s[g]);
    const k = norm(B.kick, g);
    // A snare has body under its wires; a hat's sizzle has next to none.
    const snarey = raw[B.body] >= SNARE_BODY_RAW * raw[B.wires];
    const wires = norm(B.wires, g);
    const body = norm(B.body, g);

    if (snarey && wires > HIT.snare && body > SNARE_BODY) lanes[L.snare][g] = vel(wires);
    else if (snarey && wires > GHOST && body > SNARE_BODY / 2 && k < HIT.kick) lanes[L.snare][g] = GHOST_VELOCITY;

    const low = strength[B.lowTom][g];
    const high = strength[B.highTom][g];
    const tom = Math.max(low, high);
    const isTom = wires < TOM_MAX_WIRES && tom > strength[B.kick][g] && drumRef > floor && tom / drumRef > HIT.tom;
    if (isTom) lanes[low >= high ? L.lowTom : L.highTom][g] = vel(tom / drumRef);
    if (k > HIT.kick && (!isTom || k > 0.5)) lanes[L.kick][g] = vel(k);

    const c = norm(B.cym, g);
    if (c > HIT.cym) {
      const stepLen = (beatEnd(beats, Math.floor(g / division)) - beats[Math.floor(g / division)]) / division;
      lanes[cymbalLane(cymEnergy, cymAt[g], fps, c, stepLen)][g] = vel(c);
    }
  }
  return lanes;
}

/** Closed hat, open hat or crash, from how long the cymbal band rings after the hit at frame f. */
function cymbalLane(e: Float32Array, f: number, fps: number, strength: number, stepLen: number): number {
  if (f < 0) return L.hat;
  let peak = 0;
  let p = f;
  for (let d = 0; d <= 3 && f + d < e.length; d++) {
    if (e[f + d] > peak) {
      peak = e[f + d];
      p = f + d;
    }
  }
  // What was already ringing (e.g. a crash under the hats) doesn't count as this cymbal's ring.
  let base = Infinity;
  for (let d = 1; d <= RISE_LOOKBACK; d++) base = Math.min(base, e[f - d] ?? 0);
  base = Number.isFinite(base) ? base : 0;
  if (peak <= base) return L.hat;
  const ring = (seconds: number) => (e[Math.min(e.length - 1, p + Math.round(seconds * fps))] - base) / (peak - base);
  if (ring(Math.min(0.05, 0.4 * stepLen)) < RING_SHORT) return L.hat;
  // Measured before the next step, where another hit may start.
  return strength > CRASH_MIN && ring(0.8 * stepLen) > RING_LONG ? L.crash : L.openHat;
}

// ---------- meter ----------

/** Lane steps of beat k as one vector (ghost notes left out). */
function beatVector(lanes: number[][], k: number, division: number): number[] {
  return lanes.flatMap((lane) => lane.slice(k * division, (k + 1) * division).map((v) => (isGhost(v) ? 0 : v)));
}

/** Mean cosine similarity of each beat with the one `lag` beats later. */
function repetition(lanes: number[][], lag: number, division: number): number {
  const n = lanes[0].length / division;
  let sum = 0;
  let count = 0;
  for (let k = 0; k + lag < n; k++) {
    const a = beatVector(lanes, k, division);
    const b = beatVector(lanes, k + lag, division);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < a.length; i++) {
      ab += a[i] * b[i];
      aa += a[i] * a[i];
      bb += b[i] * b[i];
    }
    if (!aa || !bb) continue;
    sum += ab / Math.sqrt(aa * bb);
    count++;
  }
  return count ? sum / count : 0;
}

function detectMeter(lanes: number[][], division: number): 3 | 4 {
  return repetition(lanes, 3, division) > repetition(lanes, 4, division) + 0.1 ? 3 : 4;
}

/** In 3/4, the beat phase with the most kick (and least snare) on the beat. */
function waltzDownbeat(lanes: number[][], division: number): number {
  const kick = lanes[L.kick];
  const snare = lanes[L.snare];
  const sums = [0, 0, 0];
  for (let g = 0; g < kick.length; g += division) sums[(g / division) % 3] += kick[g] - snare[g];
  return sums.indexOf(Math.max(...sums));
}

// ---------- bars & grooves ----------

function makeBars(lanes: number[][], beats: number[], meter: number, division: number, first: number, duration: number): DrumBar[] {
  // Extrapolate the pickup bar's missing beats, and complete the last bar (+1 for its end).
  const pre = (meter - first) % meter;
  const times = [...beats];
  for (let i = 0; i < pre; i++) times.unshift(2 * times[0] - times[1]);
  while (times.length % meter !== 1) times.push(2 * times.at(-1)! - times.at(-2)!);

  const bars: DrumBar[] = [];
  const stepsPerBar = meter * division;
  for (let b = 0; b * meter + meter < times.length; b++) {
    const start = times[b * meter];
    const end = times[b * meter + meter];
    if (start >= duration) break;
    const steps = lanes.map((lane) =>
      Array.from({ length: stepsPerBar }, (_, s) => {
        const g = (b * meter - pre) * division + s;
        return g >= 0 && g < lane.length ? lane[g] : 0;
      }),
    );
    bars.push({
      start: round(Math.max(0, start), 1000),
      end: round(Math.min(duration, end), 1000),
      beats: times.slice(b * meter, b * meter + meter).map((t) => round(t, 1000)),
      kind: 'rest',
      groove: -1,
      repeat: false,
      steps,
    });
  }
  return bars;
}

const on = (v: number) => v > 0 && !isGhost(v);

function hitCount(steps: number[][]): number {
  return steps.reduce((n, lane, l) => n + WEIGHTS[l] * lane.filter(on).length, 0);
}

function distance(a: number[][], b: number[][]): number {
  let d = 0;
  a.forEach((lane, l) => lane.forEach((v, s) => (on(v) !== on(b[l][s]) ? (d += WEIGHTS[l]) : 0)));
  return d;
}

/** Most different two bars of the same groove may be: a stray kick or snare, more in busy grooves. */
function tolerance(a: number[][], b: number[][]): number {
  return Math.max(2, 0.3 * Math.min(hitCount(a), hitCount(b)));
}

/** Snare, tom and kick hits in the bar's last beat, where fills usually go. */
function lastBeatHits(steps: number[][], division: number): number {
  const from = steps[0].length - division;
  return [L.highTom, L.snare, L.lowTom, L.kick].reduce((n, l) => n + steps[l].slice(from).filter(on).length, 0);
}

const hasToms = (steps: number[][]) => steps[L.highTom].some(on) || steps[L.lowTom].some(on);

/** Sets kind, groove and repeat on the bars, in place. */
function labelBars(bars: DrumBar[], division: number) {
  const active = bars.map((bar) => bar.steps.reduce((n, lane) => n + lane.filter(on).length, 0) >= 2);

  // Greedy clustering against each cluster's first bar, then once more against majority prototypes.
  let protos: number[][][] = [];
  let cluster = bars.map(() => -1);
  const assign = () =>
    bars.forEach((bar, i) => {
      if (!active[i]) return;
      let best = -1;
      let bestD = Infinity;
      protos.forEach((p, c) => {
        const d = distance(bar.steps, p);
        if (d <= tolerance(bar.steps, p) && d < bestD) {
          best = c;
          bestD = d;
        }
      });
      if (best < 0) {
        protos.push(bar.steps);
        best = protos.length - 1;
      }
      cluster[i] = best;
    });
  assign();
  protos = protos.map((_, c) => majority(bars.filter((_, i) => cluster[i] === c)));
  cluster = bars.map(() => -1);
  assign();

  const size = new Map<number, number>();
  cluster.forEach((c) => c >= 0 && size.set(c, (size.get(c) ?? 0) + 1));
  const busy = percentile(
    bars.filter((_, i) => active[i]).map((b) => hitCount(b.steps)),
    0.5,
  );
  const fill = bars.map((bar, i) => {
    if (cluster[i] < 0 || size.get(cluster[i])! > 1) return false;
    const prev = bars[i - 1];
    return (
      hitCount(bar.steps) >= 1.3 * busy ||
      hasToms(bar.steps) ||
      (!!prev && lastBeatHits(bar.steps, division) >= lastBeatHits(prev.steps, division) + 2)
    );
  });
  // Any other one-off bar is a variation of the closest groove, when there's one near enough.
  bars.forEach((bar, i) => {
    if (cluster[i] < 0 || fill[i] || size.get(cluster[i])! > 1) return;
    let best = -1;
    let bestD = Infinity;
    protos.forEach((p, c) => {
      const d = distance(bar.steps, p);
      if (c !== cluster[i] && size.get(c)! > 1 && d <= 2 * tolerance(bar.steps, p) && d < bestD) {
        best = c;
        bestD = d;
      }
    });
    if (best >= 0) cluster[i] = best;
  });

  const numbers = new Map<number, number>();
  bars.forEach((bar, i) => {
    if (cluster[i] < 0) return;
    if (fill[i]) {
      bar.kind = 'fill';
      return;
    }
    if (!numbers.has(cluster[i])) numbers.set(cluster[i], numbers.size);
    bar.kind = 'groove';
    bar.groove = numbers.get(cluster[i])!;
    const prev = bars[i - 1];
    bar.repeat = !!prev && prev.kind === 'groove' && prev.groove === bar.groove;
  });
}

/** Steps hit in at least half the bars, with their mean velocity. */
function majority(bars: DrumBar[]): number[][] {
  const [first] = bars;
  return first.steps.map((lane, l) =>
    lane.map((_, s) => {
      const hits = bars.map((b) => b.steps[l][s]).filter((v) => v > 0);
      return hits.length * 2 >= bars.length ? round(hits.reduce((a, v) => a + v, 0) / hits.length, 10) : 0;
    }),
  );
}

// ---------- road map ----------

export interface DrumSection {
  kind: DrumBar['kind'];
  groove: number;
  /** Index of the first bar, and how many bars. */
  first: number;
  count: number;
  start: number;
  end: number;
  /** Pattern of the section's first bar. */
  steps: number[][];
}

/** The song as a chart: runs of one groove (×count), fills, and rests. */
export function roadMap(bars: DrumBar[]): DrumSection[] {
  const out: DrumSection[] = [];
  bars.forEach((bar, i) => {
    const last = out.at(-1);
    const joins = last && bar.kind !== 'fill' && last.kind === bar.kind && last.groove === bar.groove;
    if (joins) {
      last.count++;
      last.end = bar.end;
    } else out.push({ kind: bar.kind, groove: bar.groove, first: i, count: 1, start: bar.start, end: bar.end, steps: bar.steps });
  });
  return out;
}

/** Lanes with at least one hit anywhere in the song (LANES order). */
export function usedLanes(bars: DrumBar[]): number[] {
  return LANES.map((_, l) => l).filter((l) => bars.some((b) => b.steps[l].some((v) => v > 0)));
}

/**
 * A band's typical loud hit: the median of its steps above a tenth of the top ones. Not the top
 * itself, so a few crashes don't make every hat look quiet; sparse kicks still count.
 */
function loudHit(strength: Float32Array): number {
  const values = Array.from(strength);
  const top = percentile(values, 0.98);
  return percentile(
    values.filter((v) => v > 0.1 * top),
    0.5,
  );
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function round(x: number, scale: number): number {
  return Math.round(x * scale) / scale;
}
