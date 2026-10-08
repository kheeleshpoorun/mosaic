import { isAudioFileName, parseStemName, slugify } from './parseStemName';
import { sortStems } from './stemMeta';
import type { SongSource } from './types';

/** Groups dropped/selected audio files into songs using the Moises "<Song>_<stem>_mixed" naming. */
export function songsFromFiles(files: File[]): SongSource[] {
  const groups = new Map<string, SongSource>();
  for (const file of files) {
    if (!isAudioFileName(file.name)) continue;
    const { songName, stemName } = parseStemName(file.name);
    const key = slugify(songName) || 'imported';
    if (!groups.has(key)) {
      groups.set(key, { id: `import-${key}-${Date.now().toString(36)}`, name: songName, shareable: false, stems: [] });
    }
    groups.get(key)!.stems.push({ name: stemName, file });
  }
  return [...groups.values()].map((g) => ({ ...g, stems: sortStems(g.stems) }));
}

/** Collects files from a drop, including files inside dropped folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items]
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return [...dt.files];
  const out: File[] = [];
  await Promise.all(entries.map((e) => walk(e, out)));
  return out;
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) break;
      await Promise.all(batch.map((e) => walk(e, out)));
    }
  }
}
