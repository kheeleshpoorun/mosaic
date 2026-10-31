/**
 * Sums decoded buffers to mono and decimates by an integer factor (box filter) to about `targetRate`.
 * Shared by the chord and drum analysers, which both send a small mono signal to a worker.
 */
export function mixDown(buffers: AudioBuffer[], targetRate: number): { samples: Float32Array; sampleRate: number } {
  const rate = buffers[0]?.sampleRate ?? targetRate;
  const factor = Math.max(1, Math.round(rate / targetRate));
  const length = Math.ceil(Math.max(0, ...buffers.map((b) => b.length)) / factor);
  const out = new Float32Array(length);
  for (const buffer of buffers) {
    const k = 1 / (buffer.numberOfChannels * factor);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[(i / factor) | 0] += ch[i] * k;
    }
  }
  return { samples: out, sampleRate: rate / factor };
}
