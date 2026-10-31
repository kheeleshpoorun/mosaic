import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:analyser-versions';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/** Entry point of each analysis whose results are cached in localStorage (see src/lib/analysisCache.ts). */
export const ANALYSERS = {
  beats: 'src/audio/bpm.ts',
  chords: 'src/audio/chordDetect.ts',
  drums: 'src/audio/drumDetect.ts',
} as const;

export type AnalyserKind = keyof typeof ANALYSERS;

/** Relative imports, dynamic imports and worker URLs (`new URL('./x.worker.ts', import.meta.url)`). */
const LOCAL = /(?:from\s+|import\s*\(\s*|new URL\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

/** The entry and every local file it reaches, sorted. */
export function analyserSources(root: string, entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(LOCAL)) {
      const target = path.resolve(path.dirname(file), spec);
      visit(/\.tsx?$/.test(target) ? target : `${target}.ts`);
    }
  };
  visit(path.resolve(root, entry));
  return [...seen].sort();
}

/**
 * A short hash of each analyser's sources (line endings normalised, so Windows and CI agree). Any
 * change to an analyser changes its cache keys, so results of an older one are never read back.
 */
export function analyserVersions(root: string): Record<AnalyserKind, string> {
  const out = {} as Record<AnalyserKind, string>;
  for (const kind of Object.keys(ANALYSERS) as AnalyserKind[]) {
    const hash = createHash('sha1');
    for (const file of analyserSources(root, ANALYSERS[kind])) hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    out[kind] = hash.digest('hex').slice(0, 8);
  }
  return out;
}

/** Exposes analyserVersions() as `virtual:analyser-versions`; in dev, recomputed when an analyser changes. */
export function analyserVersionsPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'mosaic-analyser-versions',
    configResolved(c) {
      root = c.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      return `export default ${JSON.stringify(analyserVersions(root))};`;
    },
    configureServer(server) {
      const audioDir = path.resolve(root, 'src/audio');
      server.watcher.on('change', (file) => {
        if (!path.resolve(file).startsWith(audioDir)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
      });
    },
  };
}
