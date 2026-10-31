import { expect, test } from '@playwright/test';
import { analyzeChords, beatGrid, type Chord, type ChordQuality } from '../src/audio/chords';
import { chordName, chordTones, guitarShape, keyName } from '../src/lib/chords';

const SR = 11025;
const BPM = 100;
const BEAT = 60 / BPM;

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const INTERVALS: Record<Exclude<ChordQuality, 'N'>, number[]> = { maj: [0, 4, 7], min: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };

function parse(name: string): Chord {
  const m = /^([A-G][b#]?)(.*)$/.exec(name)!;
  const quality = ({ '': 'maj', m: 'min', '7': '7', maj7: 'maj7', m7: 'm7' } as Record<string, ChordQuality>)[m[2]];
  return { root: NOTE[m[1]], quality };
}

/** Adds a harmonic-rich tone (decaying partials, piano-ish envelope) to `out`. */
function tone(out: Float32Array, midi: number, t0: number, t1: number, amp: number) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const i0 = Math.round(t0 * SR);
  const i1 = Math.min(out.length, Math.round(t1 * SR));
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SR;
    const env = Math.min(1, t * 200) * (0.6 + 0.4 * Math.exp(-t * 3));
    let s = 0;
    for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * t) / h;
    out[i] += amp * env * s;
  }
}

/** Plays a progression (chord names, `beatsEach` beats per chord) as harmonic + bass stems. */
function synth(progression: string[], beatsEach = 4, start = 0.5) {
  const seconds = start + progression.length * beatsEach * BEAT + 1;
  const harmonic = new Float32Array(Math.round(seconds * SR));
  const bass = new Float32Array(harmonic.length);
  const truth: { chord: Chord; start: number; end: number }[] = [];
  progression.forEach((name, i) => {
    const chord = parse(name);
    const t0 = start + i * beatsEach * BEAT;
    const t1 = t0 + beatsEach * BEAT;
    truth.push({ chord, start: t0, end: t1 });
    // Voiced from middle C upwards, root doubled an octave below.
    for (const iv of INTERVALS[chord.quality as Exclude<ChordQuality, 'N'>]) tone(harmonic, 60 + ((chord.root + iv) % 12), t0, t1, 0.08);
    tone(harmonic, 48 + chord.root, t0, t1, 0.06);
    for (let b = 0; b < beatsEach; b++) tone(bass, 36 + chord.root, t0 + b * BEAT, t0 + (b + 1) * BEAT, 0.2);
  });
  const beats = beatGrid(BPM, start, seconds);
  return { harmonic, bass, beats, duration: seconds, truth };
}

/** Fraction of beats (inside the progression) whose detected chord matches the truth. */
function accuracy(result: ReturnType<typeof analyzeChords>, truth: ReturnType<typeof synth>['truth']) {
  let ok = 0;
  let total = 0;
  for (const seg of truth) {
    for (let t = seg.start + BEAT / 2; t < seg.end; t += BEAT) {
      total++;
      const found = result.segments.find((s) => s.start <= t && t < s.end);
      if (found && found.root === seg.chord.root && found.quality === seg.chord.quality) ok++;
    }
  }
  return ok / total;
}

test('recognises a major/minor progression with a seventh', () => {
  const song = synth(['C', 'Am', 'F', 'G7', 'C', 'Am', 'F', 'G7']);
  const result = analyzeChords({ ...song, sampleRate: SR });
  expect(accuracy(result, song.truth)).toBeGreaterThanOrEqual(0.9);
});

test('tells sevenths from triads', () => {
  const song = synth(['Cmaj7', 'Dm7', 'G7', 'Cmaj7', 'Am', 'Dm7', 'G', 'C']);
  const result = analyzeChords({ ...song, sampleRate: SR });
  expect(accuracy(result, song.truth)).toBeGreaterThanOrEqual(0.9);
});

test('works without a bass stem', () => {
  const song = synth(['Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D']);
  const result = analyzeChords({ ...song, bass: null, sampleRate: SR });
  expect(accuracy(result, song.truth)).toBeGreaterThanOrEqual(0.9);
});

test('silence is "no chord" and has no key', () => {
  const harmonic = new Float32Array(SR * 10);
  const result = analyzeChords({ harmonic, bass: null, sampleRate: SR, beats: beatGrid(BPM, 0.3, 10), duration: 10 });
  expect(result.segments.every((s) => s.quality === 'N')).toBe(true);
  expect(result.key).toBeNull();
});

test('noise has no key', () => {
  const harmonic = new Float32Array(SR * 10);
  let seed = 7;
  for (let i = 0; i < harmonic.length; i++) harmonic[i] = (((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1) * 0.2;
  const result = analyzeChords({ harmonic, bass: null, sampleRate: SR, beats: beatGrid(BPM, 0.3, 10), duration: 10 });
  expect(result.key).toBeNull();
});

test('detects a major key', () => {
  const song = synth(['C', 'F', 'G', 'C', 'Am', 'F', 'G', 'C']);
  const { key } = analyzeChords({ ...song, sampleRate: SR });
  expect(key).toMatchObject({ tonic: 0, mode: 'major' });
});

test('tells a minor key from its relative major', () => {
  // Same notes as C major apart from the G♯ in E7.
  const song = synth(['Am', 'Dm', 'E7', 'Am', 'Am', 'Dm', 'E7', 'Am']);
  const { key } = analyzeChords({ ...song, sampleRate: SR });
  expect(key).toMatchObject({ tonic: 9, mode: 'minor' });
});

test('key names follow the pitch and spell sharps or flats like the key', () => {
  expect(keyName({ tonic: 9, mode: 'minor', confidence: 1 }, 2)).toBe('Bm');
  expect(keyName({ tonic: 0, mode: 'major', confidence: 1 }, 3)).toBe('E♭');
  expect(keyName({ tonic: 2, mode: 'major', confidence: 1 }, 4)).toBe('F♯');
  expect(keyName({ tonic: 0, mode: 'minor', confidence: 1 })).toBe('Cm');
});

test('chord names transpose and follow the key spelling', () => {
  const cMajor = { tonic: 0, mode: 'major' as const, confidence: 1 };
  expect(chordName({ root: 0, quality: 'maj' }, 2, cMajor)).toBe('D');
  // A♭ major: B♭m, not A♯m.
  expect(chordName({ root: 10, quality: 'min' }, 0, { tonic: 8, mode: 'major', confidence: 1 })).toBe('B♭m');
  // E major: G♯m7, not A♭m7.
  expect(chordName({ root: 8, quality: 'm7' }, 0, { tonic: 4, mode: 'major', confidence: 1 })).toBe('G♯m7');
  expect(chordName({ root: 7, quality: '7' }, 0, cMajor)).toBe('G7');
  expect(chordName({ root: 5, quality: 'maj7' }, -1, cMajor)).toBe('Emaj7');
  expect(chordName({ root: -1, quality: 'N' }, 3, cMajor)).toBe('N.C.');
});

test('every chord has a guitar shape that plays its notes', () => {
  const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];
  for (const quality of ['maj', 'min', '7', 'maj7', 'm7'] as const) {
    for (let root = 0; root < 12; root++) {
      const chord = { root, quality };
      const shape = guitarShape(chord)!;
      expect(shape.frets).toHaveLength(6);
      const played = shape.frets.flatMap((f, s) => (f === null ? [] : [(OPEN_STRINGS[s] + f) % 12]));
      const tones = chordTones(chord);
      // Only chord tones, and all of them (the fifth may be left out, as in open C7).
      expect(played.every((pc) => tones.includes(pc)), chordName(chord)).toBe(true);
      expect(tones.filter((pc, i) => i !== 2 && !played.includes(pc)), chordName(chord)).toEqual([]);
      // Lowest sounding note is the root.
      expect(played[0]).toBe(root);
      expect(Math.max(...shape.frets.map((f) => f ?? 0))).toBeLessThanOrEqual(15);
    }
  }
});
