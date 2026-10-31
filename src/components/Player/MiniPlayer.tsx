import type { Engine, EngineState } from '../../audio/Engine';
import { formatTime } from '../../lib/format';
import { ForwardIcon, PauseIcon, PlayIcon, RewindIcon } from '../icons';
import { Slider } from './Slider';

interface Props {
  engine: Engine;
  state: EngineState;
  position: number;
  /** Scrub position while the user drags (null otherwise), shared with the main seek bar. */
  scrub: number | null;
  onScrub: (t: number | null) => void;
}

/**
 * Compact transport docked at the bottom of the player's sheets (as in music players), so you can
 * pause or seek while reading the drums or chords without closing the sheet.
 */
export function MiniPlayer({ engine, state, position, scrub, onScrub: setScrub }: Props) {
  const shown = scrub ?? position;
  const { duration } = state;
  const ready = state.status === 'ready';

  return (
    <div className="mini-player">
      <Slider
        label="Seek"
        className="mini-player__seek"
        value={shown}
        max={duration || 1}
        step={0.01}
        disabled={!ready}
        onChange={setScrub}
        onCommit={(v) => {
          setScrub(null);
          engine.seek(v);
        }}
        onCancel={() => setScrub(null)}
      />
      <div className="mini-player__row">
        <span className="mini-player__time">{formatTime(shown)}</span>
        <button type="button" className="icon-button" aria-label="Back 5 seconds" disabled={!ready} onClick={() => engine.skip(-5)}>
          <RewindIcon size={26} />
        </button>
        <button
          type="button"
          className="icon-button mini-player__play"
          aria-label={state.playing ? 'Pause' : 'Play'}
          disabled={!ready}
          onClick={() => engine.toggle()}
        >
          {state.playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </button>
        <button type="button" className="icon-button" aria-label="Forward 5 seconds" disabled={!ready} onClick={() => engine.skip(5)}>
          <ForwardIcon size={26} />
        </button>
        <span className="mini-player__time mini-player__time--end">-{formatTime(duration - shown)}</span>
      </div>
    </div>
  );
}
