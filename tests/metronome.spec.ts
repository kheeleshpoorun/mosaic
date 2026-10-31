import { expect, test } from '@playwright/test';
import { metronomeGain, renderClick } from '../src/audio/metronome';

test('click is a short, peak-normalised tick', () => {
  const sr = 44100;
  const click = renderClick(sr);
  expect(click.length / sr).toBeLessThanOrEqual(0.05);
  const peak = click.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  expect(peak).toBeCloseTo(1, 5);
  // Almost all of the energy lands in the first 15 ms, so it reads as one sharp tick.
  const energy = (a: Float32Array) => a.reduce((s, x) => s + x * x, 0);
  expect(energy(click.subarray(0, Math.round(sr * 0.015))) / energy(click)).toBeGreaterThan(0.9);
});

test('metronome volume boosts above unity at the top of the slider', () => {
  expect(metronomeGain(0)).toBe(0);
  expect(metronomeGain(0.5)).toBeCloseTo(1, 5);
  expect(metronomeGain(1)).toBeCloseTo(4, 5);
  expect(metronomeGain(2)).toBeCloseTo(4, 5);
});
