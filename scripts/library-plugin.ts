import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { isAudioFileName, parseStemName, slugify } from '../src/lib/parseStemName.ts';
import type { LibraryManifest } from '../src/lib/types.ts';

const VIRTUAL_ID = 'virtual:library';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

interface Override {
  title?: string;
  bpm?: number;
  offset?: number;
}

/**
 * Scans the library folder and exposes it as `virtual:library` (the manifest).
 * Dev: serves the audio files under `<base>library/`. Build: copies them into `dist/library/`.
 */
export function libraryPlugin({ dir }: { dir: string }): Plugin {
  let config: ResolvedConfig;
  let libDir = '';

  function audioFiles(): string[] {
    if (!fs.existsSync(libDir)) return [];
    return fs.readdirSync(libDir).filter((f) => isAudioFileName(f)).sort();
  }

  function buildManifest(): LibraryManifest {
    const overridesPath = path.join(libDir, 'songs.json');
    const overrides: Record<string, Override> = fs.existsSync(overridesPath)
      ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
      : {};

    const songs = new Map<string, LibraryManifest['songs'][number]>();
    for (const file of audioFiles()) {
      const { songName, stemName } = parseStemName(file);
      const slug = slugify(songName);
      if (!songs.has(slug)) songs.set(slug, { slug, name: songName, stems: [] });
      songs.get(slug)!.stems.push({ name: stemName, file: `library/${encodeURIComponent(file)}` });
    }
    for (const song of songs.values()) {
      const o = overrides[song.slug];
      if (!o) continue;
      if (o.title) song.name = o.title;
      if (typeof o.bpm === 'number') song.bpm = o.bpm;
      if (typeof o.offset === 'number') song.offset = o.offset;
    }
    return { songs: [...songs.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  return {
    name: 'mosaic-library',
    configResolved(c) {
      config = c;
      libDir = path.resolve(c.root, dir);
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      return `export default ${JSON.stringify(buildManifest())};`;
    },
    configureServer(server) {
      server.watcher.add(libDir);
      const reload = (file: string) => {
        if (!path.resolve(file).startsWith(libDir)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
      server.watcher.on('change', reload);

      const prefix = `${config.base}library/`;
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(prefix)) return next();
        const name = path.basename(decodeURIComponent(url.slice(prefix.length)));
        const filePath = path.join(libDir, name);
        if (!isAudioFileName(name) || !fs.existsSync(filePath)) return next();
        const ext = name.split('.').pop()!.toLowerCase();
        const size = fs.statSync(filePath).size;
        res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
        // <audio> can only seek when the server honours Range requests.
        res.setHeader('Accept-Ranges', 'bytes');

        let start = 0;
        let end = size - 1;
        const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
        if (req.headers.range) {
          if (range && (range[1] || range[2])) {
            if (range[1]) {
              start = Number(range[1]);
              if (range[2]) end = Math.min(Number(range[2]), size - 1);
            } else {
              start = Math.max(0, size - Number(range[2])); // suffix range: last N bytes
            }
          }
          if (!range || start > end || start >= size) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${size}`);
            return res.end();
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        }
        res.setHeader('Content-Length', end - start + 1);
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(filePath, { start, end }).pipe(res);
      });
    },
    generateBundle() {
      for (const file of audioFiles()) {
        this.emitFile({ type: 'asset', fileName: `library/${file}`, source: fs.readFileSync(path.join(libDir, file)) });
      }
    },
  };
}
