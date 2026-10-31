import type { Chord, ChordSegment } from '../audio/chords';

/**
 * Chord chart of a song: the chords laid out bar by bar (as a musician writes them), and the song
 * map of progressions (a phrase of bars and how many times it plays in a row). Pure, unit-tested.
 */

export interface BarSpan {
  start: number;
  end: number;
  /** Start of each beat of the bar. */
  beats: number[];
}

export interface ChartChord extends Chord {
  /** Beat of the bar the chord starts on, and how many beats it lasts. */
  beat: number;
  length: number;
}

export interface ChartBar extends BarSpan {
  /** Chords in order; N (no chord) included when it shares the bar with a chord. */
  chords: ChartChord[];
  /** No chord at all in the bar. */
  empty: boolean;
  /** Same chords as the bar right before it: shown as a repeat sign. */
  repeat: boolean;
}

export interface ChordSection {
  /** First bar, bars per phrase, and how many times the phrase plays in a row. */
  first: number;
  length: number;
  count: number;
  start: number;
  end: number;
  /** The phrase's chords, consecutive duplicates and N left out (empty for a section with no chords). */
  chords: Chord[];
}

/** Bars of `meter` beats from the first downbeat (`beats[downbeat]`); the pickup bar is extrapolated. */
export function barsFromBeats(beats: number[], downbeat: number, meter: number, duration: number): BarSpan[] {
  if (beats.length < 2) return [];
  const pre = (((meter - downbeat) % meter) + meter) % meter;
  const times = [...beats];
  for (let i = 0; i < pre; i++) times.unshift(2 * times[0] - times[1]);
  while (times.length % meter !== 1) times.push(2 * times.at(-1)! - times.at(-2)!);
  const bars: BarSpan[] = [];
  for (let b = 0; b * meter + meter < times.length; b++) {
    const start = times[b * meter];
    if (start >= duration) break;
    bars.push({ start: Math.max(0, start), end: Math.min(duration, times[b * meter + meter]), beats: times.slice(b * meter, b * meter + meter) });
  }
  return bars;
}

const same = (a: Chord, b: Chord) => a.root === b.root && a.quality === b.quality;

/** Chord heard over most of [t0, t1). */
function chordOver(segments: ChordSegment[], t0: number, t1: number): Chord {
  let best: Chord = { root: -1, quality: 'N' };
  let most = 0;
  for (const s of segments) {
    if (s.end <= t0) continue;
    if (s.start >= t1) break;
    const overlap = Math.min(s.end, t1) - Math.max(s.start, t0);
    if (overlap > most) {
      most = overlap;
      best = s;
    }
  }
  return { root: best.root, quality: best.quality };
}

const signature = (bar: ChartBar) => bar.chords.map((c) => `${c.beat}:${c.root}${c.quality}`).join(' ');

/** Each bar's chords, beat by beat. */
export function chordChart(segments: ChordSegment[], bars: BarSpan[]): ChartBar[] {
  const out: ChartBar[] = [];
  for (const bar of bars) {
    const chords: ChartChord[] = [];
    bar.beats.forEach((t, j) => {
      const c = chordOver(segments, Math.max(0, t), bar.beats[j + 1] ?? bar.end);
      const last = chords.at(-1);
      if (last && same(last, c)) last.length++;
      else chords.push({ ...c, beat: j, length: 1 });
    });
    const empty = chords.every((c) => c.quality === 'N');
    const chart: ChartBar = { ...bar, chords: empty ? [] : chords, empty, repeat: false };
    const prev = out.at(-1);
    chart.repeat = !empty && !!prev && !prev.empty && signature(prev) === signature(chart);
    out.push(chart);
  }
  return out;
}

/** Phrase lengths tried, longest first, so a 4-bar progression isn't cut into 2-bar halves. */
const PHRASES = [8, 4, 2, 1];
/** Bars that don't repeat are grouped up to this many per section. */
const LOOSE = 4;

function samePhrase(bars: ChartBar[], a: number, b: number, length: number): boolean {
  for (let k = 0; k < length; k++) {
    const x = bars[a + k];
    const y = bars[b + k];
    if (!x || !y || x.empty || y.empty || signature(x) !== signature(y)) return false;
  }
  return true;
}

/** Shortest period of a phrase (so "Am F Am F" ×2 reads as "Am F" ×4). */
function period(bars: ChartBar[], first: number, length: number): number {
  for (const p of [1, 2, 4]) {
    if (p >= length || length % p) continue;
    let ok = true;
    for (let k = p; k < length && ok; k += p) ok = samePhrase(bars, first, first + k, p);
    if (ok) return p;
  }
  return length;
}

function phraseChords(bars: ChartBar[], first: number, length: number): Chord[] {
  const out: Chord[] = [];
  for (let k = first; k < first + length; k++)
    for (const c of bars[k].chords) {
      if (c.quality === 'N') continue;
      const last = out.at(-1);
      if (!last || !same(last, c)) out.push({ root: c.root, quality: c.quality });
    }
  return out;
}

/** Song map: runs of a repeated phrase (×count), loose bars grouped, and stretches with no chords. */
export function progressions(bars: ChartBar[]): ChordSection[] {
  const out: ChordSection[] = [];
  let i = 0;
  while (i < bars.length) {
    const last = out.at(-1);
    if (bars[i].empty) {
      if (last && !last.chords.length) {
        last.length++;
        last.end = bars[i].end;
      } else out.push({ first: i, length: 1, count: 1, start: bars[i].start, end: bars[i].end, chords: [] });
      i++;
      continue;
    }
    const length = PHRASES.find((l) => samePhrase(bars, i, i + l, l));
    if (length) {
      const p = period(bars, i, length);
      let count = 1;
      while (samePhrase(bars, i, i + count * p, p)) count++;
      out.push({ first: i, length: p, count, start: bars[i].start, end: bars[i + count * p - 1].end, chords: phraseChords(bars, i, p) });
      i += count * p;
      continue;
    }
    // A bar that doesn't start a repeat: grouped with the loose bars before it.
    if (last && last.count === 1 && last.chords.length && last.first + last.length === i && last.length < LOOSE) {
      last.length++;
      last.end = bars[i].end;
      last.chords = phraseChords(bars, last.first, last.length);
    } else out.push({ first: i, length: 1, count: 1, start: bars[i].start, end: bars[i].end, chords: phraseChords(bars, i, 1) });
    i++;
  }
  return out;
}

/** Distinct chords of the song, in order of first appearance. */
export function songChords(segments: ChordSegment[]): Chord[] {
  const out: Chord[] = [];
  for (const s of segments) if (s.quality !== 'N' && !out.some((c) => same(c, s))) out.push({ root: s.root, quality: s.quality });
  return out;
}
