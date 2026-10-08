import { expect, test } from '@playwright/test';
import { analyzeBeats } from '../src/audio/beats';

const SR = 22050;

/** Kick on every beat + hi-hat on every eighth note, with the tempo drifting from `from` to `to` BPM. */
function synthDrums(seconds: number, from: number, to: number, start = 0.4) {
  const out = new Float32Array(SR * seconds);
  const beats: number[] = [];
  let seed = 1;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const hit = (t: number, kick: boolean) => {
    const i0 = Math.round(t * SR);
    const len = Math.round(SR * (kick ? 0.12 : 0.02));
    for (let i = 0; i < len && i0 + i < out.length; i++) {
      const env = Math.exp(-i / (SR * (kick ? 0.03 : 0.004)));
      out[i0 + i] += kick ? 0.8 * env * Math.sin((2 * Math.PI * 60 * i) / SR) : 0.25 * env * noise();
    }
  };
  for (let t = start; t < seconds - 0.5; ) {
    const bpm = from + ((to - from) * t) / seconds;
    const period = 60 / bpm;
    beats.push(t);
    hit(t, true);
    hit(t, false);
    hit(t + period / 2, false);
    t += period;
  }
  return { samples: out, beats };
}

test('tracks a drifting tempo without accumulating error', () => {
  const { samples, beats: truth } = synthDrums(60, 92, 96);
  const { beats, bpm } = analyzeBeats([samples], SR);
  expect(bpm).toBeGreaterThan(90);
  expect(bpm).toBeLessThan(98);

  const errors = truth
    .filter((t) => t > 3 && t < 57)
    .map((t) => Math.min(...beats.map((b) => Math.abs(b - t))));
  // Every real beat has a click within 20 ms — including at the end, where a fixed grid would have drifted.
  expect(Math.max(...errors)).toBeLessThan(0.02);
});

test('prefers the quarter-note pulse over eighth-note hi-hats', () => {
  const { samples } = synthDrums(30, 80, 80);
  expect(analyzeBeats([samples], SR).bpm).toBeCloseTo(80, 0);
});

test('accents the downbeat with the strongest kick', () => {
  const { samples, beats: truth } = synthDrums(30, 100, 100);
  // Make every 4th beat (starting at beat 2) a much louder kick.
  for (let k = 2; k < truth.length; k += 4) {
    const i0 = Math.round(truth[k] * SR);
    for (let i = 0; i < SR * 0.1; i++) samples[i0 + i] += 0.8 * Math.exp(-i / (SR * 0.03)) * Math.sin((2 * Math.PI * 55 * i) / SR);
  }
  const { beats, downbeat } = analyzeBeats([samples], SR);
  const accentTime = beats[downbeat];
  const phase = truth.findIndex((t) => Math.abs(t - accentTime) < 0.03) % 4;
  expect(phase).toBe(2);
});
