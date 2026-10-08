import { useRef } from 'react';
import type { Engine, EngineState } from '../../audio/Engine';
import { Sheet, Stepper } from './Sheet';
import { Slider } from './Slider';

interface Props {
  engine: Engine;
  state: EngineState;
  onClose: () => void;
  onDetect: () => void;
}

export function MetronomeSheet({ engine, state, onClose, onDetect }: Props) {
  const m = state.metronome;
  const taps = useRef<number[]>([]);

  function tap() {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now].slice(-6);
    if (taps.current.length < 2) return;
    const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    engine.setTempo(60000 / avg);
  }

  const mode = m.detecting ? 'Detecting…' : m.beats ? 'Follows the song' : 'Fixed tempo';
  const offsetMs = Math.round(m.offset * 1000);

  return (
    <Sheet title="Metronome" onClose={onClose}>
      <div className="sheet-row">
        <span>Click</span>
        <button
          type="button"
          role="switch"
          aria-checked={m.enabled}
          aria-label="Metronome click"
          className={`switch ${m.enabled ? 'switch--on' : ''}`}
          onClick={() => engine.setMetronome({ enabled: !m.enabled })}
        >
          <span className="switch__knob" />
        </button>
      </div>
      <div className="sheet-row">
        <span>
          Tempo
          <small>{mode}</small>
        </span>
        <Stepper
          label="tempo"
          value={Math.round(m.bpm)}
          onMinus={() => engine.setTempo(Math.round(m.bpm) - 1)}
          onPlus={() => engine.setTempo(Math.round(m.bpm) + 1)}
        />
      </div>
      <div className="sheet-row">
        <span>
          Click timing
          <small>{m.beats ? `${offsetMs > 0 ? '+' : ''}${offsetMs} ms` : `first beat ${m.offset.toFixed(2)} s`}</small>
        </span>
        <Stepper
          label="offset"
          value={<small>10 ms</small>}
          onMinus={() => engine.nudgeMetronome(-0.01)}
          onPlus={() => engine.nudgeMetronome(0.01)}
        />
      </div>
      <div className="sheet-row">
        <span>Volume</span>
        <Slider
          className="sheet-row__slider"
          label="Metronome volume"
          value={m.volume}
          onChange={(v) => engine.setMetronome({ volume: v })}
        />
      </div>
      <div className="sheet-actions">
        <button type="button" className="pill-button pill-button--outline" onClick={tap}>
          Tap tempo
        </button>
        <button type="button" className="pill-button pill-button--outline" onClick={() => engine.alignBeatHere()}>
          Beat is here
        </button>
        <button type="button" className="pill-button pill-button--outline" disabled={m.detecting} onClick={onDetect}>
          {m.beats ? 'Re-detect' : 'Follow the song'}
        </button>
      </div>
    </Sheet>
  );
}
