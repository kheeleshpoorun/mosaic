import { useMemo, useState, type CSSProperties } from 'react';
import { CYMBALS, LANES, isGhost, roadMap, usedLanes, type DrumAnalysis, type DrumBar } from '../../audio/drums';
import { RepeatBarIcon } from '../icons';
import { DrumNotation } from './DrumNotation';
import { MiniPattern } from './DrumStrip';
import { Sheet } from './Sheet';
import { segmentAt, useStarts } from './timeline';

type View = 'grid' | 'notation';

const LANE_NAMES = { crash: 'CR', openHat: 'OH', hat: 'HH', highTom: 'T1', snare: 'SN', lowTom: 'FT', kick: 'KD' };

/** Per-viewer preference: how the drum sheet shows the bars. */
const VIEW_KEY = 'mosaic:drum-view';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'notation' ? 'notation' : 'grid';
  } catch {
    return 'grid';
  }
}

function writeView(value: View) {
  try {
    localStorage.setItem(VIEW_KEY, value);
  } catch {
    // storage unavailable — the choice lasts for this session only
  }
}

interface Props {
  analysis: DrumAnalysis;
  position: number;
  onSeek: (time: number) => void;
  onClose: () => void;
}

/** Step of `bar` playing at `t`. */
function stepAt(bar: DrumBar, t: number, division: number): number {
  let j = 0;
  while (j + 1 < bar.beats.length && bar.beats[j + 1] <= t) j++;
  const end = bar.beats[j + 1] ?? bar.end;
  const u = Math.min(0.999, Math.max(0, (t - bar.beats[j]) / (end - bar.beats[j])));
  return j * division + Math.floor(u * division);
}

/**
 * Reading view of the drum part: the bar playing now (with a moving step cursor) and the one coming
 * next, as a step grid or as notation, then the song map (grooves ×bars, fills) to jump around.
 */
export function DrumSheet({ analysis, position, onSeek, onClose }: Props) {
  const [view, setView] = useState(readView);
  const { bars, meter, division, swing } = analysis;
  const starts = useStarts(bars);
  const sections = useMemo(() => roadMap(bars), [bars]);
  const lanes = useMemo(() => usedLanes(bars), [bars]);
  const i = segmentAt(bars, starts, position);
  // During a gap, read from the next bar with drums.
  const nowIndex = i >= 0 && bars[i].kind !== 'rest' ? i : bars.findIndex((b, j) => j > i && b.kind !== 'rest');
  const now = nowIndex >= 0 ? bars[nowIndex] : null;
  const next = now ? (bars[nowIndex + 1] ?? null) : null;
  const playing = i === nowIndex;

  const choose = (value: View) => {
    setView(value);
    writeView(value);
  };

  return (
    <Sheet title="Drums" onClose={onClose}>
      <div className="chord-now">
        <span className="chord-now__name">{now ? `Bar ${nowIndex + 1}` : 'No drums'}</span>
        <span className="chord-now__next drum-feel">
          {meter}/4 · {swing ? 'Shuffle' : 'Straight'}
        </span>
      </div>
      <div className="segmented" role="group" aria-label="View">
        {(['grid', 'notation'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`segmented__btn ${view === value ? 'segmented__btn--on' : ''}`}
            aria-pressed={view === value}
            onClick={() => choose(value)}
          >
            {value === 'grid' ? 'Grid' : 'Notation'}
          </button>
        ))}
      </div>

      {now && (
        <div className="drum-read">
          <ReadBar bar={now} caption={playing ? 'Now' : 'Coming up'} lanes={lanes} division={division} view={view} step={playing ? stepAt(now, position, division) : -1} />
          {next && next.kind !== 'rest' && <ReadBar bar={next} caption="Next" lanes={lanes} division={division} view={view} step={-1} />}
          {next?.kind === 'rest' && <p className="drum-read__rest">Next: drums stop</p>}
        </div>
      )}

      <h4 className="drum-map__title">Song map</h4>
      <div className="drum-map">
        {sections.map((s) => {
          const current = i >= s.first && i < s.first + s.count;
          return (
            <button key={s.first} type="button" className={`drum-map__item drum-map__item--${s.kind} ${current ? 'is-now' : ''}`} onClick={() => onSeek(s.start)}>
              <span className="drum-map__bars">{s.count > 1 ? `${s.first + 1}–${s.first + s.count}` : s.first + 1}</span>
              {s.kind === 'rest' ? <span className="drum-map__rest">No drums</span> : <MiniPattern steps={s.steps} beats={s.steps[0].length / division} />}
              <span className="drum-map__count">{s.kind === 'fill' ? 'Fill' : `×${s.count}`}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

interface ReadBarProps {
  bar: DrumBar;
  caption: string;
  lanes: number[];
  division: number;
  view: View;
  step: number;
}

function ReadBar({ bar, caption, lanes, division, view, step }: ReadBarProps) {
  return (
    <div className="drum-read__bar">
      <div className="drum-read__caption">
        <span>{caption}</span>
        {bar.kind === 'fill' && <span className="drum-read__tag">Fill</span>}
        {bar.repeat && (
          <span className="drum-read__same">
            <RepeatBarIcon size={16} /> Same as before
          </span>
        )}
      </div>
      {view === 'notation' ? <DrumNotation bar={bar} division={division} step={step} /> : <DrumGrid bar={bar} lanes={lanes} division={division} step={step} />}
    </div>
  );
}

const COUNTS = { 3: ['', '&', 'a'], 4: ['', 'e', '&', 'a'] };

/** Step grid: one row per drum the song uses, counted "1 e & a", hits as ✕ (cymbals) or ● (drums). */
function DrumGrid({ bar, lanes, division, step }: { bar: DrumBar; lanes: number[]; division: number; step: number }) {
  const steps = bar.steps[0].length;
  const counts = Array.from({ length: steps }, (_, s) => (s % division === 0 ? String(s / division + 1) : COUNTS[division as 3 | 4][s % division]));
  const cell = (s: number, extra = '') =>
    ['drum-grid__cell', s % division === 0 && 'drum-grid__cell--beat', s === step && 'is-now', extra].filter(Boolean).join(' ');
  return (
    <div className="drum-grid" role="img" aria-label="Drum pattern of this bar" style={{ '--steps': steps } as CSSProperties}>
      <div className="drum-grid__row drum-grid__row--count">
        <span />
        {counts.map((c, s) => (
          <span key={s} className={cell(s, 'drum-grid__count')}>
            {c}
          </span>
        ))}
      </div>
      {lanes.map((l) => {
        const lane = LANES[l];
        const cymbal = CYMBALS.includes(lane);
        return (
          <div key={lane} className="drum-grid__row">
            <span className="drum-grid__lane">{LANE_NAMES[lane]}</span>
            {bar.steps[l].map((v, s) => (
              <span key={s} className={cell(s)}>
                {v > 0 && (
                  <span
                    className={`drum-grid__hit ${cymbal ? 'drum-grid__hit--cymbal' : ''} ${lane === 'openHat' ? 'drum-grid__hit--open' : ''} ${isGhost(v) ? 'is-ghost' : ''}`}
                    style={{ opacity: 0.45 + 0.55 * v }}
                  >
                    {cymbal ? (lane === 'openHat' ? '○' : '✕') : null}
                  </span>
                )}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
