/**
 * Chord and key recognition for the chord strip.
 *
 * 1. Chroma: STFT of the harmonic stems (everything but drums and vocals) folded onto 12 pitch
 *    classes, magnitudes square-root compressed (scale-free). A separate bass chroma comes from the
 *    bass stem, which gives a clean root that a plain mixdown can't.
 * 2. Beat-synchronous: chroma frames are averaged between consecutive tracked beats. Chords change
 *    on beats, and averaging per beat removes most of the noise.
 * 3. Templates: 12 roots × maj, min, 7, maj7, m7 (with decaying harmonics) scored by correlation,
 *    plus a bonus when the bass plays the root. Sevenths pay a small penalty so a triad wins unless
 *    the 7th is clearly there. Quiet or flat (noise-like) beats become N (no chord).
 * 4. Viterbi smoothing: every chord change costs a fixed penalty, so labels don't flicker.
 * 5. Key: Krumhansl–Kessler profiles on the song's chroma, plus the chords themselves (diatonic
 *    coverage, tonic and dominant time, first/last chord). The chords are what tell C major from
 *    A minor, which profiles alone often get wrong.
 *
 * Pure function of the samples so it can be unit-tested with synthetic audio.
 */

export type ChordQuality = 'maj' | 'min' | '7' | 'maj7' | 'm7' | 'N';

export interface Chord {
  /** Pitch class 0 = C … 11 = B; -1 for N. */
  root: number;
  quality: ChordQuality;
}

export interface ChordSegment extends Chord {
  start: number;
  end: number;
}

export interface SongKey {
  tonic: number;
  mode: 'major' | 'minor';
  /** Score margin over the runner-up key (usually the relative major/minor). */
  confidence: number;
}

export interface ChordAnalysis {
  segments: ChordSegment[];
  key: SongKey | null;
}

export interface ChordInput {
  /** Mono mix of the harmonic stems. */
  harmonic: Float32Array;
  /** Mono bass stem, same rate (null when the song has no bass stem). */
  bass: Float32Array | null;
  sampleRate: number;
  /** Beat times in seconds of track time. */
  beats: number[];
  duration: number;
}

export const QUALITY_INTERVALS: Record<Exclude<ChordQuality, 'N'>, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
};
const QUALITIES = Object.keys(QUALITY_INTERVALS) as Exclude<ChordQuality, 'N'>[];

const HARMONIC_FFT = 4096;
/** 50% overlap. */
const HOP = 2048;
/** The bass is analysed at a quarter of the rate: same resolution and hop for a 4× smaller FFT. */
const BASS_DECIMATION = 4;
const HARMONIC_RANGE: [number, number] = [100, 2000];
const BASS_RANGE: [number, number] = [35, 260];
const SEVENTH_PENALTY = 0.04;
const BASS_BONUS = 0.2;
/** Score of "no chord"; a chord has to beat it to be shown. */
const N_SCORE = 0.25;
/** Cost of each chord change in the Viterbi path. */
const CHANGE_PENALTY = 0.15;

export function analyzeChords({ harmonic, bass, sampleRate, beats, duration }: ChordInput): ChordAnalysis {
  const bounds = beatBounds(beats, duration);
  const n = bounds.length - 1;
  if (n < 1) return { segments: [], key: null };

  const hc = beatChroma(chromagram(harmonic, sampleRate, HARMONIC_FFT, HOP, HARMONIC_RANGE), bounds);
  const bc = bass
    ? beatChroma(
        chromagram(decimate(bass, BASS_DECIMATION), sampleRate / BASS_DECIMATION, (2 * HARMONIC_FFT) / BASS_DECIMATION, HOP / BASS_DECIMATION, BASS_RANGE),
        bounds,
      )
    : null;
  const energy = beatRms(harmonic, sampleRate, bounds);
  const bassEnergy = bass ? relative(beatRms(bass, sampleRate, bounds)) : null;
  const level = relative(energy);

  const templates = chordTemplates();
  const states = templates.length + 1; // last state = N
  const scores: Float64Array[] = [];
  for (let b = 0; b < n; b++) {
    const s = new Float64Array(states);
    const c = hc[b];
    const silent = energy[b] < 1e-4 || level[b] < 0.1;
    const peak = peakiness(c);
    const bn = bc ? normMax(bc[b]) : null;
    const bassW = bassEnergy ? Math.min(1, bassEnergy[b] * 2) * peakiness(bc![b]) : 0;
    templates.forEach((t, i) => {
      let v = peak * correlation(c, t.vector);
      if (bn) v += BASS_BONUS * bassW * bn[t.chord.root];
      if (t.chord.quality !== 'maj' && t.chord.quality !== 'min') v -= SEVENTH_PENALTY;
      s[i] = silent ? -1 : v;
    });
    s[states - 1] = silent ? 1 : N_SCORE;
    scores.push(s);
  }

  const path = viterbi(scores, CHANGE_PENALTY);
  const label = (i: number): Chord => (i === states - 1 ? { root: -1, quality: 'N' } : templates[i].chord);
  const segments: ChordSegment[] = [];
  path.forEach((st, b) => {
    const last = segments.at(-1);
    const c = label(st);
    if (last && last.root === c.root && last.quality === c.quality) last.end = bounds[b + 1];
    else segments.push({ ...c, start: bounds[b], end: bounds[b + 1] });
  });

  return { segments, key: detectKey(segments, hc, bounds, path, states - 1, duration) };
}

/** Fixed beat grid for songs without tracked beats. */
export function beatGrid(bpm: number, offset: number, duration: number): number[] {
  const period = 60 / bpm;
  const out: number[] = [];
  for (let t = ((offset % period) + period) % period; t < duration; t += period) out.push(t);
  return out;
}

/** Interval boundaries: 0, every beat inside the song, duration. */
function beatBounds(beats: number[], duration: number): number[] {
  const out = [0];
  for (const b of beats) if (b > out.at(-1)! + 0.05 && b < duration - 0.05) out.push(b);
  if (duration > out.at(-1)!) out.push(duration);
  return out;
}

// ---------- chroma ----------

interface Chromagram {
  /** frames × 12, row-major. */
  data: Float32Array;
  /** Centre time of each frame. */
  times: Float64Array;
}

function chromagram(x: Float32Array, sampleRate: number, size: number, hop: number, [fmin, fmax]: [number, number]): Chromagram {
  const frames = Math.max(1, Math.floor((x.length - size) / hop) + 1);
  const data = new Float32Array(frames * 12);
  const times = new Float64Array(frames);
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);

  // Bin → pitch class, weighted by how close the bin is to the semitone centre.
  const kLo = Math.max(1, Math.floor((fmin * size) / sampleRate));
  const kHi = Math.min(size / 2 - 1, Math.ceil((fmax * size) / sampleRate));
  const binPc = new Int8Array(kHi + 1);
  const binW = new Float32Array(kHi + 1);
  for (let k = kLo; k <= kHi; k++) {
    const midi = 69 + 12 * Math.log2((k * sampleRate) / size / 440);
    const r = Math.round(midi);
    binPc[k] = ((r % 12) + 12) % 12;
    binW[k] = Math.max(0, 1 - 2 * Math.abs(midi - r));
  }

  const fft = new FFT(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const load = (buf: Float64Array, f: number) => {
    const start = f * hop;
    const end = f < frames ? Math.min(size, x.length - start) : 0;
    for (let i = 0; i < size; i++) buf[i] = i < end ? x[start + i] * win[i] : 0;
  };
  // Two real frames per complex FFT: frame f in the real part, frame f + 1 in the imaginary part.
  for (let f = 0; f < frames; f += 2) {
    load(re, f);
    load(im, f + 1);
    fft.transform(re, im);
    const rowA = f * 12;
    const rowB = rowA + 12;
    const hasB = f + 1 < frames;
    for (let k = kLo; k <= kHi; k++) {
      if (!binW[k]) continue;
      const zr = re[k];
      const zi = im[k];
      const wr = re[size - k];
      const wi = im[size - k];
      // Square-root compressed magnitude: |X|^0.5 = power^0.25.
      const a = (zr + wr) * (zr + wr) + (zi - wi) * (zi - wi);
      data[rowA + binPc[k]] += binW[k] * Math.sqrt(Math.sqrt(a / 4));
      if (hasB) {
        const b = (zi + wi) * (zi + wi) + (zr - wr) * (zr - wr);
        data[rowB + binPc[k]] += binW[k] * Math.sqrt(Math.sqrt(b / 4));
      }
    }
  }
  for (let f = 0; f < frames; f++) times[f] = (f * hop + size / 2) / sampleRate;
  return { data, times };
}

/** Box-filter decimation by an integer factor. */
function decimate(x: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(Math.ceil(x.length / factor));
  for (let i = 0; i < x.length; i++) out[(i / factor) | 0] += x[i] / factor;
  return out;
}

/** Mean chroma per beat interval (the nearest frame when an interval holds none). */
function beatChroma({ data, times }: Chromagram, bounds: number[]): Float64Array[] {
  const out: Float64Array[] = [];
  let f = 0;
  for (let b = 0; b < bounds.length - 1; b++) {
    const c = new Float64Array(12);
    while (f < times.length && times[f] < bounds[b]) f++;
    let count = 0;
    for (let g = f; g < times.length && times[g] < bounds[b + 1]; g++, count++) {
      for (let p = 0; p < 12; p++) c[p] += data[g * 12 + p];
    }
    if (!count) {
      const g = Math.min(times.length - 1, f);
      for (let p = 0; p < 12; p++) c[p] = data[g * 12 + p];
    }
    out.push(c);
  }
  return out;
}

function beatRms(x: Float32Array, sampleRate: number, bounds: number[]): Float64Array {
  const out = new Float64Array(bounds.length - 1);
  for (let b = 0; b < out.length; b++) {
    const i0 = Math.floor(bounds[b] * sampleRate);
    const i1 = Math.min(x.length, Math.floor(bounds[b + 1] * sampleRate));
    let s = 0;
    for (let i = i0; i < i1; i++) s += x[i] * x[i];
    out[b] = i1 > i0 ? Math.sqrt(s / (i1 - i0)) : 0;
  }
  return out;
}

/** Values relative to their median (0 when everything is silent). */
function relative(v: Float64Array): Float64Array {
  const sorted = Array.from(v).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median > 0 ? v.map((x) => x / median) : v.map(() => 0);
}

/** 0 for a flat (noise-like) chroma, 1 for a clearly peaked one. */
function peakiness(c: Float64Array): number {
  let mean = 0;
  for (const v of c) mean += v / 12;
  if (mean <= 0) return 0;
  let varSum = 0;
  for (const v of c) varSum += (v - mean) ** 2;
  const cv = Math.sqrt(varSum / 12) / mean;
  return Math.max(0, Math.min(1, (cv - 0.15) / 0.35));
}

function normMax(c: Float64Array): Float64Array {
  const m = Math.max(...c);
  return m > 0 ? c.map((v) => v / m) : c;
}

function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i] / 12;
    mb += b[i] / 12;
  }
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

// ---------- templates & smoothing ----------

function chordTemplates(): { chord: Chord; vector: Float64Array }[] {
  const out: { chord: Chord; vector: Float64Array }[] = [];
  for (const quality of QUALITIES) {
    for (let root = 0; root < 12; root++) {
      const vector = new Float64Array(12);
      for (const iv of QUALITY_INTERVALS[quality]) {
        // A sung or played note also lights up its harmonics (octave, fifth, third…).
        for (let h = 1; h <= 5; h++) {
          const pc = (root + iv + Math.round(12 * Math.log2(h))) % 12;
          vector[pc] += Math.pow(0.6, h - 1);
        }
      }
      out.push({ chord: { root, quality }, vector });
    }
  }
  return out;
}

/** Best state sequence when every change of state costs `penalty`. */
function viterbi(scores: Float64Array[], penalty: number): number[] {
  const states = scores[0].length;
  const back: Int32Array[] = [];
  let prev = Float64Array.from(scores[0]);
  for (let t = 1; t < scores.length; t++) {
    let best = 0;
    for (let s = 1; s < states; s++) if (prev[s] > prev[best]) best = s;
    const cur = new Float64Array(states);
    const bp = new Int32Array(states);
    for (let s = 0; s < states; s++) {
      const stay = prev[s];
      const move = prev[best] - penalty;
      bp[s] = stay >= move ? s : best;
      cur[s] = Math.max(stay, move) + scores[t][s];
    }
    back.push(bp);
    prev = cur;
  }
  let s = 0;
  for (let i = 1; i < states; i++) if (prev[i] > prev[s]) s = i;
  const path = [s];
  for (let t = back.length - 1; t >= 0; t--) path.push((s = back[t][s]));
  return path.reverse();
}

// ---------- key ----------

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
/** Natural minor plus the raised 7th (harmonic minor's V/V7). */
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11];

function detectKey(
  segments: ChordSegment[],
  chroma: Float64Array[],
  bounds: number[],
  path: number[],
  nState: number,
  duration: number,
): SongKey | null {
  const chords = segments.filter((s) => s.quality !== 'N');
  const total = chords.reduce((a, s) => a + s.end - s.start, 0);
  if (!chords.length || total < 0.1 * duration) return null;

  const profile = new Float64Array(12);
  chroma.forEach((c, b) => {
    if (path[b] === nState) return;
    const sum = c.reduce((a, v) => a + v, 0) || 1;
    const d = bounds[b + 1] - bounds[b];
    for (let p = 0; p < 12; p++) profile[p] += (c[p] / sum) * d;
  });

  const candidates: { tonic: number; mode: 'major' | 'minor'; score: number }[] = [];
  for (const mode of ['major', 'minor'] as const) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const kk = (mode === 'major' ? KK_MAJOR : KK_MINOR).map((_, i, p) => p[(i - tonic + 12) % 12]);
      const scale = new Set((mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).map((i) => (tonic + i) % 12));
      const isTonic = (c: Chord) => c.root === tonic && (mode === 'major' ? c.quality === 'maj' || c.quality === 'maj7' : c.quality === 'min' || c.quality === 'm7');
      const isDominant = (c: Chord) => c.root === (tonic + 7) % 12 && (c.quality === 'maj' || c.quality === '7');
      let diatonic = 0;
      let tonicTime = 0;
      let dominant = 0;
      for (const s of chords) {
        const d = (s.end - s.start) / total;
        if (QUALITY_INTERVALS[s.quality as Exclude<ChordQuality, 'N'>].every((iv) => scale.has((s.root + iv) % 12))) diatonic += d;
        if (isTonic(s)) tonicTime += d;
        if (isDominant(s)) dominant += d;
      }
      const score =
        correlation(profile, kk) +
        diatonic +
        1.5 * tonicTime +
        0.5 * dominant +
        (isTonic(chords[0]) ? 0.25 : 0) +
        (isTonic(chords.at(-1)!) ? 0.25 : 0);
      candidates.push({ tonic, mode, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const [best, second] = candidates;
  return { tonic: best.tonic, mode: best.mode, confidence: Math.round((best.score - second.score) * 1000) / 1000 };
}

// ---------- FFT ----------

/** In-place iterative radix-2 FFT (size must be a power of two). */
export class FFT {
  private rev: Uint32Array;
  private cos: Float64Array;
  private sin: Float64Array;

  constructor(private size: number) {
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
  }

  transform(re: Float64Array, im: Float64Array) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        const r = re[i];
        re[i] = re[j];
        re[j] = r;
        const m = im[i];
        im[i] = im[j];
        im[j] = m;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}
