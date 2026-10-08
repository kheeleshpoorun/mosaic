import { useEffect, useRef, type CSSProperties } from 'react';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  dim?: boolean;
  label: string;
  onChange: (v: number) => void;
  /** Fired once when the user releases the slider (mouse, touch or keyboard). */
  onCommit?: (v: number) => void;
  /** Fired when an interaction ends without a commit (touch cancelled, focus lost). */
  onCancel?: () => void;
  className?: string;
}

/**
 * Thin white Moises-style slider (white fill + round thumb, grey remaining track).
 * Uses native input/change listeners and only writes `value` into the element while the user
 * isn't dragging — a controlled React range input fights a value that updates every frame.
 */
export function Slider({ value, min = 0, max = 1, step = 0.001, disabled, dim, label, onChange, onCommit, onCancel, className }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const handlers = useRef({ onChange, onCommit, onCancel });
  handlers.current = { onChange, onCommit, onCancel };

  useEffect(() => {
    const el = ref.current!;
    const start = () => (dragging.current = true);
    const input = () => {
      dragging.current = true;
      handlers.current.onChange(Number(el.value));
    };
    const commit = () => {
      dragging.current = false;
      handlers.current.onCommit?.(Number(el.value));
    };
    const cancel = () => {
      if (!dragging.current) return;
      dragging.current = false;
      handlers.current.onCancel?.();
    };
    // Pressing the thumb without moving it fires no "change" — end the drag after pointerup.
    const release = () => setTimeout(cancel, 0);
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', release);
    el.addEventListener('input', input);
    el.addEventListener('change', commit);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('blur', cancel);
    return () => {
      el.removeEventListener('pointerdown', start);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('input', input);
      el.removeEventListener('change', commit);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('blur', cancel);
    };
  }, []);

  useEffect(() => {
    if (!dragging.current && ref.current) ref.current.value = String(value);
  }, [value, min, max]);

  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      ref={ref}
      type="range"
      className={`slider ${dim ? 'slider--dim' : ''} ${className ?? ''}`}
      style={{ '--fill': `${Math.max(0, Math.min(100, fill))}%` } as CSSProperties}
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      disabled={disabled}
      aria-label={label}
    />
  );
}
