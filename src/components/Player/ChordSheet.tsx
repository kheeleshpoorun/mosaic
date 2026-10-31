import { useState, type ReactNode } from 'react';
import type { Chord, ChordAnalysis } from '../../audio/chords';
import { chordName, chordTones, guitarShape, transposeChord } from '../../lib/chords';
import { segmentAt, useStarts } from './timeline';
import { Sheet } from './Sheet';

type Instrument = 'guitar' | 'piano';

/** Per-viewer preference: which diagram the chord sheet shows. */
const INSTRUMENT_KEY = 'mosaic:chord-instrument';

function readInstrument(): Instrument {
  try {
    return localStorage.getItem(INSTRUMENT_KEY) === 'piano' ? 'piano' : 'guitar';
  } catch {
    return 'guitar';
  }
}

function writeInstrument(value: Instrument) {
  try {
    localStorage.setItem(INSTRUMENT_KEY, value);
  } catch {
    // storage unavailable — the choice lasts for this session only
  }
}

interface Props {
  analysis: ChordAnalysis;
  position: number;
  pitch: number;
  /** Mini player pinned under the sheet. */
  dock?: ReactNode;
  onClose: () => void;
}

/** Diagram of the chord playing now (it follows playback), and the one coming next. */
export function ChordSheet({ analysis, position, pitch, onClose, dock }: Props) {
  const [instrument, setInstrument] = useState(readInstrument);
  const starts = useStarts(analysis.segments);
  const { segments, key } = analysis;
  const i = segmentAt(segments, starts, position);
  const now = i >= 0 && segments[i].quality !== 'N' ? segments[i] : null;
  const next = segments.slice(i + 1).find((s) => s.quality !== 'N') ?? null;
  // During a gap (no chord), show the one that's coming.
  const shown = now ?? next;

  const choose = (value: Instrument) => {
    setInstrument(value);
    writeInstrument(value);
  };

  return (
    <Sheet title="Chords" onClose={onClose} dock={dock}>
      <div className="chord-now">
        <span className="chord-now__name">{shown ? chordName(shown, pitch, key) : 'N.C.'}</span>
        {now && next && <span className="chord-now__next">Next {chordName(next, pitch, key)}</span>}
        {!now && next && <span className="chord-now__next">Coming up</span>}
      </div>
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
      <div className="chord-diagram">
        {shown &&
          (instrument === 'guitar' ? <GuitarDiagram chord={transposeChord(shown, pitch)} /> : <PianoDiagram chord={transposeChord(shown, pitch)} />)}
      </div>
    </Sheet>
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
