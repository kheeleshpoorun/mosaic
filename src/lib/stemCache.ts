import type { SongSource } from './types';

/**
 * Library stems kept on the device (Cache Storage), so a song opened once, or downloaded from the
 * home page, plays again with no network. Keyed by the stem URL, which carries a content hash
 * (`?v=`, see library-plugin), so a changed stem is fetched again and the old copy is pruned.
 * Imported songs are never cached. The service worker serves the same cache for `library/*`.
 */
export const STEM_CACHE = 'mosaic-stems';

/** Waits between attempts when the network fails (a flaky connection shouldn't fail the load). */
const RETRY_DELAYS = [1000, 3000, 6000];

export type ByteProgress = (loaded: number, total: number) => void;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const listeners = new Set<() => void>();

/** Called whenever a song's stems are saved or removed. */
export function onStemCacheChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const notify = () => listeners.forEach((fn) => fn());

/** Cache Storage only exists on secure origins (https, localhost). */
function cacheAvailable(): boolean {
  return typeof caches !== 'undefined';
}

const absolute = (url: string) => new URL(url, window.location.href).href;

let persistAsked = false;
/** Asks once that the browser doesn't evict saved songs under storage pressure. */
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  void navigator.storage?.persist?.().catch(() => false);
}

/** A stem's bytes: from the device when saved, else from the network (then saved). */
export async function readCachedStem(url: string, onProgress?: ByteProgress, signal?: AbortSignal): Promise<ArrayBuffer> {
  return (await getStem(url, onProgress, signal)).data;
}

/** `saved` settles once the stem is in the cache (false when it couldn't be stored, e.g. the disk is full). */
async function getStem(url: string, onProgress?: ByteProgress, signal?: AbortSignal) {
  if (cacheAvailable()) {
    try {
      const hit = await caches.match(absolute(url), { cacheName: STEM_CACHE });
      if (hit) {
        const data = await hit.arrayBuffer();
        onProgress?.(data.byteLength, data.byteLength);
        return { data, saved: Promise.resolve(true) };
      }
    } catch {
      // Fall through to the network.
    }
  }
  const { data, type } = await fetchWithRetry(url, onProgress, signal);
  if (!cacheAvailable()) return { data, saved: Promise.resolve(false) };
  // Response copies the bytes now, before decodeAudioData detaches `data`.
  const res = new Response(data, { headers: { 'Content-Type': type, 'Content-Length': String(data.byteLength) } });
  const saved = caches
    .open(STEM_CACHE)
    .then((c) => c.put(absolute(url), res))
    .then(() => {
      askPersist();
      notify();
      return true;
    })
    .catch(() => false);
  return { data, saved };
}

async function fetchWithRetry(url: string, onProgress?: ByteProgress, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchBytes(url, onProgress, signal);
    } catch (e) {
      // Retrying helps a flaky connection, not a missing file or no connection at all.
      const permanent = (e instanceof HttpError && e.status < 500) || signal?.aborted || !navigator.onLine;
      if (permanent || attempt >= RETRY_DELAYS.length) throw e;
      await sleep(RETRY_DELAYS[attempt], signal);
    }
  }
}

async function fetchBytes(url: string, onProgress?: ByteProgress, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new HttpError(res.status);
  const type = res.headers.get('Content-Type') ?? 'application/octet-stream';
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !total) {
    const data = await res.arrayBuffer();
    onProgress?.(data.byteLength, data.byteLength);
    return { data, type };
  }
  // Stream the body so the loader can show bytes arriving on a slow connection.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress?.(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, Math.max(total, loaded));
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { data: bytes.buffer, type };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(id);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// ---------- songs ----------

const stemUrls = (song: SongSource) => song.stems.flatMap((s) => (s.url ? [absolute(s.url)] : []));

/** Saved stem URLs (absolute) with their sizes in bytes. */
export async function savedStems(): Promise<Map<string, number>> {
  const saved = new Map<string, number>();
  if (!cacheAvailable()) return saved;
  try {
    const cache = await caches.open(STEM_CACHE);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      saved.set(req.url, Number(res?.headers.get('Content-Length')) || 0);
    }
  } catch {
    // Storage blocked: nothing saved.
  }
  return saved;
}

export function isSongSaved(song: SongSource, saved: Map<string, number>): boolean {
  const urls = stemUrls(song);
  return urls.length > 0 && urls.every((u) => saved.has(u));
}

/** Fetches and saves every stem of a library song (no decoding). `onProgress` gets 0..1. */
export async function downloadSong(song: SongSource, onProgress?: (fraction: number) => void): Promise<void> {
  const urls = song.stems.flatMap((s) => (s.url ? [s.url] : []));
  const parts = urls.map(() => ({ loaded: 0, total: 0 }));
  const report = () => {
    const total = parts.reduce((a, p) => a + p.total, 0);
    // Stems whose size isn't known yet count as not started.
    const known = parts.filter((p) => p.total > 0).length;
    onProgress?.(total ? (parts.reduce((a, p) => a + p.loaded, 0) / total) * (known / parts.length) : 0);
  };
  const stems = await Promise.all(
    urls.map((url, i) =>
      getStem(url, (loaded, total) => {
        parts[i] = { loaded, total };
        report();
      }),
    ),
  );
  if (!(await Promise.all(stems.map((s) => s.saved))).every(Boolean)) throw new Error('Not enough space on this device');
}

export async function removeSong(song: SongSource): Promise<void> {
  if (!cacheAvailable()) return;
  const cache = await caches.open(STEM_CACHE);
  await Promise.all(stemUrls(song).map((u) => cache.delete(u)));
  notify();
}

/** Drops saved stems that the library no longer has (renamed, removed or re-encoded). */
export async function pruneStemCache(songs: SongSource[]): Promise<void> {
  if (!cacheAvailable()) return;
  try {
    const valid = new Set(songs.flatMap(stemUrls));
    const cache = await caches.open(STEM_CACHE);
    const stale = (await cache.keys()).filter((req) => !valid.has(req.url));
    await Promise.all(stale.map((req) => cache.delete(req)));
  } catch {
    // Not important enough to surface.
  }
}
