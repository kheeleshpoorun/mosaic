import rawManifest from 'virtual:library';
import { sortStems } from './stemMeta';
import type { LibraryManifest, SongSource } from './types';

const manifest = rawManifest as LibraryManifest;

export const librarySongs: SongSource[] = manifest.songs.map((s) => ({
  id: s.slug,
  name: s.name,
  shareable: true,
  bpm: s.bpm,
  offset: s.offset,
  stems: sortStems(s.stems.map((st) => ({ name: st.name, url: import.meta.env.BASE_URL + st.file }))),
}));

export function shareUrl(song: SongSource): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.searchParams.set('song', song.id);
  return url.toString();
}
