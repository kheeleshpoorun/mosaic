import { analyzeChords, type ChordAnalysis, type ChordInput } from './chords';
import { mixDown } from './mixDown';

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
    const h = mixDown(harmonic, TARGET_RATE);
    return { harmonic: h.samples, bass: bass ? mixDown([bass], TARGET_RATE).samples : null, sampleRate: h.sampleRate, beats, duration };
  };
  try {
    return await runInWorker(prepare());
  } catch {
    // Workers unavailable (or failed) — the first arrays were transferred (detached), so make new ones.
    return analyzeChords(prepare());
  }
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
