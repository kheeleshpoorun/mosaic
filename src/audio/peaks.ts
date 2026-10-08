/** Buckets per stem: finer than any bar layout we draw, so bars can take the max of a slice. */
export const PEAK_BUCKETS = 1000;
/** Levels this far below the stem's loudest bucket (bleed, noise, reverb tails) draw as silence. */
const FLOOR_DB = -48;
/** Absolute silence (dBFS), so a stem that's near-empty isn't normalised up into a full waveform. */
const SILENCE_DB = -70;
/** Every Nth sample is read; RMS over thousands of samples barely changes and it's 4× faster. */
const STRIDE = 4;

/**
 * Waveform overview of a stem: RMS per bucket of the mono downmix, in dB, mapped so the stem's
 * loudest bucket is 1 and anything at or below FLOOR_DB under it is 0. Normalising per stem keeps
 * quiet stems readable; the floor makes entries and exits crisp. Pure function of samples.
 */
export function computePeaks(channels: Float32Array[], buckets = PEAK_BUCKETS): Float32Array {
  const out = new Float32Array(buckets);
  const length = channels[0]?.length ?? 0;
  if (!length) return out;

  const db = new Float32Array(buckets);
  let max = -Infinity;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * length) / buckets);
    const end = Math.max(start + 1, Math.floor(((b + 1) * length) / buckets));
    let sum = 0;
    let n = 0;
    for (let i = start; i < end; i += STRIDE) {
      let s = 0;
      for (const ch of channels) s += ch[i];
      s /= channels.length;
      sum += s * s;
      n++;
    }
    const rms = Math.sqrt(sum / n);
    const level = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    db[b] = level > SILENCE_DB ? level : -Infinity;
    if (db[b] > max) max = db[b];
  }

  if (max === -Infinity) return out;
  for (let b = 0; b < buckets; b++) {
    const v = (db[b] - max - FLOOR_DB) / -FLOOR_DB;
    out[b] = v > 0 ? Math.min(1, v) : 0;
  }
  return out;
}
