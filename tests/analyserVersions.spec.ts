import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ANALYSERS, analyserSources, analyserVersions } from '../scripts/analyser-versions';

const root = process.cwd();
const rel = (files: string[]) => files.map((f) => path.relative(root, f).replace(/\\/g, '/'));

test('each cached analysis is versioned by every source it runs, worker included', () => {
  const versions = analyserVersions(root);
  expect(Object.keys(versions).sort()).toEqual(['beats', 'chords', 'drums']);
  for (const v of Object.values(versions)) expect(v).toMatch(/^[0-9a-f]{8}$/);
  expect(new Set(Object.values(versions)).size).toBe(3);

  expect(rel(analyserSources(root, ANALYSERS.beats))).toEqual(['src/audio/beats.ts', 'src/audio/beats.worker.ts', 'src/audio/bpm.ts']);
  // The drum transcriber borrows the FFT from the chord recogniser, so a change there re-runs drums too.
  expect(rel(analyserSources(root, ANALYSERS.drums))).toEqual(
    expect.arrayContaining(['src/audio/drumDetect.ts', 'src/audio/drums.ts', 'src/audio/drums.worker.ts', 'src/audio/mixDown.ts', 'src/audio/chords.ts']),
  );
});

test('changing an analyser changes its version, and only for the analyses that use it', () => {
  // A copy of the analysers, so the real sources are never touched.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-versions-'));
  try {
    fs.cpSync(path.join(root, 'src/audio'), path.join(tmp, 'src/audio'), { recursive: true });
    const before = analyserVersions(tmp);
    expect(before).toEqual(analyserVersions(root));

    // Line endings alone don't count (Windows checkouts and CI agree).
    const drums = path.join(tmp, 'src/audio/drums.ts');
    fs.writeFileSync(drums, fs.readFileSync(drums, 'utf8').replace(/\r?\n/g, '\r\n'));
    expect(analyserVersions(tmp)).toEqual(before);

    fs.appendFileSync(drums, '\n// changed\n');
    const after = analyserVersions(tmp);
    expect(after.drums).not.toBe(before.drums);
    expect(after.beats).toBe(before.beats);
    expect(after.chords).toBe(before.chords);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
