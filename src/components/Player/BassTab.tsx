import { memo } from 'react';
import { bassStrings, type BassBar, type BassStringCount } from '../../audio/bass';
import type { NoteGrade } from '../../audio/bassCoach';
import type { SongKey } from '../../audio/chords';
import type { LoopState } from '../../audio/Engine';
import { engraveBarRhythm } from '../../lib/bassTab';
import type { ChartBar } from '../../lib/chordChart';
import { chordName } from '../../lib/chords';

export const BARS_PER_SYSTEM = 2;

const MEASURE_WIDTH = 308;
const STAFF_LEFT = 56;
const RIGHT_PAD = 8;
const STRING_GAP = 16;

interface Props {
  bars: BassBar[];
  firstBar: number;
  totalBars: number;
  barsPerSystem?: number;
  strings: BassStringCount;
  division: 3 | 4;
  meter: 3 | 4;
  bpm: number;
  /** Index within `bars` currently playing (0..bars.length-1), or -1 if elsewhere. */
  activeBar: number;
  /** Step index within `activeBar` currently under the cursor, or -1. */
  activeStep: number;
  chartBars: ChartBar[] | null;
  pitch: number;
  songKey: SongKey | null;
  loop: LoopState;
  noteFeedback?: ReadonlyMap<string, NoteGrade>;
  onSeek: (time: number) => void;
  onShiftSelectBar?: (bar: BassBar) => void;
}

/**
 * Songsterr-style multi-bar bass tablature system: clean horizontal strings (4 or 5), `T A B`
 * clef, measure numbers, chord symbols, knockout fret numbers, real rhythmic beaming/rests below
 * the staff, A-B loop highlights, live coach grading, and a vertical playhead cursor that tracks playback step by step.
 */
export const BassTabSystem = memo(function BassTabSystem({
  bars,
  firstBar,
  totalBars,
  barsPerSystem = BARS_PER_SYSTEM,
  strings,
  division,
  meter,
  bpm,
  activeBar,
  activeStep,
  chartBars,
  pitch,
  songKey,
  loop,
  noteFeedback,
  onSeek,
  onShiftSelectBar,
}: Props) {
  const stringNames = bassStrings(strings);
  const isFirst = firstBar === 0;
  const staffTop = isFirst ? 50 : 34;
  const staffSpan = (strings - 1) * STRING_GAP;
  const staffBottom = staffTop + staffSpan;
  const stemTop = staffBottom + 10;
  const halfStemTop = staffBottom + 18;
  const stemBottom = staffBottom + 30;
  const totalHeight = staffBottom + 44;
  const stringY = (s: number) => staffTop + s * STRING_GAP;

  const measureWidth = MEASURE_WIDTH;
  const systemWidth = STAFF_LEFT + barsPerSystem * measureWidth + RIGHT_PAD;
  const systemEnd = STAFF_LEFT + bars.length * measureWidth;
  const hasLoop = loop.start !== null && loop.end !== null;
  const inLoop = (bar: BassBar) => {
    if (!hasLoop) return false;
    const mid = (bar.start + bar.end) / 2;
    return mid >= loop.start! && mid <= loop.end!;
  };

  return (
    <svg
      className="songsterr__system"
      viewBox={`0 0 ${systemWidth} ${totalHeight}`}
      role="group"
      aria-label={`Bass tab bars ${firstBar + 1} to ${firstBar + bars.length}`}
    >
      {isFirst && (
        <g className="songsterr__meta">
          <text x={STAFF_LEFT} y="16">
            ♩ = {Math.round(bpm)}
          </text>
          <text x={STAFF_LEFT + 68} y="16">
            Tuning: {stringNames.slice().reverse().join(' ')}
          </text>
        </g>
      )}

      {/* Render loop and active measure backgrounds before .notation__line so strings stay on top. */}
      {bars.map((bar, i) =>
        inLoop(bar) ? (
          <rect
            key={`loop-${i}`}
            className={`songsterr__bar-loop ${loop.enabled ? '' : 'songsterr__bar-loop--off'}`}
            x={STAFF_LEFT + i * measureWidth}
            y={staffTop - 2}
            width={measureWidth}
            height={staffSpan + 4}
            rx={2}
          />
        ) : null,
      )}

      {activeBar >= 0 && activeBar < bars.length && (
        <rect
          className="songsterr__bar-now"
          x={STAFF_LEFT + activeBar * measureWidth}
          y={staffTop - 2}
          width={measureWidth}
          height={staffSpan + 4}
          rx={2}
        />
      )}

      {stringNames.map((label, s) => (
        <g key={label}>
          <text className="bass-tab__label" x="12" y={stringY(s) + 3.5}>
            {label}
          </text>
          <line className="notation__line" x1={STAFF_LEFT} x2={systemEnd} y1={stringY(s)} y2={stringY(s)} />
        </g>
      ))}

      <text className="songsterr__clef" x="29" y={staffTop + staffSpan * 0.22 + 4}>
        T
      </text>
      <text className="songsterr__clef" x="29" y={staffTop + staffSpan * 0.52 + 4}>
        A
      </text>
      <text className="songsterr__clef" x="29" y={staffTop + staffSpan * 0.82 + 4}>
        B
      </text>

      {isFirst && (
        <g className="songsterr__meter">
          <text x="45" y={staffTop + staffSpan * 0.36 + 4}>
            {meter}
          </text>
          <text x="45" y={staffTop + staffSpan * 0.76 + 4}>
            4
          </text>
        </g>
      )}

      <line className="notation__barline" x1={STAFF_LEFT} x2={STAFF_LEFT} y1={staffTop} y2={staffBottom} />

      {bars.map((bar, i) => {
        const barNumber = firstBar + i + 1;
        const xStart = STAFF_LEFT + i * measureWidth;
        const xEnd = xStart + measureWidth;
        const steps = bar.beats.length * division;
        const pad = 10;
        const dx = (measureWidth - 2 * pad) / steps;
        const xStep = (s: number) => xStart + pad + (s + 0.5) * dx;
        const cb = chartBars?.[i];
        const isCurrent = i === activeBar;
        const finalBar = barNumber === totalBars;
        const rhythm = engraveBarRhythm(bar, division);
        const isLoopStart = hasLoop && loop.start! >= bar.start - 0.05 && loop.start! < bar.end - 0.05;
        const isLoopEnd = hasLoop && loop.end! > bar.start + 0.05 && loop.end! <= bar.end + 0.05;

        return (
          <g key={barNumber} className={isCurrent ? 'songsterr__bar is-now' : 'songsterr__bar'}>
            <text className="songsterr__num" x={xStart + 4} y={staffTop - 19}>
              {barNumber}
            </text>

            {isLoopStart && (
              <g className={`songsterr__loop-marker ${loop.enabled ? '' : 'is-off'}`}>
                <line className="songsterr__loop-edge" x1={xStart + 1} x2={xStart + 1} y1={staffTop - 3} y2={staffBottom + 3} />
                <text className="songsterr__loop-tag" x={xStart + 24} y={staffTop - 19}>
                  A
                </text>
              </g>
            )}
            {isLoopEnd && (
              <g className={`songsterr__loop-marker ${loop.enabled ? '' : 'is-off'}`}>
                <line className="songsterr__loop-edge" x1={xEnd - 1} x2={xEnd - 1} y1={staffTop - 3} y2={staffBottom + 3} />
                <text className="songsterr__loop-tag songsterr__loop-tag--end" x={xEnd - 4} y={staffTop - 19}>
                  B
                </text>
              </g>
            )}

            {cb?.chords.map((c, ci) =>
              c.quality === 'N' ? null : (
                <text key={ci} className="bass-tab__chord" x={xStart + pad + c.beat * division * dx} y={staffTop - 7}>
                  {chordName(c, pitch, songKey)}
                </text>
              ),
            )}

            {isCurrent && activeStep >= 0 && (
              <>
                <rect
                  className="songsterr__cursor"
                  x={xStart + pad + activeStep * dx}
                  y={staffTop - 5}
                  width={dx}
                  height={staffSpan + 10}
                  rx={2}
                />
                <line
                  className="songsterr__cursor-line"
                  x1={xStep(activeStep)}
                  x2={xStep(activeStep)}
                  y1={staffTop - 5}
                  y2={staffBottom + 5}
                />
              </>
            )}

            {/* Rhythm stems, beams, stub beams, dots & rests below staff */}
            {!bar.notes.length ? (
              <rect
                className="songsterr__rest"
                x={xStart + measureWidth / 2 - 8}
                y={staffTop + staffSpan / 2 - 2.5}
                width="16"
                height="5"
                rx="1"
              />
            ) : (
              <g>
                {rhythm.restBeats.map((b) => {
                  const rx = xStep(b * division + (division - 1) / 2);
                  const ry = stemTop + 2;
                  return (
                    <path
                      key={`qr${b}`}
                      className="songsterr__qrest"
                      d={`M${rx - 2} ${ry}l4 4-3.5 3.5 3.5 3.5c-2.2 0-3.5 1.8-1.5 3.5`}
                    />
                  );
                })}
                {rhythm.stems.map((st) => (
                  <g key={`st${st.step}`}>
                    {st.kind !== 'none' && (
                      <line
                        className="notation__stem"
                        x1={xStep(st.step)}
                        x2={xStep(st.step)}
                        y1={st.kind === 'half' ? halfStemTop : stemTop}
                        y2={stemBottom}
                      />
                    )}
                    {st.dotted && <circle className="songsterr__dot" cx={xStep(st.step) + 4.5} cy={stemBottom - 5} r="1.5" />}
                    {st.flags > 0 && (
                      <path className="notation__flag" d={`M${xStep(st.step)} ${stemBottom}q6 -4 4.5 -10`} />
                    )}
                    {st.flags === 2 && (
                      <path className="notation__flag" d={`M${xStep(st.step)} ${stemBottom - 5}q6 -4 4.5 -10`} />
                    )}
                  </g>
                ))}
                {rhythm.primaryBeams.map((bm, bi) => (
                  <rect
                    key={`pb${bi}`}
                    className="notation__fill"
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
                      className="notation__fill"
                      x={x1}
                      y={stemBottom - 7.8}
                      width={Math.max(2, x2 - x1)}
                      height="2.8"
                    />
                  );
                })}
                {rhythm.tuplets.map((t, ti) => (
                  <text key={`tu${ti}`} className="notation__tuplet" x={(xStep(t.fromStep) + xStep(t.toStep)) / 2} y={stemBottom + 11}>
                    3
                  </text>
                ))}
              </g>
            )}

            {/* Fret numbers with knockout masks and legato slide lines */}
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
                n.step - prev.step <= division * 2 &&
                (n.slide === 'up' ? n.fret > prev.fret : n.fret < prev.fret);
              const prevW = prev && prev.fret >= 10 ? 15 : 10;
              const x2 = cx - w / 2 - 1.5;
              const x1 = fromPrev ? Math.min(x2 - 3, xStep(prev.step) + prevW / 2 + 1.5) : cx - w / 2 - 10;
              const y1 = n.slide === 'up' ? cy + 3.5 : cy - 3.5;
              const y2 = n.slide === 'up' ? cy - 2.5 : cy + 2.5;
              return <line key={`sl-${n.step}-${ni}`} className="bass-tab__slide" x1={x1} y1={y1} x2={x2} y2={y2} />;
            })}
            {bar.notes.map((n, ni) => {
              if (n.string >= strings) return null;
              const cx = xStep(n.step);
              const cy = stringY(n.string);
              const w = n.fret >= 10 ? 15 : 10;
              const sounding = isCurrent && activeStep >= n.step && activeStep < n.step + n.duration;
              const grade = noteFeedback?.get(`${barNumber - 1}:${n.step}`);
              const gradeClass =
                grade === 'hit'
                  ? 'bass-tab__fret--hit'
                  : grade === 'timing'
                    ? 'bass-tab__fret--timing'
                    : grade === 'wrong' || grade === 'missed'
                      ? 'bass-tab__fret--miss'
                      : '';
              return (
                <g key={`${n.step}-${ni}`} opacity={sounding || grade ? 1 : 0.65 + 0.35 * n.velocity}>
                  <rect className="bass-tab__bg" x={cx - w / 2} y={cy - 6} width={w} height={12} rx={2} />
                  <text className={`bass-tab__fret ${sounding ? 'bass-tab__fret--now' : ''} ${gradeClass}`} x={cx} y={cy + 4}>
                    {n.fret}
                  </text>
                </g>
              );
            })}

            {/* Barline & double final barline */}
            <line className="notation__barline" x1={xEnd} x2={xEnd} y1={staffTop} y2={staffBottom} />
            {finalBar && <line className="notation__barline" x1={xEnd - 4} x2={xEnd - 4} y1={staffTop} y2={staffBottom} />}

            {/* Interactive bar and per-beat seek / Shift+click range-loop hit targets */}
            <g
              role="button"
              tabIndex={0}
              aria-label={`Bar ${barNumber}`}
              className="songsterr__bar-btn"
              onClick={(e) => {
                if (e.shiftKey && onShiftSelectBar) {
                  e.stopPropagation();
                  onShiftSelectBar(bar);
                  return;
                }
                onSeek(Math.max(0, bar.start));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (e.shiftKey && onShiftSelectBar) onShiftSelectBar(bar);
                  else onSeek(Math.max(0, bar.start));
                }
              }}
            >
              <rect className="songsterr__hit" x={xStart} y={staffTop - 16} width={measureWidth} height={staffSpan + 52} />
              {bar.beats.map((bt, bi) => (
                <rect
                  key={bi}
                  className="songsterr__hit"
                  x={xStart + pad + bi * division * dx}
                  y={staffTop - 10}
                  width={division * dx}
                  height={staffSpan + 44}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey && onShiftSelectBar) {
                      onShiftSelectBar(bar);
                      return;
                    }
                    onSeek(Math.max(0, bt));
                  }}
                />
              ))}
            </g>
          </g>
        );
      })}
    </svg>
  );
});
