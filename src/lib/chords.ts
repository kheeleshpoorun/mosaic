import { QUALITY_INTERVALS, type Chord, type ChordQuality, type SongKey } from '../audio/chords';

const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Major keys written with flats (F, B♭, E♭, A♭, D♭). G♭/F♯ ties go to sharps. */
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1]);
const SUFFIX: Record<Exclude<ChordQuality, 'N'>, string> = { maj: '', min: 'm', '7': '7', maj7: 'maj7', m7: 'm7' };

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function transposeKey(key: SongKey, semitones: number): SongKey {
  return { ...key, tonic: mod12(key.tonic + semitones) };
}

/** Whether a key is written with flats (minor keys follow their relative major). */
function keyUsesFlats(key: SongKey): boolean {
  return FLAT_MAJORS.has(key.mode === 'major' ? key.tonic : mod12(key.tonic + 3));
}

function noteName(pc: number, flats: boolean): string {
  return (flats ? FLATS : SHARPS)[mod12(pc)];
}

/** Key name at the current pitch, e.g. "Am", "B♭", "F♯m". */
export function keyName(key: SongKey, semitones = 0): string {
  const k = transposeKey(key, semitones);
  return noteName(k.tonic, keyUsesFlats(k)) + (k.mode === 'minor' ? 'm' : '');
}

/** Transposes a chord by `semitones` (N stays N). */
export function transposeChord(chord: Chord, semitones: number): Chord {
  return chord.quality === 'N' ? chord : { ...chord, root: mod12(chord.root + semitones) };
}

/**
 * Chord name at the current pitch, spelled to match the (transposed) key so the strip and the key
 * badge always agree. Without a key, D♭ E♭ A♭ B♭ use flats and the rest sharps.
 */
export function chordName(chord: Chord, semitones = 0, key: SongKey | null = null): string {
  if (chord.quality === 'N') return 'N.C.';
  const root = mod12(chord.root + semitones);
  const flats = key ? keyUsesFlats(transposeKey(key, semitones)) : [1, 3, 8, 10].includes(root);
  return noteName(root, flats) + SUFFIX[chord.quality];
}

/** Scale degrees by semitones above the tonic: major keys against the major scale, minor keys against natural minor. */
const DEGREES = {
  major: ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'],
  minor: ['I', '♭II', 'II', 'III', '♯III', 'IV', '♯IV', 'V', 'VI', '♯VI', 'VII', '♯VII'],
};
const NUMERAL_SUFFIX: Record<Exclude<ChordQuality, 'N'>, string> = { maj: '', min: '', '7': '7', maj7: 'maj7', m7: '7' };

/**
 * Roman numeral of a chord in the key (vi IV I V): lowercase for minor chords. The same at any
 * pitch, since chord and key move together.
 */
export function chordNumeral(chord: Chord, key: SongKey): string {
  if (chord.quality === 'N') return 'N.C.';
  const degree = DEGREES[key.mode][mod12(chord.root - key.tonic)];
  const minor = chord.quality === 'min' || chord.quality === 'm7';
  return (minor ? degree.toLowerCase() : degree) + NUMERAL_SUFFIX[chord.quality];
}

/** Pitch classes of the chord, root first. */
export function chordTones({ root, quality }: Chord): number[] {
  return quality === 'N' ? [] : QUALITY_INTERVALS[quality].map((iv) => mod12(root + iv));
}

export interface GuitarShape {
  /** Absolute fret per string, low E → high E; null = not played, 0 = open. */
  frets: (number | null)[];
  /** Barre fret for movable shapes. */
  barre?: number;
}

type Q = Exclude<ChordQuality, 'N'>;
const x = null;

/** Common open-position shapes. */
const OPEN: Record<string, (number | null)[]> = {
  'C maj': [x, 3, 2, 0, 1, 0],
  'C 7': [x, 3, 2, 3, 1, 0],
  'C maj7': [x, 3, 2, 0, 0, 0],
  'D maj': [x, x, 0, 2, 3, 2],
  'D min': [x, x, 0, 2, 3, 1],
  'D 7': [x, x, 0, 2, 1, 2],
  'D maj7': [x, x, 0, 2, 2, 2],
  'D m7': [x, x, 0, 2, 1, 1],
  'E maj': [0, 2, 2, 1, 0, 0],
  'E min': [0, 2, 2, 0, 0, 0],
  'E 7': [0, 2, 0, 1, 0, 0],
  'E maj7': [0, 2, 1, 1, 0, 0],
  'E m7': [0, 2, 0, 0, 0, 0],
  'G maj': [3, 2, 0, 0, 0, 3],
  'G 7': [3, 2, 0, 0, 0, 1],
  'G maj7': [3, 2, 0, 0, 0, 2],
  'A maj': [x, 0, 2, 2, 2, 0],
  'A min': [x, 0, 2, 2, 1, 0],
  'A 7': [x, 0, 2, 0, 2, 0],
  'A maj7': [x, 0, 2, 1, 2, 0],
  'A m7': [x, 0, 2, 0, 1, 0],
  'B 7': [x, 2, 1, 2, 0, 2],
};

/** Movable barre shapes, relative to the barre fret: root on the low E string… */
const E_SHAPE: Record<Q, (number | null)[]> = {
  maj: [0, 2, 2, 1, 0, 0],
  min: [0, 2, 2, 0, 0, 0],
  '7': [0, 2, 0, 1, 0, 0],
  maj7: [0, x, 1, 1, 0, x],
  m7: [0, 2, 0, 0, 0, 0],
};
/** …or on the A string. */
const A_SHAPE: Record<Q, (number | null)[]> = {
  maj: [x, 0, 2, 2, 2, 0],
  min: [x, 0, 2, 2, 1, 0],
  '7': [x, 0, 2, 0, 2, 0],
  maj7: [x, 0, 2, 1, 2, 0],
  m7: [x, 0, 2, 0, 1, 0],
};

/** A playable guitar voicing: an open chord when there's a common one, else the lowest barre shape. */
export function guitarShape(chord: Chord): GuitarShape | null {
  if (chord.quality === 'N') return null;
  const open = OPEN[`${SHARPS[chord.root]} ${chord.quality}`];
  if (open) return { frets: open };
  const e = mod12(chord.root - 4) || 12;
  const a = mod12(chord.root - 9) || 12;
  const [fret, shape] = e <= a ? [e, E_SHAPE[chord.quality]] : [a, A_SHAPE[chord.quality]];
  const frets = shape.map((f) => (f === null ? null : f + fret));
  // A barre only when the index finger really holds down the high E string too.
  return frets[5] === fret ? { frets, barre: fret } : { frets };
}
