import { SoundTouchNode } from '@soundtouchjs/audio-worklet';

/** Used until a measurement lands (or if offline rendering is unavailable): typical SoundTouch delay. */
export const FALLBACK_PITCH_DELAY = 0.12;

const CLICKS = 6;
/** Click spacing in track seconds; still > 0.3 s apart on the context clock at 1.5× speed. */
const SPACING = 0.6;
/** Search window after each expected click. SoundTouch's delay is ~0.1–0.15 s. */
const WINDOW = 0.3;
const LEAD = 0.25;

const cache = new Map<string, Promise<number>>();

/**
 * How late SoundTouch plays the music (context seconds) for these settings. Its WSOLA pipeline
 * buffers a processing window before it outputs anything, so music routed through it is heard
 * ~0.1–0.15 s after the click the metronome schedules directly. The delay depends on the tempo
 * and pitch ratios, so it's measured: render a click train through a fresh SoundTouch node
 * offline and take the median onset delay. Cached per (speed, pitch).
 */
export function measurePitchDelay(processorUrl: string, sampleRate: number, speed: number, pitch: number): Promise<number> {
  const key = `${sampleRate}:${speed}:${pitch}`;
  let p = cache.get(key);
  if (!p) {
    p = render(processorUrl, sampleRate, speed, pitch).catch(() => FALLBACK_PITCH_DELAY);
    cache.set(key, p);
  }
  return p;
}

async function render(processorUrl: string, sampleRate: number, speed: number, pitch: number): Promise<number> {
  const trackLen = LEAD + CLICKS * SPACING;
  const ctx = new OfflineAudioContext(2, Math.ceil((trackLen / speed + 2 * LEAD + WINDOW) * sampleRate), sampleRate);
  await SoundTouchNode.register(ctx, processorUrl);
  const node = new SoundTouchNode({ context: ctx });
  node.playbackRate.value = speed;
  node.pitchSemitones.value = pitch;

  const buffer = ctx.createBuffer(1, Math.ceil(trackLen * sampleRate), sampleRate);
  const data = buffer.getChannelData(0);
  const clicks = Array.from({ length: CLICKS }, (_, k) => LEAD + k * SPACING);
  const burst = Math.round(sampleRate * 0.01);
  for (const t of clicks) {
    const i0 = Math.round(t * sampleRate);
    for (let i = 0; i < burst; i++) data[i0 + i] = Math.sin(i * 0.3) * Math.exp(-i / (burst / 5));
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = speed;
  source.connect(node).connect(ctx.destination);
  source.start(LEAD);

  const out = (await ctx.startRendering()).getChannelData(0);
  const delays: number[] = [];
  for (const t of clicks) {
    const a = Math.round((LEAD + t / speed) * sampleRate);
    const b = Math.min(out.length, a + Math.round(WINDOW * sampleRate));
    let peak = 0;
    for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak < 0.05) continue;
    let onset = a;
    while (Math.abs(out[onset]) < 0.3 * peak) onset++;
    delays.push((onset - a) / sampleRate);
  }
  if (!delays.length) return FALLBACK_PITCH_DELAY;
  delays.sort((x, y) => x - y);
  return delays[delays.length >> 1];
}
