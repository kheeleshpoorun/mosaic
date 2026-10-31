import type { ReactElement } from 'react';
import { CYMBALS, LANES, isGhost, type DrumBar, type DrumLane } from '../../audio/drums';

/** Staff position (half-spaces above the bottom line, E4 = 0) of each lane, as in common drum keys. */
const POSITION: Record<DrumLane, number> = { crash: 10, openHat: 9, hat: 9, highTom: 7, snare: 5, lowTom: 3, kick: 1 };
const KICK = LANES.indexOf('kick');

const W = 340;
const BOTTOM = 72; // bottom staff line
const GAP = 10; // between staff lines
const X0 = 30; // first note area, after the clef
const X1 = W - 6; // closing bar line
const STEM_TOP = 6;
const STEM_BOTTOM = 102;
const y = (p: number) => BOTTOM - (p * GAP) / 2;

interface Props {
  bar: DrumBar;
  division: number;
  /** Step to mark as playing (-1 for none). */
  step: number;
}

/**
 * One bar of drum notation on a five-line percussion staff: hands (cymbals, snare, toms) stems up,
 * kick stems down, notes beamed per beat. Simplified engraving: no rests or ties, and a beat's beams
 * follow its finest subdivision.
 */
export function DrumNotation({ bar, division, step }: Props) {
  const steps = bar.steps[0].length;
  const dx = (X1 - X0) / steps;
  const x = (s: number) => X0 + (s + 0.5) * dx;
  const notes = bar.steps.flatMap((lane, l) => lane.map((v, s) => ({ l, s, v })).filter((n) => n.v > 0));
  const voices = [notes.filter((n) => n.l !== KICK), notes.filter((n) => n.l === KICK)];

  return (
    <svg className="notation" viewBox={`0 0 ${W} 110`} role="img" aria-label="Drum notation of this bar">
      {step >= 0 && <rect className="notation__now" x={X0 + step * dx} y={0} width={dx} height={110} rx={3} />}
      {[0, 2, 4, 6, 8].map((p) => (
        <line key={p} className="notation__line" x1={4} x2={X1} y1={y(p)} y2={y(p)} />
      ))}
      <rect className="notation__clef" x={10} y={y(6)} width={3} height={GAP * 2} />
      <rect className="notation__clef" x={16} y={y(6)} width={3} height={GAP * 2} />
      <line className="notation__barline" x1={X1} x2={X1} y1={y(8)} y2={y(0)} />
      {voices.map((voice, up) => (
        <Voice key={up} notes={voice} up={up === 0} steps={steps} division={division} x={x} />
      ))}
      {notes.map((n) => (
        <Head key={`${n.l}-${n.s}`} lane={LANES[n.l]} cx={x(n.s)} v={n.v} />
      ))}
    </svg>
  );
}

function Head({ lane, cx, v }: { lane: DrumLane; cx: number; v: number }) {
  const cy = y(POSITION[lane]);
  const ghost = isGhost(v);
  return (
    <g className="notation__head" opacity={0.45 + 0.55 * v}>
      {lane === 'crash' && <line className="notation__line" x1={cx - 8} x2={cx + 8} y1={cy} y2={cy} />}
      {CYMBALS.includes(lane) ? (
        <path d={`M${cx - 3.8} ${cy - 3.8}l7.6 7.6M${cx + 3.8} ${cy - 3.8}l-7.6 7.6`} strokeWidth={1.8} />
      ) : (
        <ellipse cx={cx} cy={cy} rx={4.6} ry={3.3} transform={`rotate(-20 ${cx} ${cy})`} className="notation__fill" />
      )}
      {lane === 'openHat' && <circle cx={cx} cy={cy - 11} r={2.6} strokeWidth={1.3} fill="none" />}
      {ghost && <path d={`M${cx - 7} ${cy - 5}q-3 5 0 10M${cx + 7} ${cy - 5}q3 5 0 10`} strokeWidth={1.2} fill="none" />}
    </g>
  );
}

/** Stems, beams and flags of one voice, beamed per beat. */
function Voice({ notes, up, steps, division, x }: { notes: { l: number; s: number }[]; up: boolean; steps: number; division: number; x: (s: number) => number }) {
  const out: ReactElement[] = [];
  const end = up ? STEM_TOP : STEM_BOTTOM;
  const sx = (s: number) => x(s) + (up ? 4.2 : -4.2);
  const dir = up ? 1 : -1; // beams stack away from the stem end, towards the notes
  for (let b = 0; b * division < steps; b++) {
    const cols = [...new Set(notes.filter((n) => Math.floor(n.s / division) === b).map((n) => n.s))].sort((p, q) => p - q);
    if (!cols.length) continue;
    for (const s of cols) {
      const ys = notes.filter((n) => n.s === s).map((n) => y(POSITION[LANES[n.l]]));
      const from = up ? Math.max(...ys) : Math.min(...ys);
      out.push(<line key={`st${s}`} className="notation__stem" x1={sx(s)} x2={sx(s)} y1={from} y2={end} />);
    }
    const sixteenth = division === 4 && cols.some((s) => s % 2 === 1);
    if (cols.length > 1) {
      const beams = sixteenth ? 2 : 1;
      for (let k = 0; k < beams; k++) {
        const by = end + dir * k * 5 - (up ? 0 : 3);
        out.push(<rect key={`bm${b}-${k}`} className="notation__fill" x={sx(cols[0]) - 0.8} y={by} width={sx(cols.at(-1)!) - sx(cols[0]) + 1.6} height={3} />);
      }
      if (division === 3 && up) {
        out.push(
          <text key={`tr${b}`} className="notation__tuplet" x={(sx(cols[0]) + sx(cols.at(-1)!)) / 2} y={STEM_TOP - 1}>
            3
          </text>,
        );
      }
    } else {
      // A lone note on the beat is a quarter; off the beat it gets an eighth or sixteenth flag.
      const s = cols[0];
      const flags = s % division === 0 ? 0 : sixteenth ? 2 : 1;
      for (let k = 0; k < flags; k++) {
        const fy = end + dir * k * 5;
        out.push(<path key={`fl${s}-${k}`} className="notation__flag" d={`M${sx(s)} ${fy}q7 ${dir * 5} 5 ${dir * 12}`} />);
      }
    }
  }
  return <g>{out}</g>;
}
