// Shared by the browser app and the Vite library plugin (Node) — keep it dependency-free.

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm'];

export interface ParsedStemName {
  songName: string;
  stemName: string;
}

export function isAudioFileName(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.includes(ext);
}

/**
 * Moises exports stems as "<Song name>_<stem>_mixed.mp3".
 * Also accepts "<Song>_<stem>.mp3" and "<Song> - <stem>.mp3".
 */
export function parseStemName(fileName: string): ParsedStemName {
  let base = fileName.replace(/\.[^.]+$/, '').trim();
  base = base.replace(/[\s_-]*\(?mixed\)?$/i, '').trim();

  const underscore = base.lastIndexOf('_');
  if (underscore > 0 && underscore < base.length - 1) {
    return { songName: tidy(base.slice(0, underscore)), stemName: tidy(base.slice(underscore + 1)).toLowerCase() };
  }
  const dash = base.lastIndexOf(' - ');
  if (dash > 0) {
    return { songName: tidy(base.slice(0, dash)), stemName: tidy(base.slice(dash + 3)).toLowerCase() };
  }
  return { songName: 'Imported song', stemName: tidy(base).toLowerCase() || 'stem' };
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tidy(s: string): string {
  return s.replace(/[_\s]+/g, ' ').trim();
}
