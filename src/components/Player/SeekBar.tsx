import type { Engine, EngineState } from '../../audio/Engine';
import { formatTime } from '../../lib/format';
import { Slider } from './Slider';

interface Props {
  engine: Engine;
  state: EngineState;
  position: number;
  /** Scrub position while the user drags (null otherwise). Owned by the player so the waveforms follow it. */
  scrub: number | null;
  onScrub: (t: number | null) => void;
}

export function SeekBar({ engine, state, position, scrub, onScrub: setScrub }: Props) {
  // While dragging, show the scrub position instead of the playhead.
  const shown = scrub ?? position;
  const { duration } = state;

  return (
    <div className="seek">
      <Slider
        label="Seek"
        value={shown}
        max={duration || 1}
        step={0.01}
        disabled={state.status !== 'ready'}
        onChange={setScrub}
        onCommit={(v) => {
          setScrub(null);
          engine.seek(v);
        }}
        onCancel={() => setScrub(null)}
      />
      <div className="seek__times">
        <span>{formatTime(shown)}</span>
        <span>-{formatTime(duration - shown)}</span>
      </div>
    </div>
  );
}
