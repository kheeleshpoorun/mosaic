import type { Engine, EngineState } from '../../audio/Engine';
import { ForwardIcon, MetronomeIcon, PauseIcon, PitchIcon, PlayIcon, RewindIcon } from '../icons';

interface Props {
  engine: Engine;
  state: EngineState;
  onMetronome: () => void;
  onPitch: () => void;
}

export function Transport({ engine, state, onMetronome, onPitch }: Props) {
  const ready = state.status === 'ready';
  const pitchActive = state.pitch !== 0 || state.speed !== 1;
  return (
    <div className="transport">
      <button
        type="button"
        className={`icon-button transport__side ${state.metronome.enabled ? 'is-on' : ''}`}
        aria-label="Metronome"
        onClick={onMetronome}
      >
        <MetronomeIcon size={30} />
      </button>
      <button type="button" className="icon-button" aria-label="Back 5 seconds" disabled={!ready} onClick={() => engine.skip(-5)}>
        <RewindIcon size={36} />
      </button>
      <button
        type="button"
        className="icon-button transport__play"
        aria-label={state.playing ? 'Pause' : 'Play'}
        disabled={!ready}
        onClick={() => engine.toggle()}
      >
        {state.playing ? <PauseIcon size={44} /> : <PlayIcon size={44} />}
      </button>
      <button type="button" className="icon-button" aria-label="Forward 5 seconds" disabled={!ready} onClick={() => engine.skip(5)}>
        <ForwardIcon size={36} />
      </button>
      <button
        type="button"
        className={`icon-button transport__side ${pitchActive ? 'is-on' : ''}`}
        aria-label="Pitch and speed"
        onClick={onPitch}
      >
        <PitchIcon size={30} />
      </button>
    </div>
  );
}
