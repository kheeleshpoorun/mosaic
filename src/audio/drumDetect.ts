import { analyzeDrums, type DrumAnalysis, type DrumInput } from './drums';
import { mixDown } from './mixDown';

/** Analysis rate: cymbals still fit under its ~11 kHz Nyquist, at half the work of 44.1 kHz. */
const TARGET_RATE = 22050;

/**
 * Recognises the grooves of the already-decoded drums stem in a Web Worker. The stem is mixed to
 * one decimated mono signal and transferred, not copied.
 */
export async function detectDrums(drums: AudioBuffer, beats: number[], downbeat: number, duration: number): Promise<DrumAnalysis> {
  const prepare = (): DrumInput => {
    const { samples, sampleRate } = mixDown([drums], TARGET_RATE);
    return { samples, sampleRate, beats, downbeat, duration };
  };
  try {
    return await runInWorker(prepare());
  } catch {
    // Workers unavailable (or failed) — the first array was transferred (detached), so make a new one.
    return analyzeDrums(prepare());
  }
}

function runInWorker(input: DrumInput): Promise<DrumAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./drums.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: DrumAnalysis; error?: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result!);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(input, [input.samples.buffer as ArrayBuffer]);
  });
}
