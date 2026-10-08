import { useEffect, useRef, type CSSProperties } from 'react';

/** Horizontal spacing of the outline's points, in CSS pixels. */
const STEP = 3;

interface Props {
  peaks: Float32Array;
  /** Fraction of the song's duration this stem covers (0..1). */
  span: number;
  /** Vertical scale, follows the stem volume (0..1). */
  level: number;
}

/**
 * Faint, smooth whole-song waveform (a filled outline mirrored around the slider line) drawn behind a stem's volume slider. Two identical canvases are
 * stacked: the base one is dim, the "played" one is brighter and clipped to `--progress` (set on
 * `.stems`), so playback costs a CSS variable update rather than a redraw. Purely decorative.
 */
export function StemWave({ peaks, span, level }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const played = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = root.current!;
    const draw = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of [base.current!, played.current!]) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        drawWave(canvas.getContext('2d')!, peaks, span, width, height, dpr);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [peaks, span]);

  return (
    <div ref={root} className="stem-wave" style={{ '--level': Math.max(0.08, level) } as CSSProperties} aria-hidden="true">
      <canvas ref={base} className="stem-wave__base" />
      <div className="stem-wave__played">
        <canvas ref={played} />
      </div>
    </div>
  );
}

function drawWave(ctx: CanvasRenderingContext2D, peaks: Float32Array, span: number, width: number, height: number, dpr: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const right = width * span;
  const n = Math.floor(right / STEP) + 1;
  if (n < 2) return;

  // Loudest bucket per point, then a small blur so the outline flows instead of jittering.
  const raw = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const from = Math.floor((p * peaks.length) / n);
    const to = Math.max(from + 1, Math.floor(((p + 1) * peaks.length) / n));
    for (let i = from; i < to; i++) if (peaks[i] > raw[p]) raw[p] = peaks[i];
  }
  const mid = height / 2;
  const half = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    let sum = 0;
    let weight = 0;
    for (let k = -2; k <= 2; k++) {
      const v = raw[p + k];
      if (v === undefined) continue;
      const w = 3 - Math.abs(k);
      sum += v * w;
      weight += w;
    }
    const v = sum / weight;
    // Squaring spreads out the loud end of the dB scale, where most music sits, so dynamics show.
    half[p] = Math.max(0.5, (v * v * height) / 2);
  }
  const x = (p: number) => Math.min(right, p * STEP);

  // Top edge left → right, bottom edge right → left, both as quadratic curves through midpoints.
  ctx.beginPath();
  ctx.moveTo(0, mid - half[0]);
  for (let p = 1; p < n; p++) {
    const cx = x(p - 1);
    const cy = mid - half[p - 1];
    ctx.quadraticCurveTo(cx, cy, (cx + x(p)) / 2, (cy + mid - half[p]) / 2);
  }
  ctx.lineTo(x(n - 1), mid - half[n - 1]);
  ctx.lineTo(x(n - 1), mid + half[n - 1]);
  for (let p = n - 2; p >= 0; p--) {
    const cx = x(p + 1);
    const cy = mid + half[p + 1];
    ctx.quadraticCurveTo(cx, cy, (cx + x(p)) / 2, (cy + mid + half[p]) / 2);
  }
  ctx.lineTo(0, mid + half[0]);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
}
