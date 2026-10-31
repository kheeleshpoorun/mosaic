/**
 * iOS puts Web Audio in the "ambient" category, which the ring/silent switch mutes. Media
 * elements use "playback", which ignores the switch. Safari 16.4+ lets the page pick the
 * category directly (`navigator.audioSession`); on older iOS, playing a silent looping <audio>
 * element in the same user gesture moves the whole page into the playback category.
 */

interface AudioSession {
  type: string;
}

let silent: HTMLAudioElement | null = null;

/** Call from a user gesture, before any `await`, whenever playback starts. */
export function enterPlaybackSession() {
  const session = (navigator as Navigator & { audioSession?: AudioSession }).audioSession;
  if (session) {
    session.type = 'playback';
    return;
  }
  if (!isIOS()) return;
  silent ??= createSilentElement();
  silent.play().catch(() => {
    // Not in a gesture or not allowed: Web Audio still plays, just not through silent mode.
  });
}

/** Stops the silent fallback element (if any) so it doesn't hold the session while paused. */
export function leavePlaybackSession() {
  silent?.pause();
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function createSilentElement() {
  const el = document.createElement('audio');
  el.src = URL.createObjectURL(new Blob([silentWav()], { type: 'audio/wav' }));
  el.loop = true;
  el.preload = 'auto';
  el.setAttribute('playsinline', '');
  el.setAttribute('x-webkit-airplay', 'deny');
  return el;
}

/** 0.5 s of 8 kHz mono 8-bit silence (128 = zero for unsigned PCM). */
function silentWav(): ArrayBuffer {
  const rate = 8000;
  const samples = rate / 2;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true); // byte rate
  v.setUint16(32, 1, true); // block align
  v.setUint16(34, 8, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128);
  return buf;
}
