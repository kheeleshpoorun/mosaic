import { memo, type CSSProperties } from 'react';
import { LANES, isGhost, type DrumAnalysis, type DrumLane } from '../../audio/drums';
import { RepeatBarIcon } from '../icons';
import { PX_PER_SECOND } from './ChordStrip';
import { segmentAt, useStarts } from './timeline';
import type { DrumsState } from './useDrums';

interface Props {
  drums: DrumsState;
  /** Track time shown (follows the seek bar while it's dragged). */
  position: number;
  bpm: number;
  onOpen: () => void;
  onTempo: () => void;
}

/**
 * Drum strip under the chord strip, read like a drum chart: every bar's own pattern, marked where
 * the groove starts or changes, tagged 𝄎 where it plays the bar before again, and fills highlighted.
 * Scrolls under a fixed playhead, with the tempo and meter on a fixed badge; only the track's
 * transform changes per frame.
 */
export function DrumStrip({ drums, position, bpm, onOpen, onTempo }: Props) {
  const { analysis, status } = drums;
  const starts = useStarts(analysis?.bars);
  const active = analysis ? segmentAt(analysis.bars, starts, position) : -1;
  const current = analysis && active >= 0 ? analysis.bars[active] : null;
  const hasDrums = !!analysis?.bars.some((b) => b.kind !== 'rest');

  return (
    <div className="drums">
      {analysis && (
        <button type="button" className="drums__badge" aria-label={`Tempo ${Math.round(bpm)} BPM, ${analysis.meter}/4`} onClick={onTempo}>
          <small>{Math.round(bpm)} BPM</small>
          <span>{analysis.meter}/4</span>
        </button>
      )}
      <button
        type="button"
        className="drums__view"
        aria-label={current && current.kind !== 'rest' ? `Drum part, now ${current.kind === 'fill' ? 'a fill' : `bar ${active + 1}`}` : 'Drum part'}
        disabled={!hasDrums}
        onClick={onOpen}
      >
        {status === 'analysing' && (
          <span className="drums__status">
            <span className="spinner" /> Analysing drums…
          </span>
        )}
        {status === 'error' && <span className="drums__status">Drums unavailable</span>}
        {status === 'none' && <span className="drums__status">No drum stem</span>}
        {status === 'ready' && !hasDrums && <span className="drums__status">No drums detected</span>}
        {analysis && hasDrums && (
          <>
            <span className="drums__track" style={{ transform: `translateX(${-position * PX_PER_SECOND}px)` }}>
              <DrumChips analysis={analysis} active={active} />
            </span>
            <span className="drums__playhead" />
          </>
        )}
      </button>
    </div>
  );
}

/** The chips only re-render when the playing bar or the analysis changes. */
const DrumChips = memo(function DrumChips({ analysis, active }: { analysis: DrumAnalysis; active: number }) {
  let lastGroove = -1;
  return analysis.bars.map((bar, i) => {
    if (bar.kind === 'rest') {
      lastGroove = -1;
      return null;
    }
    // A new section: a groove that isn't the one played before (fills in between don't count).
    const change = bar.kind === 'groove' && bar.groove !== lastGroove;
    if (bar.kind === 'groove') lastGroove = bar.groove;
    const className = [
      'drums__chip',
      i === active && 'drums__chip--active',
      bar.kind === 'fill' && 'drums__chip--fill',
      bar.repeat && 'drums__chip--repeat',
      change && 'drums__chip--change',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <span key={i} className={className} style={{ left: bar.start * PX_PER_SECOND, width: (bar.end - bar.start) * PX_PER_SECOND }}>
        {bar.kind === 'fill' && <span className="drums__tag">Fill</span>}
        {bar.repeat && (
          <span className="drums__tag" aria-label="Same as before">
            <RepeatBarIcon size={10} />
          </span>
        )}
        <MiniPattern steps={bar.steps} beats={bar.beats.length} />
      </span>
    );
  });
});

/** Rows of the mini pattern: cymbals on top, snare and toms, kick at the bottom (as on a staff). */
const ROW: Record<DrumLane, number> = { crash: 0, openHat: 0, hat: 0, highTom: 1, snare: 1, lowTom: 1, kick: 2 };

/** A bar's hits as three rows of dots (ghost notes small), with faint beat lines. */
export function MiniPattern({ steps, beats }: { steps: number[][]; beats: number }) {
  return (
    <span className="drums__mini" aria-hidden="true" style={{ '--beats': beats } as CSSProperties}>
      {steps.flatMap((lane, l) =>
        lane.map((v, s) =>
          v > 0 ? (
            <span
              key={`${l}-${s}`}
              className={`drums__dot drums__dot--${ROW[LANES[l]]} ${isGhost(v) ? 'is-ghost' : ''}`}
              style={{ left: `${((s + 0.5) / lane.length) * 100}%`, opacity: 0.45 + 0.55 * v }}
            />
          ) : null,
        ),
      )}
    </span>
  );
}
