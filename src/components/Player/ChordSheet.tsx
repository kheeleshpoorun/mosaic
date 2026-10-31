import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Chord, ChordAnalysis, SongKey } from '../../audio/chords';
import { chordChart, progressions, songChords, type BarSpan, type ChartBar } from '../../lib/chordChart';
import { chordName, chordNumeral, chordTones, guitarShape, keyName, transposeChord } from '../../lib/chords';
import { RepeatBarIcon } from '../icons';
import { segmentAt, useStarts } from './timeline';
import { Sheet } from './Sheet';

type View = 'names' | 'numbers';
type Instrument = 'guitar' | 'piano';

/** Per-viewer preferences: chord names or Roman numerals, which diagrams, and whether they're shown. */
const VIEW_KEY = 'mosaic:chord-view';
const INSTRUMENT_KEY = 'mosaic:chord-instrument';
const SHAPES_KEY = 'mosaic:chord-shapes';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the choice lasts for this session only
  }
}

/** Bars per line of the chart, as in a written chord chart. */
const PER_ROW = 4;

interface Labels {
  numbers: boolean;
  pitch: number;
  songKey: SongKey | null;
}

function label(chord: Chord, { numbers, pitch, songKey }: Labels): string {
  return numbers && songKey ? chordNumeral(chord, songKey) : chordName(chord, pitch, songKey);
}

/** Beat of `bar` playing at `t`. */
function beatAt(bar: BarSpan, t: number): number {
  let j = 0;
  while (j + 1 < bar.beats.length && bar.beats[j + 1] <= t) j++;
  return j;
}

interface Props {
  analysis: ChordAnalysis;
  /** Bars of the song (the drum transcription's, else the metronome's beats in 4/4). */
  bars: BarSpan[];
  meter: number;
  position: number;
  pitch: number;
  onSeek: (time: number) => void;
  /** Mini player pinned under the sheet. */
  dock?: ReactNode;
  onClose: () => void;
}

/**
 * Reading view of the harmony: the chord playing now and the next one, the chord chart (bars, four
 * per line, following playback; tap a bar to jump there), the song map of progressions, and the
 * guitar/piano shapes of every chord in the song, tucked away until asked for.
 */
export function ChordSheet({ analysis, bars, meter, position, pitch, onSeek, onClose, dock }: Props) {
  const [view, setView] = useState<View>(() => (read(VIEW_KEY) === 'numbers' ? 'numbers' : 'names'));
  const { segments, key } = analysis;
  const labels: Labels = { numbers: view === 'numbers', pitch, songKey: key };
  const starts = useStarts(segments);
  const chart = useMemo(() => chordChart(segments, bars), [segments, bars]);
  const sections = useMemo(() => progressions(chart), [chart]);
  const barStarts = useStarts(chart);

  const i = segmentAt(segments, starts, position);
  const now = i >= 0 && segments[i].quality !== 'N' ? segments[i] : null;
  const next = segments.slice(i + 1).find((s) => s.quality !== 'N') ?? null;
  // During a gap (no chord), show the one that's coming.
  const shown = now ?? next;
  const bar = segmentAt(chart, barStarts, position);
  const beat = bar >= 0 ? beatAt(chart[bar], position) : -1;

  const choose = (value: View) => {
    setView(value);
    write(VIEW_KEY, value);
  };

  return (
    <Sheet title="Chords" onClose={onClose} dock={dock}>
      <div className="chord-head">
        <div className="chord-now">
          <span className="chord-now__name">{shown ? label(shown, labels) : 'N.C.'}</span>
          {now && next && <span className="chord-now__next">Next {label(next, labels)}</span>}
          {!now && next && <span className="chord-now__next">Coming up</span>}
        </div>
        <p className="chord-meta">
          {[key && `Key ${keyName(key, pitch)}`, `${meter}/4`, bar >= 0 && `Bar ${bar + 1} of ${chart.length}`].filter(Boolean).join(' · ')}
        </p>
      </div>
      {key && (
        <div className="segmented" role="group" aria-label="Chord names">
          {(['names', 'numbers'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`segmented__btn ${view === value ? 'segmented__btn--on' : ''}`}
              aria-pressed={view === value}
              onClick={() => choose(value)}
            >
              {value === 'names' ? 'Names' : 'Numbers'}
            </button>
          ))}
        </div>
      )}

      {chart.length > 0 && (
        <ChordChart chart={chart} now={bar} beat={beat} numbers={labels.numbers} pitch={pitch} songKey={key} onSeek={onSeek} />
      )}

      <h4 className="drum-map__title">Song map</h4>
      <div className="drum-map">
        {sections.map((s) => {
          const bars = s.length * s.count;
          const current = bar >= s.first && bar < s.first + bars;
          return (
            <button
              key={s.first}
              type="button"
              className={`drum-map__item chord-map__item ${s.chords.length ? '' : 'chord-map__item--rest'} ${current ? 'is-now' : ''}`}
              onClick={() => onSeek(Math.max(0, s.start))}
            >
              <span className="drum-map__bars">{bars > 1 ? `${s.first + 1}–${s.first + bars}` : s.first + 1}</span>
              {s.chords.length ? (
                <span className="chord-map__chords">
                  {s.chords.map((c, k) => (
                    <span key={k}>{label(c, labels)}</span>
                  ))}
                </span>
              ) : (
                <span className="drum-map__rest">No chords</span>
              )}
              <span className="drum-map__count">{s.count > 1 ? `×${s.count}` : ''}</span>
            </button>
          );
        })}
      </div>

      <ChordShapes analysis={analysis} now={now} pitch={pitch} />
    </Sheet>
  );
}

interface ChartProps {
  chart: ChartBar[];
  now: number;
  beat: number;
  numbers: boolean;
  pitch: number;
  songKey: SongKey | null;
  onSeek: (time: number) => void;
}

/** The bars, four per line: a repeat sign for a bar played again, the current one lit with its beats. Re-renders once per beat. */
const ChordChart = memo(function ChordChart({ chart, now, beat, numbers, pitch, songKey, onSeek }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRow = useRef(-1);
  const row = now >= 0 ? Math.floor(now / PER_ROW) : -1;
  const labels: Labels = { numbers, pitch, songKey };

  // Follow playback a page at a time: only when the line playing now has left the view, and only
  // if the line before it was still on screen (otherwise the reader has scrolled elsewhere).
  useEffect(() => {
    const prev = lastRow.current;
    lastRow.current = row;
    const chart = ref.current;
    const body = chart?.closest('.sheet__body');
    const line = chart?.children[row * PER_ROW];
    if (row < 0 || !body || !line) return;
    const view = body.getBoundingClientRect();
    // The now/next header covers the top of the body: where it is now, and where it pins once scrolled.
    const head = body.querySelector<HTMLElement>('.chord-head');
    const top = head?.getBoundingClientRect().bottom ?? view.top;
    const pinned = head
      ? view.top + parseFloat(getComputedStyle(body).paddingTop) + parseFloat(getComputedStyle(head).top) + head.offsetHeight
      : view.top;
    const inView = (el: Element, whole: boolean) => {
      const r = el.getBoundingClientRect();
      return whole ? r.top >= top - 1 && r.bottom <= view.bottom + 1 : r.bottom > top && r.top < view.bottom;
    };
    if (inView(line, true)) return;
    const before = prev >= 0 ? chart.children[prev * PER_ROW] : null;
    if (before && !inView(before, false)) return;
    // Turn the page: the playing line goes to the top, just under the header.
    body.scrollTo({ top: body.scrollTop + line.getBoundingClientRect().top - pinned - 4, behavior: 'smooth' });
  }, [row]);

  return (
    <div className="chord-chart" ref={ref}>
      {chart.map((b, k) => (
        <button
          key={k}
          type="button"
          className={`chord-chart__bar ${b.empty ? 'chord-chart__bar--empty' : ''} ${k === now ? 'is-now' : ''}`}
          aria-label={`Bar ${k + 1}`}
          onClick={() => onSeek(Math.max(0, b.start))}
        >
          {k % PER_ROW === 0 && <span className="chord-chart__num">{k + 1}</span>}
          {b.repeat ? (
            <span className="chord-chart__repeat">
              <RepeatBarIcon size={18} />
            </span>
          ) : (
            b.chords.map((c, j) => (
              <span key={j} className={`chord-chart__chord ${c.quality === 'N' ? 'is-nc' : ''}`} style={{ flexGrow: c.length }}>
                {label(c, labels)}
              </span>
            ))
          )}
          {k === now && (
            <span className="chord-chart__beats">
              {b.beats.map((_, j) => (
                <span key={j} className={j === beat ? 'is-on' : ''} />
              ))}
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

/** Guitar or piano shape of every chord in the song (the one playing now lit), collapsed by default. */
function ChordShapes({ analysis, now, pitch }: { analysis: ChordAnalysis; now: Chord | null; pitch: number }) {
  const [open, setOpen] = useState(() => read(SHAPES_KEY) === 'open');
  const [instrument, setInstrument] = useState<Instrument>(() => (read(INSTRUMENT_KEY) === 'piano' ? 'piano' : 'guitar'));
  const chords = useMemo(() => songChords(analysis.segments), [analysis.segments]);

  const toggle = () => {
    setOpen(!open);
    write(SHAPES_KEY, open ? 'closed' : 'open');
  };
  const choose = (value: Instrument) => {
    setInstrument(value);
    write(INSTRUMENT_KEY, value);
  };

  return (
    <section className="chord-shapes">
      <button type="button" className="chord-shapes__toggle" aria-expanded={open} onClick={toggle}>
        <span>Chord shapes</span>
        <span className="chord-shapes__count">
          {chords.length} chord{chords.length === 1 ? '' : 's'} {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <>
          <div className="segmented" role="group" aria-label="Instrument">
            {(['guitar', 'piano'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`segmented__btn ${instrument === value ? 'segmented__btn--on' : ''}`}
                aria-pressed={instrument === value}
                onClick={() => choose(value)}
              >
                {value === 'guitar' ? 'Guitar' : 'Piano'}
              </button>
            ))}
          </div>
          <div className={`chord-shapes__grid chord-shapes__grid--${instrument}`}>
            {chords.map((c) => {
              const playing = !!now && now.root === c.root && now.quality === c.quality;
              const chord = transposeChord(c, pitch);
              return (
                <div key={`${c.root}${c.quality}`} className={`chord-shape ${playing ? 'is-now' : ''}`}>
                  <span className="chord-shape__name">{chordName(c, pitch, analysis.key)}</span>
                  {instrument === 'guitar' ? <GuitarDiagram chord={chord} /> : <PianoDiagram chord={chord} />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const STRINGS = 6;
const FRETS = 5;
const GX = 30; // first string
const GS = 22; // string spacing
const GY = 34; // nut / top fret line
const GF = 26; // fret spacing

function GuitarDiagram({ chord }: { chord: Chord }) {
  const shape = guitarShape(chord);
  if (!shape) return null;
  const played = shape.frets.filter((f): f is number => f !== null && f > 0);
  const base = Math.max(...played, 0) <= FRETS ? 1 : (shape.barre ?? Math.min(...played));
  const rootString = shape.frets.findIndex((f) => f !== null);
  const y = (fret: number) => GY + (fret - base + 0.5) * GF;
  const x = (s: number) => GX + s * GS;
  return (
    <svg className="guitar" viewBox="0 0 170 176" role="img" aria-label="Guitar chord diagram">
      {Array.from({ length: FRETS + 1 }, (_, f) => (
        <line key={f} className={f === 0 && base === 1 ? 'guitar__nut' : 'guitar__fret'} x1={x(0)} x2={x(5)} y1={GY + f * GF} y2={GY + f * GF} />
      ))}
      {Array.from({ length: STRINGS }, (_, s) => (
        <line key={s} className="guitar__string" x1={x(s)} x2={x(s)} y1={GY} y2={GY + FRETS * GF} />
      ))}
      {base > 1 && (
        <text className="guitar__base" x={x(5) + 12} y={y(base) + 4}>
          {base}fr
        </text>
      )}
      {shape.barre && (
        <rect className="guitar__barre" x={x(rootString) - 8} y={y(shape.barre) - 8} width={x(5) - x(rootString) + 16} height={16} rx={8} />
      )}
      {shape.frets.map((f, s) =>
        f === null ? (
          <text key={s} className="guitar__mark" x={x(s)} y={GY - 10}>
            ×
          </text>
        ) : f === 0 ? (
          <circle key={s} className="guitar__open" cx={x(s)} cy={GY - 14} r={5} />
        ) : (
          <circle key={s} className={`guitar__dot ${s === rootString ? 'is-root' : ''}`} cx={x(s)} cy={y(f)} r={8} />
        ),
      )}
    </svg>
  );
}

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const KW = 20; // white key width
const KH = 90;

function PianoDiagram({ chord }: { chord: Chord }) {
  const [root, ...rest] = chordTones(chord);
  // Root in the first octave, the other tones stacked above it.
  const on = new Set([root, ...rest.map((pc) => (pc > root ? pc : pc + 12))]);
  const whites: number[] = [];
  const blacks: { note: number; x: number }[] = [];
  for (let n = 0; n < 24; n++) {
    if (WHITE.includes(n % 12)) whites.push(n);
    else blacks.push({ note: n, x: whites.length * KW - 6 });
  }
  return (
    <svg className="piano" viewBox={`0 0 ${whites.length * KW + 2} ${KH + 2}`} role="img" aria-label="Piano chord diagram">
      {whites.map((n, i) => (
        <rect key={n} className={`piano__white ${on.has(n) ? 'is-on' : ''}`} x={i * KW + 1} y={1} width={KW} height={KH} rx={3} />
      ))}
      {blacks.map(({ note, x }) => (
        <rect key={note} className={`piano__black ${on.has(note) ? 'is-on' : ''}`} x={x + 1} y={1} width={12} height={KH * 0.6} rx={2} />
      ))}
    </svg>
  );
}
