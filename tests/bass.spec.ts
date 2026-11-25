import { expect, test } from '@playwright/test';
import {
  BASS_STRINGS,
  BASS_TUNING,
  analyzeBass,
  assignBassFingering,
  bassRoadMap,
  transposeBassMidi,
  type BassAnalysis,
  type BassBar,
} from '../src/audio/bass';
import { analyzeChords, beatGrid } from '../src/audio/chords';
import { engraveBarRhythm, formatBassTabMarkdown } from '../src/lib/bassTab';

const SR = 5512;
const BPM = 100;
const BEAT = 60 / BPM;
const START = 0.5;

interface ToneProfile {
  h1?: number;
  h2?: number;
  h3?: number;
  h4?: number;
  decay?: number;
}

/** Plucked bass tone with natural harmonic brightness decay. */
function pluck(out: Float32Array, midi: number, t0: number, t1: number, amp = 0.5, profile: ToneProfile = {}) {
  const { h1 = 1, h2 = 0.7, h3 = 0.35, h4 = 0.15, decay = 3.2 } = profile;
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const i0 = Math.max(0, Math.round(t0 * SR));
  const i1 = Math.min(out.length, Math.round(t1 * SR));
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SR;
    const attack = Math.min(1, t * 140);
    const body = Math.exp(-t * decay);
    const bright = Math.exp(-t * 14);
    const fadeOut = i1 - i < SR * 0.015 ? (i1 - i) / (SR * 0.015) : 1;
    const w = 2 * Math.PI * f * t;
    const wave = h1 * body * Math.sin(w) + (h2 * Math.sin(2 * w) + h3 * Math.sin(3 * w) + h4 * Math.sin(4 * w)) * bright;
    out[i] += amp * attack * fadeOut * wave;
  }
}

interface SynthNote {
  step: number;
  midi: number;
  dur: number;
}

function synthBars(
  bars: SynthNote[][],
  {
    meter = 4 as 3 | 4,
    division = 4 as 3 | 4,
    swing = false,
    profile = {} as ToneProfile,
    jitter = [] as number[],
  } = {},
) {
  const stepDur = BEAT / division;
  const barDur = meter * BEAT;
  const duration = START + bars.length * barDur + 1;
  const samples = new Float32Array(Math.round(duration * SR));
  let noteIdx = 0;
  bars.forEach((notes, b) => {
    for (const n of notes) {
      const shift = jitter.length ? jitter[noteIdx++ % jitter.length] : 0;
      const t0 = START + b * barDur + n.step * stepDur + shift;
      const t1 = t0 + n.dur * stepDur - 0.01;
      pluck(samples, n.midi, t0, t1, 0.55, profile);
    }
  });
  return {
    samples,
    sampleRate: SR,
    beats: beatGrid(BPM, START, duration - 0.2),
    downbeat: 0,
    meter,
    division,
    swing,
    duration,
  };
}

function barsFromStart(result: BassAnalysis, count: number): BassBar[] {
  const first = result.bars.findIndex((b) => Math.abs(b.start - START) < 0.03);
  return result.bars.slice(first, first + count);
}

test('transcribes a 5-string bassline from B0 (30.87 Hz) up to C3 onto the sixteenth grid', () => {
  // B0(23), E1(28), A1(33), D2(38), G2(43), C3(48)
  const bar1: SynthNote[] = [
    { step: 0, midi: 23, dur: 4 },
    { step: 4, midi: 28, dur: 4 },
    { step: 8, midi: 33, dur: 4 },
    { step: 12, midi: 38, dur: 4 },
  ];
  const bar2: SynthNote[] = [
    { step: 0, midi: 43, dur: 4 },
    { step: 4, midi: 48, dur: 4 },
    { step: 8, midi: 38, dur: 4 },
    { step: 12, midi: 23, dur: 4 },
  ];
  const result = analyzeBass(synthBars([bar1, bar2, bar1, bar2]));
  const [b0, b1] = barsFromStart(result, 2);

  expect(b0.notes.map((n) => [n.step, n.midi])).toEqual([
    [0, 23],
    [4, 28],
    [8, 33],
    [12, 38],
  ]);
  expect(b1.notes.map((n) => [n.step, n.midi])).toEqual([
    [0, 43],
    [4, 48],
    [8, 38],
    [12, 23],
  ]);
  // Check 5-string coordinates match MIDI pitch
  for (const n of [...b0.notes, ...b1.notes]) {
    const open = [43, 38, 33, 28, 23][n.string];
    expect(open + n.fret).toBe(n.midi);
  }
});

test('transcribes weak-fundamental bass tones without octave-up errors', () => {
  const riff: SynthNote[] = [
    { step: 0, midi: 33, dur: 4 }, // A1 = 55 Hz
    { step: 4, midi: 35, dur: 4 }, // B1
    { step: 8, midi: 36, dur: 4 }, // C2
    { step: 12, midi: 28, dur: 4 }, // E1 = 41.2 Hz
  ];
  const result = analyzeBass(
    synthBars([riff, riff, riff], {
      profile: { h1: 0.25, h2: 1.0, h3: 0.6, h4: 0.2, decay: 2.5 },
    }),
  );
  const [b0] = barsFromStart(result, 1);
  expect(b0.notes.map((n) => n.midi)).toEqual([33, 35, 36, 28]);
});

test('transcribes pure sine bass tones without octave-down errors', () => {
  const riff: SynthNote[] = [
    { step: 0, midi: 40, dur: 4 }, // E2 = 82.4 Hz
    { step: 4, midi: 43, dur: 4 }, // G2 = 98 Hz
    { step: 8, midi: 45, dur: 4 }, // A2 = 110 Hz
    { step: 12, midi: 47, dur: 4 }, // B2 = 123.5 Hz
  ];
  const result = analyzeBass(
    synthBars([riff, riff], {
      profile: { h1: 1.0, h2: 0, h3: 0, h4: 0, decay: 2.5 },
    }),
  );
  const [b0] = barsFromStart(result, 1);
  expect(b0.notes.map((n) => n.midi)).toEqual([40, 43, 45, 47]);
});

test('distinguishes repeated eighth notes from a held whole note', () => {
  const eighths: SynthNote[] = [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, midi: 33, dur: 2 }));
  const held: SynthNote[] = [{ step: 0, midi: 33, dur: 16 }];
  const result = analyzeBass(synthBars([eighths, held, eighths, held], { profile: { decay: 1.0 } }));
  const [bEighth, bHeld] = barsFromStart(result, 2);

  expect(bEighth.notes.length).toBeGreaterThanOrEqual(6);
  expect(bEighth.notes.every((n) => n.midi === 33)).toBe(true);
  expect(bHeld.notes.length).toBe(1);
  expect(bHeld.notes[0].midi).toBe(33);
  expect(bHeld.notes[0].duration).toBeGreaterThanOrEqual(12);
});

test('handles swung triplet feel and 3/4 waltz meter', () => {
  const bar3: SynthNote[] = [
    { step: 0, midi: 36, dur: 3 },
    { step: 3, midi: 43, dur: 3 },
    { step: 6, midi: 40, dur: 3 },
  ];
  const result = analyzeBass(synthBars([bar3, bar3, bar3, bar3], { meter: 3, division: 3, swing: true }));
  expect(result.meter).toBe(3);
  expect(result.division).toBe(3);
  expect(result.swing).toBe(true);
  const [b0] = barsFromStart(result, 1);
  expect(b0.beats).toHaveLength(3);
  expect(b0.notes.map((n) => [n.step, n.midi])).toEqual([
    [0, 36],
    [3, 43],
    [6, 40],
  ]);
});

test('event-first metrical quantization snaps human micro-timing jitter to clean 8th notes while preserving true 16th fills', () => {
  const eighths: SynthNote[] = [0, 2, 4, 6, 8, 10, 12, 14].map((step, i) => ({
    step,
    midi: [28, 28, 31, 31, 33, 33, 35, 33][i],
    dur: 2,
  }));
  const jitter = [0.055, -0.05, 0.055, -0.05, 0.05, -0.05, 0.055, -0.045];
  const jittered = analyzeBass(synthBars([eighths, eighths], { jitter }));
  const [b0] = barsFromStart(jittered, 1);
  expect(b0.notes.map((n) => n.step)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  expect(b0.notes.every((n) => n.duration === 2)).toBe(true);

  const fillBar: SynthNote[] = [
    { step: 0, midi: 28, dur: 4 },
    { step: 4, midi: 31, dur: 4 },
    { step: 8, midi: 33, dur: 4 },
    { step: 12, midi: 35, dur: 1 },
    { step: 13, midi: 36, dur: 1 },
    { step: 14, midi: 38, dur: 1 },
    { step: 15, midi: 40, dur: 1 },
  ];
  const withFill = analyzeBass(synthBars([fillBar, fillBar]));
  const [bFill] = barsFromStart(withFill, 1);
  expect(bFill.notes.map((n) => [n.step, n.midi])).toEqual([
    [0, 28],
    [4, 31],
    [8, 33],
    [12, 35],
    [13, 36],
    [14, 38],
    [15, 40],
  ]);
});

test('assignBassFingering chooses compact 5-string positions, octave shapes, and transposes safely', () => {
  const makeBar = (midis: number[]): BassBar => ({
    start: 0,
    end: 2.4,
    beats: [0, 0.6, 1.2, 1.8],
    kind: 'riff',
    riff: 0,
    repeat: false,
    notes: midis.map((midi, idx) => ({ step: idx * 4, midi, string: 0, fret: 0, duration: 4, velocity: 0.8 })),
  });

  // F#1(30), A1(33), B1(35), C#2(37), E2(40), F#2(42) -> stays in 2nd-5th fret box, never 12th fret on B string!
  const assigned = assignBassFingering([makeBar([30, 33, 35, 37, 40, 42])]);
  const notes = assigned[0].notes;
  expect(notes.every((n) => n.fret <= 5)).toBe(true);

  // Classic octave: E1 (E-string fret 0 or A-string? E1 is E-string fret 0, E2 is D-string fret 2 -> string diff 2)
  const octave = assignBassFingering([makeBar([31, 43, 31, 43])])[0].notes; // G1(31) -> G2(43)
  expect(octave[0]).toMatchObject({ string: 3, fret: 3 }); // E string fret 3
  expect(octave[1]).toMatchObject({ string: 1, fret: 5 }); // D string fret 5 (string delta = 2!)

  // Transposition below B0 wraps up an octave into playable 5-string range
  expect(transposeBassMidi(23, -2)).toBe(33); // B0 - 2 -> A1
  const transposed = assignBassFingering([makeBar([28, 35, 40])], -2)[0].notes; // E1 -> D1 (fret 3 on B string)
  expect(transposed[0]).toMatchObject({ midi: 26, string: 4, fret: 3 });
});

test('assignBassFingering keeps natural hand boxes, avoids fret-1-to-4 jumps, remembers position across open strings, and resets across rests', () => {
  const makeSeqBar = (midis: number[], step = 2, beats = [0, 0.6, 1.2, 1.8]): BassBar => ({
    start: 0,
    end: beats.length * 0.6,
    beats,
    kind: midis.length ? 'riff' : 'rest',
    riff: midis.length ? 0 : -1,
    repeat: false,
    notes: midis.map((midi, idx) => ({ step: idx * step, midi, string: 0, fret: 0, duration: step, velocity: 0.8 })),
  });

  // 1. C#m / Ab 4th-7th fret boxes stay compact instead of jumping back to fret 1 across strings.
  const cSharpMinor = assignBassFingering([makeSeqBar([37, 39, 40, 42, 44, 45, 47, 49])])[0].notes;
  expect(cSharpMinor.every((n) => n.fret >= 4 && n.fret <= 7)).toBe(true);
  for (let i = 1; i < cSharpMinor.length; i++) {
    expect(Math.abs(cSharpMinor[i].fret - cSharpMinor[i - 1].fret)).toBeLessThanOrEqual(3);
  }
  const abBox = assignBassFingering([makeSeqBar([32, 34, 37, 39, 42, 44])])[0].notes;
  expect(abBox.every((n) => n.fret >= 4 && n.fret <= 7)).toBe(true);

  // 2. Continuous quarter-note E2 -> E3 -> E2 -> Eb2 stays in 6th-9th position instead of jumping A7 -> D1.
  const quarterStable = assignBassFingering([makeSeqBar([40, 40, 40, 52, 40, 39], 4)])[0].notes;
  expect(quarterStable.slice(3).map((n) => [n.string, n.fret])).toEqual([
    [0, 9],
    [2, 7],
    [2, 6],
  ]);

  // 3. Hand position is remembered across open strings and avoids muddy high B-string frets when E4 fits.
  const acrossOpen = assignBassFingering([makeSeqBar([40, 40, 33, 50, 45, 47, 44])])[0].notes;
  expect(acrossOpen[2]).toMatchObject({ midi: 33, string: 2, fret: 0 });
  expect(acrossOpen.filter((n) => n.fret > 0).every((n) => n.fret >= 6 && n.fret <= 9)).toBe(true);

  const noHighB = assignBassFingering([makeSeqBar([47, 44, 42, 39, 40, 38, 33, 32, 37])])[0].notes;
  expect(noHighB.every((n) => n.fret <= 7)).toBe(true);
  expect(noHighB.some((n) => n.string === 4)).toBe(false);

  const noSplitShift = assignBassFingering([makeSeqBar([40, 33, 52, 40, 33, 40, 42, 42])])[0].notes;
  expect(noSplitShift.filter((n) => n.fret > 0).every((n) => n.fret >= 7 && n.fret <= 9)).toBe(true);

  // 4. Across a full-bar rest, the hand cleanly shifts between a high phrase and a low phrase.
  const restShift = assignBassFingering([makeSeqBar([48, 50, 52, 50], 4), makeSeqBar([], 4), makeSeqBar([29, 31, 33, 31], 4)]);
  expect(restShift[0].notes.every((n) => n.fret >= 5)).toBe(true);
  expect(restShift[2].notes.every((n) => n.fret <= 3)).toBe(true);

  // 5. Triplet division=3 and 4-string mode produce valid E-A-D-G coordinates.
  const triplet = assignBassFingering([makeSeqBar([36, 40, 43, 36], 3)], 0, 4, 3)[0].notes;
  expect(triplet.every((n) => n.string >= 0 && n.string <= 3 && BASS_TUNING[n.string] + n.fret === n.midi)).toBe(true);
});

test('clusters repeated riffs, detects fills, handles silence/noise, and builds road map', () => {
  const grooveA: SynthNote[] = [
    { step: 0, midi: 28, dur: 4 },
    { step: 4, midi: 28, dur: 4 },
    { step: 8, midi: 31, dur: 4 },
    { step: 12, midi: 33, dur: 4 },
  ];
  const grooveB: SynthNote[] = [
    { step: 0, midi: 36, dur: 4 },
    { step: 4, midi: 36, dur: 4 },
    { step: 8, midi: 35, dur: 4 },
    { step: 12, midi: 33, dur: 4 },
  ];
  const fill: SynthNote[] = [
    { step: 0, midi: 28, dur: 2 },
    { step: 2, midi: 31, dur: 2 },
    { step: 4, midi: 33, dur: 2 },
    { step: 6, midi: 35, dur: 2 },
    { step: 8, midi: 36, dur: 2 },
    { step: 10, midi: 38, dur: 2 },
    { step: 12, midi: 40, dur: 1 },
    { step: 13, midi: 41, dur: 1 },
    { step: 14, midi: 43, dur: 1 },
    { step: 15, midi: 45, dur: 1 },
  ];
  const result = analyzeBass(synthBars([grooveA, grooveA, grooveA, fill, grooveB, grooveB, grooveA]));
  const bars = barsFromStart(result, 7);
  expect(bars.map((b) => (b.kind === 'riff' ? (b.repeat ? '%' : `r${b.riff}`) : b.kind))).toEqual(['r0', '%', '%', 'fill', 'r1', '%', 'r0']);

  const map = bassRoadMap(bars, 16);
  expect(map.map((s) => [s.kind, s.riff, s.count])).toEqual([
    ['riff', 0, 3],
    ['fill', -1, 1],
    ['riff', 1, 2],
    ['riff', 0, 1],
  ]);

  // Silence -> all rests
  const silent = analyzeBass({
    samples: new Float32Array(SR * 5),
    sampleRate: SR,
    beats: beatGrid(BPM, 0.3, 5),
    downbeat: 0,
    duration: 5,
  });
  expect(silent.bars.every((b) => b.kind === 'rest' && b.notes.length === 0)).toBe(true);

  // Pure random noise -> no false pitched notes
  const noise = new Float32Array(SR * 5);
  let seed = 42;
  for (let i = 0; i < noise.length; i++) noise[i] = (((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1) * 0.25;
  const noisy = analyzeBass({
    samples: noise,
    sampleRate: SR,
    beats: beatGrid(BPM, 0.3, 5),
    downbeat: 0,
    duration: 5,
  });
  expect(noisy.bars.every((b) => b.notes.length === 0)).toBe(true);
});

test('formatBassTabMarkdown formats 5-string B-E-A-D-G tabs with key, BPM, chords, bar numbers, and two-digit spacing', () => {
  const analysis: BassAnalysis = {
    meter: 4,
    division: 4,
    swing: false,
    bars: [
      {
        start: 0,
        end: 2.4,
        beats: [0, 0.6, 1.2, 1.8],
        kind: 'riff',
        riff: 0,
        repeat: false,
        notes: [
          { step: 0, midi: 55, string: 0, fret: 12, duration: 1, velocity: 0.9 },
          { step: 1, midi: 57, string: 0, fret: 14, duration: 1, velocity: 0.9 },
          { step: 8, midi: 23, string: 4, fret: 0, duration: 4, velocity: 0.8 },
        ],
      },
      {
        start: 2.4,
        end: 4.8,
        beats: [2.4, 3.0, 3.6, 4.2],
        kind: 'riff',
        riff: 1,
        repeat: false,
        notes: [{ step: 0, midi: 28, string: 3, fret: 0, duration: 8, velocity: 0.8 }],
      },
    ],
  };

  const chords = analyzeChords({
    harmonic: new Float32Array(SR * 5),
    bass: null,
    sampleRate: SR,
    beats: [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2],
    duration: 4.8,
  });
  chords.key = { tonic: 4, mode: 'minor', confidence: 1 };
  chords.segments = [
    { root: 4, quality: 'min', start: 0, end: 2.4 },
    { root: 0, quality: 'maj', start: 2.4, end: 4.8 },
  ];

  const md = formatBassTabMarkdown({
    title: 'Sample Track',
    analysis,
    chords,
    bpm: 100,
    pitch: 0,
  });

  expect(md).toContain('# Sample Track — Bass Tablature');
  expect(md).toContain('**Tuning:** 5-string standard (B–E–A–D–G)');
  expect(md).toContain('**Key:** Em');
  expect(md).toContain('**Tempo:** 100 BPM');
  expect(md).toContain('**Time:** 4/4 (Straight)');
  expect(md).toContain('### Bars 1–2');
  expect(md).toContain('Em');
  expect(md).toContain('C');
  // Adjacent two-digit frets get colWidth = 3 so 12 and 14 are separated as 12-14-
  expect(md).toContain('G|-12-14-');
  for (const s of BASS_STRINGS) expect(md).toContain(`\n${s}|`);
  expect(md).toContain('1  e  &  a  2  e  &  a');

  // 4-string E-A-D-G export omits B string and shifts sub-E1 notes up an octave
  const md4 = formatBassTabMarkdown({
    title: 'Sample Track',
    analysis,
    chords,
    bpm: 100,
    pitch: 0,
    strings: 4,
  });
  expect(md4).toContain('**Tuning:** 4-string standard (E–A–D–G)');
  expect(md4).toContain('\nG|');
  expect(md4).toContain('\nE|');
  expect(md4).not.toContain('\nB|');
});

test('assignBassFingering maps 4-string E-A-D-G without B string and wraps sub-E1 notes up', () => {
  const bar: BassBar = {
    start: 0,
    end: 2.4,
    beats: [0, 0.6, 1.2, 1.8],
    kind: 'riff',
    riff: 0,
    repeat: false,
    notes: [
      { step: 0, midi: 23, string: 4, fret: 0, duration: 4, velocity: 0.8 }, // B0 -> B1 (35) on A2/E7
      { step: 4, midi: 26, string: 4, fret: 3, duration: 4, velocity: 0.8 }, // D1 -> D2 (38) on D0/A5
      { step: 8, midi: 28, string: 3, fret: 0, duration: 4, velocity: 0.8 }, // E1 -> E1 (28) on E0
    ],
  };

  expect(transposeBassMidi(23, 0, 4)).toBe(35);
  const four = assignBassFingering([bar], 0, 4)[0].notes;
  expect(four.every((n) => n.string >= 0 && n.string <= 3)).toBe(true);
  expect(four[0].midi).toBe(35);
  expect(four[1].midi).toBe(38);
  expect(four[2]).toMatchObject({ midi: 28, string: 3, fret: 0 });
});

test('engraveBarRhythm produces Songsterr 16th beams, stub beamlets, dots, half/whole stems, and beat rests', () => {
  const makeNotes = (specs: [number, number][]): BassBar => ({
    start: 0,
    end: 2.4,
    beats: [0, 0.6, 1.2, 1.8],
    kind: 'riff',
    riff: 0,
    repeat: false,
    notes: specs.map(([step, duration]) => ({ step, midi: 28, string: 3, fret: 0, duration, velocity: 0.8 })),
  });

  // Beat 1: four continuous 16ths (Hysteria style), Beat 2: dotted-8th + 16th stub, Beat 3: half note, Beat 4: sustained
  const r = engraveBarRhythm(
    makeNotes([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 3],
      [7, 1],
      [8, 8],
    ]),
    4,
  );
  expect(r.primaryBeams).toEqual([
    { fromStep: 0, toStep: 3 },
    { fromStep: 4, toStep: 7 },
  ]);
  expect(r.secondaryBeams).toEqual([
    { fromStep: 0, toStep: 3 },
    { fromStep: 7, toStep: 7, stub: 'left' },
  ]);
  expect(r.stems.find((s) => s.step === 4)?.dotted).toBe(true);
  expect(r.stems.find((s) => s.step === 8)).toMatchObject({ kind: 'half', dotted: false, flags: 0 });
  expect(r.restBeats).toEqual([]);

  // Whole note: no stem, no rests; quarter note + silent beats: quarter rests on beats 2 & 3
  const whole = engraveBarRhythm(makeNotes([[0, 16]]), 4);
  expect(whole.stems).toEqual([{ step: 0, kind: 'none', dotted: false, flags: 0 }]);
  expect(whole.restBeats).toEqual([]);

  const sparse = engraveBarRhythm(
    makeNotes([
      [0, 4],
      [12, 2],
    ]),
    4,
  );
  expect(sparse.restBeats).toEqual([1, 2]);
  expect(sparse.stems.find((s) => s.step === 12)?.flags).toBe(1);
});

test('detects upward and downward bass slides, keeps slides on the same fretted string, and formats / and \\ in tabs', () => {
  /** Continuous phase-integrated bass glissando from midi0 to midi1 between [glideStart, glideEnd]. */
  function slidePluck(out: Float32Array, midi0: number, midi1: number, t0: number, glideStart: number, glideEnd: number, t1: number, amp = 0.55) {
    const i0 = Math.max(0, Math.round(t0 * SR));
    const i1 = Math.min(out.length, Math.round(t1 * SR));
    let phase = 0;
    for (let i = i0; i < i1; i++) {
      const absT = i / SR;
      const relT = (i - i0) / SR;
      const u = absT <= glideStart ? 0 : absT >= glideEnd ? 1 : (absT - glideStart) / Math.max(1e-4, glideEnd - glideStart);
      const midi = midi0 + (midi1 - midi0) * u;
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      phase += (2 * Math.PI * f) / SR;
      const attack = Math.min(1, relT * 140);
      const body = Math.exp(-relT * 1.1);
      const bright = Math.exp(-relT * 6);
      const fadeOut = i1 - i < SR * 0.015 ? (i1 - i) / (SR * 0.015) : 1;
      const wave = body * Math.sin(phase) + (0.7 * Math.sin(2 * phase) + 0.35 * Math.sin(3 * phase)) * bright;
      out[i] += amp * attack * fadeOut * wave;
    }
  }

  const stepDur = BEAT / 4;
  const barDur = 4 * BEAT;
  const duration = START + 3 * barDur + 1;
  const samples = new Float32Array(Math.round(duration * SR));

  // Bar 0 step 15 -> Bar 1 step 0: pickup F1 (29) sliding up to A1 (33 = 5th fret on E string, never open A0)
  const b0End = START + barDur;
  slidePluck(samples, 29, 33, b0End - stepDur, b0End - 0.02, b0End + 0.16, START + 2 * barDur - 0.08);

  // Bar 2: E2 (40) on beat 1 sliding down to C#2 (37) on beat 3 on the A string (7 \ 4)
  const b2Start = START + 2 * barDur;
  slidePluck(samples, 40, 37, b2Start, b2Start + 1.55 * BEAT, b2Start + 2.05 * BEAT, b2Start + 3.8 * BEAT);

  const result = analyzeBass({
    samples,
    sampleRate: SR,
    beats: beatGrid(BPM, START, duration - 0.2),
    downbeat: 0,
    meter: 4,
    division: 4,
    swing: false,
    duration,
  });

  const [b0, b1, b2] = barsFromStart(result, 3);
  expect(b0.notes.at(-1)).toMatchObject({ midi: 29, string: 3, fret: 1 });
  expect(b1.notes[0]).toMatchObject({ step: 0, midi: 33, string: 3, fret: 5, slide: 'up' });

  expect(b2.notes[0]).toMatchObject({ step: 0, midi: 40, string: 2, fret: 7 });
  const downNote = b2.notes.find((n) => n.midi === 37);
  expect(downNote).toMatchObject({ midi: 37, string: 2, fret: 4, slide: 'down' });

  const md = formatBassTabMarkdown({
    title: 'Slide Test',
    analysis: { meter: 4, division: 4, swing: false, bars: [b0, b1, b2] },
    bpm: BPM,
  });
  expect(md).toContain('|/5');
  expect(md).toContain('\\4');
});

test('simplifies busy bass stems by rejecting percussive ghost thumps, attack scoops, and unplucked release sags', () => {
  const stepDur = BEAT / 4;
  const barDur = 4 * BEAT;
  const duration = START + 2 * barDur + 1;
  const samples = new Float32Array(Math.round(duration * SR));

  for (let b = 0; b < 2; b++) {
    const base = START + b * barDur;
    // Step 2: A1 (33) followed by a quiet, unplucked 1-semitone release sag on step 3
    pluck(samples, 33, base + 2 * stepDur, base + 3.1 * stepDur, 0.58);
    const sagStart = Math.round((base + 3.1 * stepDur) * SR);
    const sagEnd = Math.round((base + 3.85 * stepDur) * SR);
    const fSag = 440 * Math.pow(2, (32 - 69) / 12);
    for (let i = sagStart; i < sagEnd; i++) {
      const t = (i - sagStart) / SR;
      samples[i] += 0.14 * Math.exp(-t * 12) * Math.sin(2 * Math.PI * fSag * t);
    }

    // Step 4: B1 (35) preceded by a 45ms 1-semitone attack transient scoop from Bb1 (34)
    const scoop0 = Math.round((base + 4 * stepDur) * SR);
    const main1 = Math.round((base + 5.8 * stepDur) * SR);
    let phase = 0;
    for (let i = scoop0; i < main1; i++) {
      const rel = (i - scoop0) / SR;
      const m = rel < 0.045 ? 34 : 35;
      const f = 440 * Math.pow(2, (m - 69) / 12);
      phase += (2 * Math.PI * f) / SR;
      const env = Math.min(1, rel * 160) * Math.exp(-rel * 2.8);
      samples[i] += 0.56 * env * (Math.sin(phase) + 0.65 * Math.sin(2 * phase));
    }

    // Step 7: Percussive finger-mute thump (unpitched low-frequency burst)
    let seed = 101 + b;
    const thump0 = Math.round((base + 7 * stepDur) * SR);
    const thump1 = Math.round((base + 7.55 * stepDur) * SR);
    for (let i = thump0; i < thump1; i++) {
      const rel = (i - thump0) / SR;
      const white = (((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1);
      samples[i] += 0.38 * Math.exp(-rel * 28) * white;
    }

    // Step 10: Clean sustained C#2 (37)
    pluck(samples, 37, base + 10 * stepDur, base + 13 * stepDur, 0.58);
  }

  const result = analyzeBass({
    samples,
    sampleRate: SR,
    beats: beatGrid(BPM, START, duration - 0.2),
    downbeat: 0,
    meter: 4,
    division: 4,
    swing: false,
    duration,
  });

  const [b0] = barsFromStart(result, 1);
  expect(b0.notes.map((n) => [n.step, n.midi])).toEqual([
    [2, 33],
    [4, 35],
    [10, 37],
  ]);
});
