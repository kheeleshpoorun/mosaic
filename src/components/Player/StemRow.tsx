import { useEffect, useRef, type PointerEvent } from 'react';
import { Engine, type StemState } from '../../audio/Engine';
import { stemMeta } from '../../lib/stemMeta';
import { MoreVerticalIcon, MuteSlash } from '../icons';
import { Slider } from './Slider';

/** Holding the icon this long solos the stem (as in Moises); a shorter tap mutes it. */
const LONG_PRESS_MS = 500;
/** Moving further than this while holding cancels the long-press (the user is scrolling). */
const MOVE_TOLERANCE = 10;

interface Props {
  engine: Engine;
  stems: StemState[];
  index: number;
  onMenu: () => void;
}

export function StemRow({ engine, stems, index, onMenu }: Props) {
  const stem = stems[index];
  const { label, Icon } = stemMeta(stem.name);
  const audible = Engine.audible(stems, index);

  const timer = useRef<number | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const longPressed = useRef(false);
  const cancelPress = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => cancelPress, []);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    cancelPress();
    longPressed.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      longPressed.current = true;
      engine.toggleSolo(index);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (timer.current === undefined) return;
    if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > MOVE_TOLERANCE) cancelPress();
  };
  const onClick = () => {
    // The click that ends a long-press must not also toggle mute.
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    engine.toggleMute(index);
  };

  return (
    <div className={`stem-row ${audible ? '' : 'stem-row--off'}`}>
      <button
        type="button"
        className="stem-row__icon"
        aria-label={`${stem.muted ? 'Unmute' : 'Mute'} ${label}`}
        title={`${label} — tap to mute, hold to solo`}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Icon size={30} />
        {stem.muted && <MuteSlash size={30} className="stem-row__slash" />}
      </button>
      <Slider
        className="stem-row__slider"
        label={`${label} volume`}
        value={stem.muted ? 0 : stem.volume}
        dim={!audible}
        onChange={(v) => engine.setVolume(index, v)}
      />
      <button type="button" className="icon-button stem-row__menu" aria-label={`${label} options`} onClick={onMenu}>
        <MoreVerticalIcon size={22} />
      </button>
    </div>
  );
}
