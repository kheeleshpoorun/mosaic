import { memo } from 'react';
import type { ChordAnalysis } from '../../audio/chords';
import { chordName, keyName } from '../../lib/chords';
import { segmentAt, useStarts } from './timeline';
import type { ChordsState } from './useChords';

/** Horizontal scale of the strip. */
export const PX_PER_SECOND = 56;

interface Props {
  chords: ChordsState;
  /** Track time shown (follows the seek bar while it's dragged). */
  position: number;
  pitch: number;
  onOpen: () => void;
  onKey: () => void;
}

/**
 * Moises-style chord strip on top of the stems: the chords scroll right to left under a fixed
 * playhead, with the key on a fixed badge at the start. Only the track's transform changes per frame.
 */
export function ChordStrip({ chords, position, pitch, onOpen, onKey }: Props) {
  const { analysis, status } = chords;
  const starts = useStarts(analysis?.segments);
  const active = analysis ? segmentAt(analysis.segments, starts, position) : -1;
  const key = analysis?.key ?? null;
  const current = analysis && active >= 0 ? analysis.segments[active] : null;
  const hasChords = !!analysis?.segments.some((s) => s.quality !== 'N');

  return (
    <div className="chords">
      {key && (
        <button type="button" className="chords__key" aria-label={`Key ${keyName(key, pitch)}`} onClick={onKey}>
          <small>Key</small>
          <span>{keyName(key, pitch)}</span>
        </button>
      )}
      <button
        type="button"
        className="chords__view"
        aria-label={current && current.quality !== 'N' ? `Chord chart, now ${chordName(current, pitch, key)}` : 'Chord chart'}
        disabled={!hasChords}
        onClick={onOpen}
      >
        {status === 'analysing' && (
          <span className="chords__status">
            <span className="spinner" /> Analysing chords…
          </span>
        )}
        {status === 'error' && <span className="chords__status">Chords unavailable</span>}
        {status === 'ready' && !hasChords && <span className="chords__status">No chords detected</span>}
        {analysis && hasChords && (
          <>
            <span className="chords__track" style={{ transform: `translateX(${-position * PX_PER_SECOND}px)` }}>
              <ChordChips analysis={analysis} pitch={pitch} active={active} />
            </span>
            <span className="chords__playhead" />
          </>
        )}
      </button>
    </div>
  );
}

/** The chips only re-render when the playing chord, the pitch or the analysis changes. */
const ChordChips = memo(function ChordChips({ analysis, pitch, active }: { analysis: ChordAnalysis; pitch: number; active: number }) {
  return analysis.segments.map((s, i) =>
    s.quality === 'N' ? null : (
      <span
        key={i}
        className={`chords__chip ${i === active ? 'chords__chip--active' : ''}`}
        style={{ left: s.start * PX_PER_SECOND, width: (s.end - s.start) * PX_PER_SECOND }}
      >
        {chordName(s, pitch, analysis.key)}
      </span>
    ),
  );
});
