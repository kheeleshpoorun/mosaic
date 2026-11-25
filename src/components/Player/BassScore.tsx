import { assignBassFingering, bassStrings, type BassAnalysis, type BassBar, type BassStringCount } from '../../audio/bass';
import type { ChordAnalysis } from '../../audio/chords';
import { engraveBarRhythm } from '../../lib/bassTab';
import { chordChart, type ChartBar } from '../../lib/chordChart';
import { chordName, keyName } from '../../lib/chords';

const SYSTEM_WIDTH = 760;
const STAFF_TOP = 54;
const STRING_GAP = 14;
const STAFF_LEFT = 84;
const STAFF_RIGHT = 752;
const BARS_PER_SYSTEM = 3;

interface Props {
  title: string;
  analysis: BassAnalysis;
  chords: ChordAnalysis | null;
  bpm: number;
  pitch: number;
  strings: BassStringCount;
}

/** Full-song Songsterr-style 4- or 5-string bass tablature score used by print-to-PDF view. */
export function BassScore({ title, analysis, chords, bpm, pitch, strings }: Props) {
  const fingered = pitch || strings !== 5 ? assignBassFingering(analysis.bars, pitch, strings, analysis.division) : analysis.bars;
  const chartBars = chords?.segments.length ? chordChart(chords.segments, fingered) : null;
  const systems = Array.from({ length: Math.ceil(fingered.length / BARS_PER_SYSTEM) }, (_, i) =>
    fingered.slice(i * BARS_PER_SYSTEM, (i + 1) * BARS_PER_SYSTEM),
  );
  const keyText = chords?.key ? `Key ${keyName(chords.key, pitch)} · ` : '';
  const tuningText = strings === 4 ? '4-string E–A–D–G' : '5-string B–E–A–D–G';

  return (
    <article className="bass-score-print">
      <header className="bass-score-print__header">
        <h1>{title}</h1>
        <p>
          Bass tablature ({tuningText}) · {keyText}
          {Math.round(bpm)} BPM · {analysis.meter}/4 · {analysis.swing ? 'Shuffle' : 'Straight'}
        </p>
      </header>
      {systems.map((bars, i) => (
        <ScoreSystem
          key={i}
          bars={bars}
          firstBar={i * BARS_PER_SYSTEM + 1}
          totalBars={fingered.length}
          analysis={analysis}
          chartBars={chartBars}
          chords={chords}
          bpm={bpm}
          pitch={pitch}
          strings={strings}
        />
      ))}
    </article>
  );
}

function ScoreSystem({
  bars,
  firstBar,
  totalBars,
  analysis,
  chartBars,
  chords,
  bpm,
  pitch,
  strings,
}: {
  bars: BassBar[];
  firstBar: number;
  totalBars: number;
  analysis: BassAnalysis;
  chartBars: ChartBar[] | null;
  chords: ChordAnalysis | null;
  bpm: number;
  pitch: number;
  strings: BassStringCount;
}) {
  const stringNames = bassStrings(strings);
  const staffSpan = (strings - 1) * STRING_GAP;
  const staffBottom = STAFF_TOP + staffSpan;
  const stemTop = staffBottom + 8;
  const halfStemTop = staffBottom + 16;
  const stemBottom = staffBottom + 27;
  const systemHeight = staffBottom + 44;
  const stringY = (s: number) => STAFF_TOP + s * STRING_GAP;
  const measureWidth = (STAFF_RIGHT - STAFF_LEFT) / BARS_PER_SYSTEM;
  const staffEnd = STAFF_LEFT + bars.length * measureWidth;

  return (
    <svg
      className="bass-score-print__system"
      viewBox={`0 0 ${SYSTEM_WIDTH} ${systemHeight}`}
      role="img"
      aria-label={`Bass tab bars ${firstBar} to ${firstBar + bars.length - 1}`}
    >
      {firstBar === 1 && (
        <text className="bass-score-print__meta" x={STAFF_LEFT} y="16">
          ♩ = {Math.round(bpm)} · Tuning: {stringNames.slice().reverse().join(' ')}
        </text>
      )}
      {stringNames.map((label, s) => (
        <g key={label}>
          <text className="bass-score-print__string" x="59" y={stringY(s) + 3.5}>
            {label}
          </text>
          <line className="bass-score-print__staff" x1={STAFF_LEFT} x2={staffEnd} y1={stringY(s)} y2={stringY(s)} />
        </g>
      ))}
      <text className="bass-score-print__instrument" x="6" y={STAFF_TOP + 12}>
        Bass
      </text>
      <text className="bass-score-print__clef" x="42" y={STAFF_TOP + staffSpan * 0.22 + 4}>
        T
      </text>
      <text className="bass-score-print__clef" x="42" y={STAFF_TOP + staffSpan * 0.52 + 4}>
        A
      </text>
      <text className="bass-score-print__clef" x="42" y={STAFF_TOP + staffSpan * 0.82 + 4}>
        B
      </text>
      {firstBar === 1 && (
        <>
          <text className="bass-score-print__meter" x="74" y={STAFF_TOP + staffSpan * 0.36 + 4}>
            {analysis.meter}
          </text>
          <text className="bass-score-print__meter" x="74" y={STAFF_TOP + staffSpan * 0.76 + 4}>
            4
          </text>
        </>
      )}
      <line className="bass-score-print__barline" x1={STAFF_LEFT} x2={STAFF_LEFT} y1={STAFF_TOP} y2={staffBottom} />
      {bars.map((bar, i) => {
        const xStart = STAFF_LEFT + i * measureWidth;
        const xEnd = xStart + measureWidth;
        const barNumber = firstBar + i;
        const finalBar = barNumber === totalBars;
        const cb = chartBars?.[barNumber - 1];
        const steps = bar.beats.length * analysis.division;
        const dx = (measureWidth - 16) / steps;
        const xStep = (step: number) => xStart + 8 + (step + 0.5) * dx;
        const rhythm = engraveBarRhythm(bar, analysis.division);

        return (
          <g key={barNumber}>
            <text className="bass-score-print__number" x={xStart + 4} y="30">
              {barNumber}
            </text>
            {cb?.chords.map((c, ci) =>
              c.quality === 'N' ? null : (
                <text key={ci} className="bass-score-print__chord" x={xStart + 8 + c.beat * analysis.division * dx} y="44">
                  {chordName(c, pitch, chords?.key ?? null)}
                </text>
              ),
            )}
            <line className="bass-score-print__barline" x1={xEnd} x2={xEnd} y1={STAFF_TOP} y2={staffBottom} />
            {finalBar && <line className="bass-score-print__barline" x1={xEnd - 4} x2={xEnd - 4} y1={STAFF_TOP} y2={staffBottom} />}
            {!bar.notes.length ? (
              <rect className="bass-score-print__rest" x={xEnd - measureWidth / 2 - 7} y={STAFF_TOP + staffSpan / 2 - 2.5} width="14" height="5" />
            ) : (
              <g>
                {rhythm.restBeats.map((b) => {
                  const rx = xStep(b * analysis.division + (analysis.division - 1) / 2);
                  const ry = stemTop + 2;
                  return (
                    <path
                      key={`qr${b}`}
                      className="bass-score-print__qrest"
                      d={`M${rx - 2} ${ry}l4 4-3.5 3.5 3.5 3.5c-2.2 0-3.5 1.8-1.5 3.5`}
                    />
                  );
                })}
                {rhythm.stems.map((st) => (
                  <g key={`st${st.step}`}>
                    {st.kind !== 'none' && (
                      <line
                        className="bass-score-print__stem"
                        x1={xStep(st.step)}
                        x2={xStep(st.step)}
                        y1={st.kind === 'half' ? halfStemTop : stemTop}
                        y2={stemBottom}
                      />
                    )}
                    {st.dotted && <circle className="bass-score-print__dot" cx={xStep(st.step) + 4.5} cy={stemBottom - 5} r="1.5" />}
                    {st.flags > 0 && <path className="bass-score-print__flag" d={`M${xStep(st.step)} ${stemBottom}q6 -4 4.5 -10`} />}
                    {st.flags === 2 && (
                      <path className="bass-score-print__flag" d={`M${xStep(st.step)} ${stemBottom - 5}q6 -4 4.5 -10`} />
                    )}
                  </g>
                ))}
                {rhythm.primaryBeams.map((bm, bi) => (
                  <rect
                    key={`pb${bi}`}
                    className="bass-score-print__beam"
                    x={xStep(bm.fromStep) - 0.8}
                    y={stemBottom - 2.8}
                    width={xStep(bm.toStep) - xStep(bm.fromStep) + 1.6}
                    height="2.8"
                  />
                ))}
                {rhythm.secondaryBeams.map((bm, bi) => {
                  const baseLeft = xStep(bm.fromStep) - 0.8;
                  const baseRight = xStep(bm.toStep) + 0.8;
                  const x1 = bm.stub === 'left' ? baseRight - 8 : baseLeft;
                  const x2 = bm.stub === 'right' ? baseLeft + 8 : baseRight;
                  return (
                    <rect
                      key={`sb${bi}`}
                      className="bass-score-print__beam"
                      x={x1}
                      y={stemBottom - 7.8}
                      width={Math.max(2, x2 - x1)}
                      height="2.8"
                    />
                  );
                })}
                {rhythm.tuplets.map((t, ti) => (
                  <text key={`tu${ti}`} className="bass-score-print__tuplet" x={(xStep(t.fromStep) + xStep(t.toStep)) / 2} y={stemBottom + 11}>
                    3
                  </text>
                ))}
                {bar.notes.map((n, ni) => {
                  if (n.string >= strings || !n.slide) return null;
                  const cx = xStep(n.step);
                  const cy = stringY(n.string);
                  const w = n.fret >= 10 ? 15 : 10;
                  const prev = ni > 0 ? bar.notes[ni - 1] : null;
                  const fromPrev =
                    prev &&
                    prev.string === n.string &&
                    n.step > prev.step &&
                    n.step - prev.step <= analysis.division * 2 &&
                    (n.slide === 'up' ? n.fret > prev.fret : n.fret < prev.fret);
                  const prevW = prev && prev.fret >= 10 ? 15 : 10;
                  const x2 = cx - w / 2 - 1.5;
                  const x1 = fromPrev ? Math.min(x2 - 3, xStep(prev.step) + prevW / 2 + 1.5) : cx - w / 2 - 9;
                  const y1 = n.slide === 'up' ? cy + 3.2 : cy - 3.2;
                  const y2 = n.slide === 'up' ? cy - 2.2 : cy + 2.2;
                  return <line key={`sl-${n.step}-${ni}`} className="bass-score-print__slide" x1={x1} y1={y1} x2={x2} y2={y2} />;
                })}
                {bar.notes.map((n, ni) => {
                  if (n.string >= strings) return null;
                  const cx = xStep(n.step);
                  const cy = stringY(n.string);
                  const w = n.fret >= 10 ? 15 : 10;
                  return (
                    <g key={`${n.step}-${ni}`}>
                      <rect className="bass-score-print__knockout" x={cx - w / 2} y={cy - 6} width={w} height={12} rx={2} />
                      <text className="bass-score-print__fret" x={cx} y={cy + 4}>
                        {n.fret}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
