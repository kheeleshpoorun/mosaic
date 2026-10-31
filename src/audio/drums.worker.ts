import { analyzeDrums, type DrumInput } from './drums';

self.onmessage = (e: MessageEvent<DrumInput>) => {
  try {
    self.postMessage({ ok: true, result: analyzeDrums(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
