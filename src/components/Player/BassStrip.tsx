import { memo, useMemo, type CSSProperties } from 'react';
import { assignBassFingering, bassStrings, type BassBar, type BassNote, type BassStringCount } from '../../audio/bass';
import type { LoopState } from '../../audio/Engine';
import { RepeatBarIcon } from '../icons';
import { PX_PER_SECOND } from './ChordStrip';
import { segmentAt, useStarts } from './timeline';
import type { BassState } from './useBass';

interface Props {
  bass: BassState;
  /** Track time shown (follows the seek bar while it's dragged). */
  position: number;
  pitch: number;
  strings: BassStringCount;
  loop: LoopState;
  onOpen: () => void;
}

const STRING_TOP: Record<BassStringCount, number[]> = {
  4: [14, 38, 62, 86],
  5: [10, 30, 50, 70, 90],
};

/**
 * Songsterr-style scrolling bass tablature strip under the drum strip: fixed string labels
 * (G–D–A–E or G–D–A–E–B) + bars showing actual fret numbers along the strings under the playhead.
 */
export function BassStrip({ bass, position, pitch, strings, loop, onOpen }: Props) {
  const { analysis, status } = bass;
  const bars = useMemo(
    () => (!analysis ? [] : pitch || strings !== 5 ? assignBassFingering(analysis.bars, pitch, strings, analysis.division) : analysis.bars),
    [analysis, pitch, strings],
  );
  const starts = useStarts(bars);
  const active = bars.length ? segmentAt(bars, starts, position) : -1;
  const current = active >= 0 ? bars[active] : null;
  const hasBass = bars.some((b) => b.notes.length > 0);
  const stepsPerBar = analysis ? analysis.meter * analysis.division : 16;
  const stringNames = bassStrings(strings);
  const loopStart = loop.enabled ? loop.start : null;
  const loopEnd = loop.enabled ? loop.end : null;

  return (
    <div className="bass">
      {analysis && (
        <button type="button" className="bass__badge" aria-label={`${strings}-string bass tablature`} disabled={!hasBass} onClick={onOpen}>
          <small>{strings}-str</small>
          <span>TAB</span>
        </button>
      )}
      {analysis && hasBass && (
        <div className={`bass__strings bass__strings--${strings}`} aria-hidden="true">
          {stringNames.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      )}
      <button
        type="button"
        className="bass__view"
        aria-label={current && current.kind !== 'rest' ? `Bass tab, now ${current.kind === 'fill' ? 'a fill' : `bar ${active + 1}`}` : 'Bass tab'}
        disabled={!hasBass}
        onClick={onOpen}
      >
        {status === 'analysing' && (
          <span className="bass__status">
            <span className="spinner" /> Analysing bass…
          </span>
        )}
        {status === 'error' && <span className="bass__status">Bass tab unavailable</span>}
        {status === 'none' && <span className="bass__status">No bass stem</span>}
        {status === 'ready' && !hasBass && <span className="bass__status">No bass detected</span>}
        {analysis && hasBass && (
          <>
            <span className="bass__track" style={{ transform: `translateX(${-position * PX_PER_SECOND}px)` }}>
              <BassChips bars={bars} stepsPerBar={stepsPerBar} strings={strings} active={active} loopStart={loopStart} loopEnd={loopEnd} />
            </span>
            <span className="bass__playhead" />
          </>
        )}
      </button>
    </div>
  );
}

const BassChips = memo(function BassChips({
  bars,
  stepsPerBar,
  strings,
  active,
  loopStart,
  loopEnd,
}: {
  bars: BassBar[];
  stepsPerBar: number;
  strings: BassStringCount;
  active: number;
  loopStart: number | null;
  loopEnd: number | null;
}) {
  const hasLoop = loopStart !== null && loopEnd !== null;
  let lastRiff = -1;
  return bars.map((bar, i) => {
    if (bar.kind === 'rest' || !bar.notes.length) {
      lastRiff = -1;
      return null;
    }
    const change = bar.kind === 'riff' && bar.riff !== lastRiff;
    if (bar.kind === 'riff') lastRiff = bar.riff;
    const mid = (bar.start + bar.end) / 2;
    const inLoop = hasLoop && mid >= loopStart! && mid <= loopEnd!;
    const className = [
      'bass__chip',
      i === active && 'bass__chip--active',
      inLoop && 'bass__chip--loop',
      bar.kind === 'fill' && 'bass__chip--fill',
      bar.repeat && 'bass__chip--repeat',
      change && 'bass__chip--change',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <span key={i} className={className} style={{ left: bar.start * PX_PER_SECOND, width: (bar.end - bar.start) * PX_PER_SECOND }}>
        {bar.kind === 'fill' && <span className="bass__tag">Fill</span>}
        {bar.repeat && (
          <span className="bass__tag" aria-label="Same as before">
            <RepeatBarIcon size={10} />
          </span>
        )}
        <StripFrets notes={bar.notes} steps={stepsPerBar} beats={bar.beats.length} strings={strings} />
      </span>
    );
  });
});

function StripFrets({
  notes,
  steps,
  beats,
  strings,
}: {
  notes: BassNote[];
  steps: number;
  beats: number;
  strings: BassStringCount;
}) {
  const tops = STRING_TOP[strings];
  return (
    <span className={`bass__mini bass__mini--${strings}`} aria-hidden="true" style={{ '--beats': beats } as CSSProperties}>
      {notes.map((n, idx) =>
        n.string < strings ? (
          <span
            key={`${n.step}-${idx}`}
            className="bass__fret"
            style={{
              left: `${((n.step + 0.5) / steps) * 100}%`,
              top: `${tops[n.string]}%`,
              opacity: 0.55 + 0.45 * n.velocity,
            }}
          >
            {n.slide === 'up' ? `/${n.fret}` : n.slide === 'down' ? `\\${n.fret}` : n.fret}
          </span>
        ) : null,
      )}
    </span>
  );
}

/** Compact 4- or 5-string preview for the Song map inside BassPage. */
export function MiniTab({
  notes,
  steps,
  beats,
  strings = 5,
}: {
  notes: BassNote[];
  steps: number;
  beats: number;
  strings?: BassStringCount;
}) {
  const tops = STRING_TOP[strings];
  return (
    <span className={`bass__mini bass__mini--${strings}`} aria-hidden="true" style={{ '--beats': beats } as CSSProperties}>
      {notes.map((n, idx) =>
        n.string < strings ? (
          <span
            key={`${n.step}-${idx}`}
            className="bass__note"
            style={{
              left: `${((n.step + 0.35) / steps) * 100}%`,
              top: `${tops[n.string]}%`,
              width: `${Math.max(4, (n.duration / steps) * 100 - 1)}%`,
              opacity: 0.5 + 0.5 * n.velocity,
            }}
          />
        ) : null,
      )}
    </span>
  );
}
