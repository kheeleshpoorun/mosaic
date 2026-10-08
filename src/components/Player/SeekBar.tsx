import { useState } from 'react';
import type { Engine, EngineState } from '../../audio/Engine';
import { formatTime } from '../../lib/format';
import { Slider } from './Slider';

interface Props {
  engine: Engine;
  state: EngineState;
  position: number;
}

export function SeekBar({ engine, state, position }: Props) {
  // While dragging, show the scrub position instead of the playhead.
  const [scrub, setScrub] = useState<number | null>(null);
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
