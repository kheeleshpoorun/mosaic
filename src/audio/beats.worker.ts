import { analyzeBeats } from './beats';

self.onmessage = (e: MessageEvent<{ mono: Float32Array; sampleRate: number }>) => {
  const { mono, sampleRate } = e.data;
  try {
    self.postMessage({ ok: true, result: analyzeBeats([mono], sampleRate) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
