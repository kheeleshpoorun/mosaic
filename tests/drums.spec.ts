import { expect, test } from '@playwright/test';
import { beatGrid } from '../src/audio/chords';
import { LANES, analyzeDrums, roadMap, usedLanes, type DrumAnalysis, type DrumLane } from '../src/audio/drums';

const SR = 22050;
const BPM = 100;
const BEAT = 60 / BPM;
const START = 0.5;

/** c crash, o open hat, h hat, t high tom, s snare, g ghost snare, f low (floor) tom, k kick. */
type Voice = 'c' | 'o' | 'h' | 't' | 's' | 'g' | 'f' | 'k';
/** One bar: per voice, a step string ('x' = hit, '.' = rest), one char per step. */
type Bar = Partial<Record<Voice, string>>;

const ROCK: Bar = { h: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', k: 'x.......x.......' };
const HALF: Bar = { h: 'x.x.x.x.x.x.x.x.', s: '........x.......', k: 'x.....x...x.....' };
const FILL: Bar = { h: 'x.x.x.x.x.x.x.x.', s: 'xxxxxxxxxxxxxxxx', k: 'x...............' };

function drumKit() {
  let seed = 1;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const sine = (out: Float32Array, t: number, f: number, amp: number, tau: number) => {
    const i0 = Math.round(t * SR);
    for (let i = 0; i < SR * tau * 4 && i0 + i < out.length; i++) out[i0 + i] += amp * Math.exp(-i / (SR * tau)) * Math.sin((2 * Math.PI * f * i) / SR);
  };
  /** Second difference of noise ≈ a steep high-pass: all sizzle, no body. */
  const sizzle = (out: Float32Array, t: number, amp: number, tau: number) => {
    const i0 = Math.round(t * SR);
    let a = 0;
    let b = 0;
    for (let i = 0; i < SR * tau * 5 && i0 + i < out.length; i++) {
      const n = noise();
      out[i0 + i] += amp * Math.exp(-i / (SR * tau)) * (n - 2 * a + b);
      b = a;
      a = n;
    }
  };
  const snare = (out: Float32Array, t: number, amp: number) => {
    const i0 = Math.round(t * SR);
    for (let i = 0; i < SR * 0.12 && i0 + i < out.length; i++) {
      const env = amp * Math.exp(-i / (SR * 0.03));
      out[i0 + i] += env * (0.35 * noise() + 0.4 * Math.sin((2 * Math.PI * 220 * i) / SR));
    }
  };
  return {
    k: (out: Float32Array, t: number) => sine(out, t, 60, 0.8, 0.04),
    f: (out: Float32Array, t: number) => sine(out, t, 130, 0.6, 0.08),
    t: (out: Float32Array, t: number) => sine(out, t, 260, 0.5, 0.06),
    s: (out: Float32Array, t: number) => snare(out, t, 1),
    g: (out: Float32Array, t: number) => snare(out, t, 0.3),
    h: (out: Float32Array, t: number) => sizzle(out, t, 0.12, 0.008),
    o: (out: Float32Array, t: number) => sizzle(out, t, 0.12, 0.15),
    c: (out: Float32Array, t: number) => sizzle(out, t, 0.2, 0.6),
  };
}

/** Renders bars of `meter` beats; `swing` moves every off-beat eighth to that fraction of the beat. */
function synth(bars: Bar[], { meter = 4, swing = 0.5 } = {}) {
  const steps = meter * 4;
  const duration = START + bars.length * meter * BEAT + 1;
  const samples = new Float32Array(Math.round(duration * SR));
  const kit = drumKit();
  bars.forEach((bar, b) => {
    for (const voice of Object.keys(bar) as Voice[]) {
      for (let s = 0; s < steps; s++) {
        if (bar[voice]![s] !== 'x') continue;
        const pos = s % 4 === 2 ? swing : (s % 4) / 4;
        kit[voice](samples, START + (b * meter + Math.floor(s / 4) + pos) * BEAT);
      }
    }
  });
  return { samples, sampleRate: SR, beats: beatGrid(BPM, START, duration - 0.5), downbeat: 0, duration };
}

/** Bar steps of `lane` as a string: x hit, g ghost note, . rest. */
function lane(result: DrumAnalysis, bar: number, name: DrumLane) {
  return result.bars[bar].steps[LANES.indexOf(name)].map((v) => (v >= 0.4 ? 'x' : v > 0 ? 'g' : '.')).join('');
}

/** Bars from START (the song's first bar), skipping the empty trailing one(s). */
function from(result: DrumAnalysis, count: number) {
  const first = result.bars.findIndex((b) => Math.abs(b.start - START) < 0.02);
  return result.bars.slice(first, first + count);
}

/** Bars as kind/groove/repeat shorthand: 'g0', '%' (repeat), 'fill', 'rest'. */
function shape(result: DrumAnalysis, count: number) {
  return from(result, count).map((b) => (b.kind === 'groove' ? (b.repeat ? '%' : `g${b.groove}`) : b.kind));
}

test('transcribes a rock beat onto the sixteenth grid, and repeated bars as repeats', () => {
  const result = analyzeDrums(synth([ROCK, ROCK, ROCK, ROCK]));
  expect(result).toMatchObject({ meter: 4, division: 4, swing: false });
  expect(shape(result, 4)).toEqual(['g0', '%', '%', '%']);
  const bar = result.bars.indexOf(from(result, 1)[0]);
  expect(lane(result, bar, 'kick')).toBe(ROCK.k);
  expect(lane(result, bar, 'snare')).toBe(ROCK.s);
  expect(lane(result, bar, 'hat')).toBe(ROCK.h);
  expect(usedLanes(result.bars).map((l) => LANES[l])).toEqual(['hat', 'snare', 'kick']);
});

test('a new groove starts a new section, and a busy one-off bar is a fill', () => {
  const result = analyzeDrums(synth([ROCK, ROCK, ROCK, FILL, HALF, HALF, HALF, HALF, ROCK]));
  expect(shape(result, 9)).toEqual(['g0', '%', '%', 'fill', 'g1', '%', '%', '%', 'g0']);
  const map = roadMap(result.bars).filter((s) => s.kind !== 'rest');
  expect(map.map((s) => [s.kind, s.groove, s.count])).toEqual([
    ['groove', 0, 3],
    ['fill', -1, 1],
    ['groove', 1, 4],
    ['groove', 0, 1],
  ]);
});

test('hat variations stay the same groove', () => {
  const busyHats: Bar = { ...ROCK, h: 'xxxxxxxxxxxxxxxx' };
  const result = analyzeDrums(synth([ROCK, ROCK, busyHats, busyHats, ROCK]));
  expect(shape(result, 5)).toEqual(['g0', '%', '%', '%', '%']);
});

test('detects toms in a fill', () => {
  const toms: Bar = { h: 'x.x.x.x.........', s: '....x...........', t: '........xxxx....', f: '............xxxx', k: 'x...............' };
  const result = analyzeDrums(synth([ROCK, ROCK, ROCK, toms, ROCK]));
  expect(shape(result, 5)).toEqual(['g0', '%', '%', 'fill', 'g0']);
  const bar = result.bars.indexOf(from(result, 4)[3]);
  expect(lane(result, bar, 'highTom')).toBe(toms.t);
  expect(lane(result, bar, 'lowTom')).toBe(toms.f);
  expect(lane(result, bar, 'snare')).toBe(toms.s);
  expect(lane(result, bar, 'kick')).toBe(toms.k);
});

test('tells a crash and an open hat from closed hats', () => {
  // Hats pick up on beat 2: one right under a fresh crash is masked by its ring (to the ear, too).
  const accents: Bar = { c: 'x...............', o: '..............x.', h: '....x.x.x.x.x...', s: ROCK.s, k: ROCK.k };
  const result = analyzeDrums(synth([accents, ROCK, accents, ROCK]));
  const bar = result.bars.indexOf(from(result, 1)[0]);
  expect(lane(result, bar, 'crash')).toBe(accents.c);
  expect(lane(result, bar, 'openHat')).toBe(accents.o);
  expect(lane(result, bar, 'hat')).toBe(accents.h);
  expect(usedLanes(result.bars).map((l) => LANES[l])).toEqual(['crash', 'openHat', 'hat', 'snare', 'kick']);
  // Cymbal choices don't make it a different groove.
  expect(shape(result, 4)).toEqual(['g0', '%', '%', '%']);
});

test('keeps ghost notes, without letting them change the groove', () => {
  const ghosts: Bar = { ...ROCK, g: '.x.....x.x....x.' };
  const result = analyzeDrums(synth([ROCK, ghosts, ghosts, ROCK]));
  expect(shape(result, 4)).toEqual(['g0', '%', '%', '%']);
  const bar = result.bars.indexOf(from(result, 2)[1]);
  expect(lane(result, bar, 'snare')).toBe('.g..x..g.g..x.g.');
});

test('a swung song gets a triplet grid', () => {
  const result = analyzeDrums(synth(Array(6).fill(ROCK), { swing: 2 / 3 }));
  expect(result).toMatchObject({ swing: true, division: 3 });
  const bar = result.bars.indexOf(from(result, 1)[0]);
  expect(result.bars[bar].steps[0]).toHaveLength(12);
  expect(lane(result, bar, 'hat')).toBe('x.xx.xx.xx.x');
  expect(lane(result, bar, 'snare')).toBe('...x.....x..');
});

test('bars follow the downbeat, with a pickup bar before it', () => {
  const result = analyzeDrums({ ...synth([ROCK, ROCK, ROCK]), downbeat: 1 });
  // Beat 0 at START is now the last beat of a pickup bar; the bars start one beat later.
  expect(result.bars[0].beats).toHaveLength(4);
  expect(result.bars[1].start).toBeCloseTo(START + BEAT, 2);
});

test('recognises 3/4 from a waltz pattern', () => {
  const waltz: Bar = { h: 'x...x...x...', s: '....x...x...', k: 'x...........' };
  const result = analyzeDrums(synth(Array(8).fill(waltz), { meter: 3 }));
  expect(result.meter).toBe(3);
  expect(shape(result, 8)).toEqual(['g0', ...Array(7).fill('%')]);
  const bar = result.bars.indexOf(from(result, 1)[0]);
  expect(lane(result, bar, 'kick')).toBe(waltz.k);
});

test('silence is all rest', () => {
  const result = analyzeDrums(synth([{}, {}, {}]));
  expect(result.bars.every((b) => b.kind === 'rest')).toBe(true);
  expect(roadMap(result.bars)).toHaveLength(1);
});

test('too few beats gives an empty analysis', () => {
  expect(analyzeDrums({ samples: new Float32Array(SR), sampleRate: SR, beats: [0.5], downbeat: 0, duration: 1 }).bars).toEqual([]);
});
