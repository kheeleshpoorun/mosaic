import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Build only: emits `sw.js` from src/sw.js with the precache list (every built file and public
 * file, but not library audio, which the app caches per song) and a version hash prepended.
 */
export function swPlugin(): Plugin {
  let config: ResolvedConfig;

  function publicFiles(dir = config.publicDir, prefix = ''): string[] {
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? publicFiles(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
    );
  }

  return {
    name: 'mosaic-sw',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      config = c;
    },
    generateBundle(_, bundle) {
      const hash = createHash('sha1');
      const files = new Set<string>(['index.html']);
      for (const [name, chunk] of Object.entries(bundle)) {
        if (name.startsWith('library/') || name.endsWith('.map')) continue;
        files.add(name);
        hash.update(name).update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      }
      for (const name of publicFiles()) {
        files.add(name);
        hash.update(name).update(fs.readFileSync(path.join(config.publicDir, name)));
      }
      const base = config.base;
      const precache = [...files].sort().map((f) => base + f);
      const source = fs.readFileSync(path.resolve(config.root, 'src/sw.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source:
          `const PRECACHE = ${JSON.stringify(precache)};\n` +
          `const VERSION = ${JSON.stringify(hash.digest('hex').slice(0, 10))};\n` +
          `const BASE = ${JSON.stringify(base)};\n` +
          source,
      });
    },
  };
}
