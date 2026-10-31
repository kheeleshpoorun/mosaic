import { analyzeChords, type ChordAnalysis, type ChordInput } from './chords';

/** Analysis rate: plenty for chroma up to ~2 kHz, and 4× less to transform and transfer. */
const TARGET_RATE = 11025;

export interface ChordBuffers {
  harmonic: AudioBuffer[];
  bass: AudioBuffer | null;
}

/**
 * Recognises the chords and key of the already-decoded stems in a Web Worker. The harmonic stems
 * are mixed to one decimated mono signal (and the bass stem to another), and transferred, not copied.
 */
export async function detectChords({ harmonic, bass }: ChordBuffers, beats: number[], duration: number): Promise<ChordAnalysis> {
  const prepare = (): ChordInput => {
    const h = mixDown(harmonic);
    return { harmonic: h.samples, bass: bass ? mixDown([bass]).samples : null, sampleRate: h.sampleRate, beats, duration };
  };
  try {
    return await runInWorker(prepare());
  } catch {
    // Workers unavailable (or failed) — the first arrays were transferred (detached), so make new ones.
    return analyzeChords(prepare());
  }
}

/** Sums the buffers to mono and decimates by an integer factor (box filter) to about TARGET_RATE. */
function mixDown(buffers: AudioBuffer[]): { samples: Float32Array; sampleRate: number } {
  const rate = buffers[0]?.sampleRate ?? TARGET_RATE;
  const factor = Math.max(1, Math.round(rate / TARGET_RATE));
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

function runInWorker(input: ChordInput): Promise<ChordAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./chords.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: ChordAnalysis; error?: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result!);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    const transfer = [input.harmonic.buffer, ...(input.bass ? [input.bass.buffer] : [])] as ArrayBuffer[];
    worker.postMessage(input, transfer);
  });
}
