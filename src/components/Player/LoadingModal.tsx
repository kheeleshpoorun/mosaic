import { useEffect, useMemo, useState } from 'react';
import type { EngineState } from '../../audio/Engine';
import { stemMeta } from '../../lib/stemMeta';

/** Playful status lines per instrument, Claude-style. Picked by `stemMeta(name).label`. */
const STEM_QUIPS: Record<string, string[]> = {
  Vocals: ['Warming up the vocals', 'Clearing throats', 'Finding the harmony', 'Tuning the falsetto'],
  Drums: ['Tightening the snares', 'Counting it in', 'Locking the groove', 'Polishing the cymbals'],
  Bass: ['Finding the low end', 'Thumping the strings', 'Grounding the groove', 'Rumbling politely'],
  Piano: ['Tickling the ivories', 'Pressing the sustain', 'Voicing the chords'],
  Keys: ['Patching the synths', 'Twisting the knobs', 'Layering the pads'],
  Guitar: ['Tuning the strings', 'Bending the notes', 'Stomping the pedals', 'Finding the riff'],
  Strings: ['Rosining the bows', 'Swelling the strings'],
  Wind: ['Taking a deep breath', 'Polishing the brass'],
  Other: ['Gathering stray notes', 'Sweeping up the reverb'],
};

const GENERIC_QUIPS = [
  'Harmonizing',
  'Syncopating',
  'Riffing',
  'Grooving',
  'Noodling',
  'Layering the mix',
  'Aligning every sample',
  'Lining up the downbeat',
];

const QUIP_MS = 2200;

export function LoadingModal({ songName, state }: { songName: string; state: EngineState }) {
  const total = state.stems.length;
  const active = state.stems
    .map((s, i) => ({ label: stemMeta(s.name).label, phase: state.loadPhases[i] }))
    .filter((s) => s.phase === 'fetching' || s.phase === 'decoding');

  // Quips for whatever is in flight right now, with generic ones mixed in.
  const activeKey = active.map((s) => s.label).join('|');
  const quips = useMemo(
    () => [...active.flatMap((s) => STEM_QUIPS[s.label] ?? []), ...GENERIC_QUIPS],
    [activeKey],
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), QUIP_MS);
    return () => window.clearInterval(id);
  }, []);
  // Stride through the list so consecutive quips don't come from the same instrument.
  const quip = quips[(tick * 5) % quips.length];

  const progress = total ? state.loaded / total : 0;

  return (
    <div className="modal-backdrop">
      <div className="modal loader" role="dialog" aria-modal="true" aria-label="Loading">
        <p className="loader__eyebrow">Preparing your mix</p>
        <h2 className="loader__song" title={songName}>
          {songName}
        </h2>

        <ul className="loader__stems">
          {state.stems.map((s, i) => {
            const { label, Icon } = stemMeta(s.name);
            const phase = state.loadPhases[i];
            return (
              <li
                key={i}
                className={`loader__stem loader__stem--${phase}`}
                aria-label={`${label}: ${phase === 'done' ? 'ready' : phase}`}
                title={label}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="loader__stem-icon">
                  <Icon size={20} />
                </span>
                {phase === 'done' && <span className="loader__check" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>

        <p className="loader__quip" aria-live="polite">
          <span key={quip} className="loader__quip-text">
            {quip}
            <span className="loader__dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </span>
        </p>

        <div
          className="loader__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={state.loaded}
        >
          <div className="loader__progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <p className="loader__count">
          {state.loaded} of {total} stems
        </p>
      </div>
    </div>
  );
}
