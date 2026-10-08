import type { Engine, EngineState } from '../../audio/Engine';
import { Sheet, Stepper } from './Sheet';
import { Slider } from './Slider';

export function PitchSpeedSheet({ engine, state, onClose }: { engine: Engine; state: EngineState; onClose: () => void }) {
  const { pitch, speed } = state;
  return (
    <Sheet title="Pitch & speed" onClose={onClose}>
      <div className="sheet-row">
        <span>
          Key
          <small>semitones</small>
        </span>
        <Stepper
          label="pitch"
          value={pitch > 0 ? `+${pitch}` : pitch}
          onMinus={() => engine.setPitch(pitch - 1)}
          onPlus={() => engine.setPitch(pitch + 1)}
        />
      </div>
      <div className="sheet-row">
        <span>
          Speed
          <small>{speed.toFixed(2)}×</small>
        </span>
        <Stepper
          label="speed"
          value={`${Math.round(speed * 100)}%`}
          onMinus={() => engine.setSpeed(speed - 0.05)}
          onPlus={() => engine.setSpeed(speed + 0.05)}
        />
      </div>
      <Slider
        className="sheet-slider"
        label="Speed"
        min={0.5}
        max={1.5}
        step={0.01}
        value={speed}
        onChange={(v) => engine.setSpeed(v)}
      />
      <div className="sheet-actions">
        <button
          type="button"
          className="pill-button pill-button--outline"
          disabled={pitch === 0 && speed === 1}
          onClick={() => {
            engine.setPitch(0);
            engine.setSpeed(1);
          }}
        >
          Reset
        </button>
      </div>
    </Sheet>
  );
}
