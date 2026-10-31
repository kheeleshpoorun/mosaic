import { analyzeChords, type ChordInput } from './chords';

self.onmessage = (e: MessageEvent<ChordInput>) => {
  try {
    self.postMessage({ ok: true, result: analyzeChords(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
