import { expect, test } from '@playwright/test';
import { PEAK_BUCKETS, computePeaks } from '../src/audio/peaks';

const SR = 22050;

test('silence → tone → silence gives a flat start and end and a full middle', () => {
  const samples = new Float32Array(SR * 9);
  for (let i = SR * 3; i < SR * 6; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
  const peaks = computePeaks([samples, samples]);

  expect(peaks).toHaveLength(PEAK_BUCKETS);
  expect(peaks.every((v) => v >= 0 && v <= 1)).toBe(true);
  const third = PEAK_BUCKETS / 3;
  expect(Math.max(...peaks.slice(0, third - 2))).toBe(0);
  expect(Math.max(...peaks.slice(2 * third + 2))).toBe(0);
  expect(Math.min(...peaks.slice(third + 2, 2 * third - 2))).toBeGreaterThan(0.95);
});

test('quieter passages draw lower but stay visible', () => {
  const samples = new Float32Array(SR * 4);
  for (let i = 0; i < samples.length; i++) samples[i] = (i < SR * 2 ? 0.5 : 0.05) * Math.sin((2 * Math.PI * 220 * i) / SR);
  const peaks = computePeaks([samples], 100);
  // 20 dB quieter on a 48 dB scale.
  expect(peaks[10]).toBeCloseTo(1, 2);
  expect(peaks[90]).toBeGreaterThan(0.5);
  expect(peaks[90]).toBeLessThan(0.7);
});

test('pure silence and empty input give all zeros', () => {
  expect(Array.from(computePeaks([new Float32Array(SR)], 50))).toEqual(Array(50).fill(0));
  expect(Array.from(computePeaks([new Float32Array(0)], 10))).toEqual(Array(10).fill(0));
});
