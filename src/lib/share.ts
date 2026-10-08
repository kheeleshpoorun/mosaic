import { shareUrl } from './library';
import { toast } from './toast';
import type { SongSource } from './types';

export async function shareSong(song: SongSource) {
  if (!song.shareable) {
    toast('Imported songs can only be played on this device');
    return;
  }
  const url = shareUrl(song);
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: song.name, url });
      return;
    } catch {
      // user cancelled — fall through to copying
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    window.prompt('Copy this link', url);
  }
}
