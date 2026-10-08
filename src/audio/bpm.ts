import { analyzeBeats, type BeatAnalysis } from './beats';

/**
 * Tracks the beats of a decoded stem (ideally the drums) in a Web Worker so the UI stays smooth.
 * The stem is downmixed to mono and its buffer transferred (not copied) to the worker.
 */
export async function detectBeats(buffer: AudioBuffer): Promise<BeatAnalysis> {
  try {
    return await runInWorker(downmix(buffer), buffer.sampleRate);
  } catch {
    // Workers unavailable (or failed) — analyse on the main thread instead. The first downmix was
    // transferred to the worker (detached), so make a fresh one.
    return analyzeBeats([downmix(buffer)], buffer.sampleRate);
  }
}

function downmix(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  const k = 1 / buffer.numberOfChannels;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] * k;
  }
  return mono;
}

function runInWorker(mono: Float32Array, sampleRate: number): Promise<BeatAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./beats.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: BeatAnalysis; error?: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result!);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ mono, sampleRate }, [mono.buffer]);
  });
}
