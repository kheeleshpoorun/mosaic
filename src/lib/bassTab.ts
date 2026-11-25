import { assignBassFingering, bassStrings, type BassAnalysis, type BassBar, type BassStringCount } from '../audio/bass';
import type { ChordAnalysis } from '../audio/chords';
import { chordChart, type ChartBar } from './chordChart';
import { chordName, keyName } from './chords';

const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export interface BassTabExportOptions {
  title: string;
  analysis: BassAnalysis;
  chords?: ChordAnalysis | null;
  bpm: number;
  pitch?: number;
  strings?: BassStringCount;
}

/** MIDI note number to pitch name with octave (e.g. 23 -> B0, 28 -> E1). */
export function midiNoteName(midi: number, flats = false): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${(flats ? FLATS : SHARPS)[pc]}${octave}`;
}

const COUNTS: Record<3 | 4, string[]> = {
  3: ['', '&', 'a'],
  4: ['', 'e', '&', 'a'],
};

function hasAdjacentTwoDigit(bars: BassBar[]): boolean {
  for (const bar of bars) {
    for (let i = 0; i + 1 < bar.notes.length; i++) {
      const a = bar.notes[i];
      const b = bar.notes[i + 1];
      if (a.fret >= 10 && b.step === a.step + 1) return true;
    }
  }
  return false;
}

interface RenderChunk {
  kind: 'bars' | 'rests';
  startBar: number;
  endBar: number;
}

function groupBars(bars: BassBar[], perSystem: number): RenderChunk[] {
  const chunks: RenderChunk[] = [];
  let i = 0;
  while (i < bars.length) {
    if (bars[i].kind === 'rest') {
      let j = i;
      while (j < bars.length && bars[j].kind === 'rest') j++;
      if (j - i >= 4) {
        chunks.push({ kind: 'rests', startBar: i, endBar: j - 1 });
        i = j;
        continue;
      }
    }
    const end = Math.min(bars.length - 1, i + perSystem - 1);
    chunks.push({ kind: 'bars', startBar: i, endBar: end });
    i = end + 1;
  }
  return chunks;
}

function formatSystem(
  bars: BassBar[],
  firstIndex: number,
  chartBars: ChartBar[] | null,
  chords: ChordAnalysis | null | undefined,
  pitch: number,
  division: 3 | 4,
  strings: BassStringCount,
): string {
  const stringNames = bassStrings(strings);
  const stepsPerBar = bars[0].beats.length * division;
  const colWidth = hasAdjacentTwoDigit(bars) ? 3 : 2;

  let barHeader = '  ';
  let chordLine = '  ';
  let hasChords = false;
  const stringLines = stringNames.map((name) => `${name}|`);
  let countLine = '  ';

  bars.forEach((bar, idx) => {
    const barNum = String(firstIndex + idx + 1);
    const barStartPos = stringLines[0].length;

    barHeader = barHeader.padEnd(barStartPos, ' ') + barNum;

    const cb = chartBars?.[firstIndex + idx];
    if (cb && cb.chords.length) {
      for (const c of cb.chords) {
        if (c.quality === 'N') continue;
        hasChords = true;
        const label = chordName(c, pitch, chords?.key ?? null);
        const colPos = barStartPos + 1 + c.beat * division * colWidth;
        const padded = chordLine.length < colPos ? chordLine.padEnd(colPos, ' ') : `${chordLine} `;
        chordLine = padded + label;
      }
    }

    const leadDash = stringNames.map(() => '-');
    const cells = stringNames.map(() => Array.from({ length: stepsPerBar }, () => '-'.repeat(colWidth)));
    for (const note of bar.notes) {
      if (note.step < 0 || note.step >= stepsPerBar || note.string < 0 || note.string >= stringNames.length) continue;
      const fStr = String(note.fret);
      cells[note.string][note.step] = fStr.padEnd(colWidth, '-');
      if (note.slide) {
        const sym = note.slide === 'up' ? '/' : '\\';
        if (note.step === 0) {
          leadDash[note.string] = sym;
        } else {
          const prevCell = cells[note.string][note.step - 1];
          if (prevCell.endsWith('-')) {
            cells[note.string][note.step - 1] = prevCell.slice(0, -1) + sym;
          }
        }
      }
    }
    for (let s = 0; s < stringNames.length; s++) {
      stringLines[s] += `${leadDash[s]}${cells[s].join('')}|`;
    }

    let counts = ' ';
    for (let step = 0; step < stepsPerBar; step++) {
      const label = step % division === 0 ? String(Math.floor(step / division) + 1) : COUNTS[division][step % division];
      counts += label.padEnd(colWidth, ' ');
    }
    countLine += counts + ' ';
  });

  const lines = [barHeader.trimEnd()];
  if (hasChords) lines.push(chordLine.trimEnd());
  lines.push(...stringLines);
  lines.push(countLine.trimEnd());
  return lines.join('\n');
}

/** Plain-text 4- or 5-string ASCII tablature systems for preview & copy. */
export function formatBassTabText({ analysis, chords, pitch = 0, strings = 5 }: BassTabExportOptions): string {
  const { bars, meter, division } = analysis;
  if (!bars.length) return 'No bass notes detected.';
  const fingered = pitch || strings !== 5 ? assignBassFingering(bars, pitch, strings, division) : bars;
  const chartBars = chords?.segments.length ? chordChart(chords.segments, fingered) : null;
  const stepsPerBar = meter * division;
  const perSystem = stepsPerBar >= 16 ? 2 : 3;
  const chunks = groupBars(fingered, perSystem);

  return chunks
    .map((chunk) => {
      if (chunk.kind === 'rests') {
        const count = chunk.endBar - chunk.startBar + 1;
        return `Bars ${chunk.startBar + 1}–${chunk.endBar + 1} — Rest (${count} bars)`;
      }
      return formatSystem(fingered.slice(chunk.startBar, chunk.endBar + 1), chunk.startBar, chartBars, chords, pitch, division, strings);
    })
    .join('\n\n');
}

/** Complete Markdown (.md) bass tablature document with key, BPM, chords, and bar numbers. */
export function formatBassTabMarkdown(opts: BassTabExportOptions): string {
  const { title, analysis, chords, bpm, pitch = 0, strings = 5 } = opts;
  const { bars, meter, division, swing } = analysis;
  const fingered = pitch || strings !== 5 ? assignBassFingering(bars, pitch, strings, division) : bars;
  const chartBars = chords?.segments.length ? chordChart(chords.segments, fingered) : null;

  const pitchTag = pitch ? ` (transposed ${pitch > 0 ? `+${pitch}` : pitch} semitones)` : '';
  const tuning = strings === 4 ? '4-string standard (E–A–D–G)' : '5-string standard (B–E–A–D–G)';
  const meta = [
    `- **Tuning:** ${tuning}${pitchTag}`,
    chords?.key ? `- **Key:** ${keyName(chords.key, pitch)}` : null,
    `- **Tempo:** ${Math.round(bpm)} BPM`,
    `- **Time:** ${meter}/4 (${swing ? 'Shuffle' : 'Straight'})`,
  ].filter(Boolean);

  if (!fingered.length || !fingered.some((b) => b.notes.length > 0)) {
    return [`# ${title} — Bass Tablature`, '', ...meta, '', 'No bass notes detected.', ''].join('\n');
  }

  const stepsPerBar = meter * division;
  const perSystem = stepsPerBar >= 16 ? 2 : 3;
  const chunks = groupBars(fingered, perSystem);

  const body = chunks.map((chunk) => {
    if (chunk.kind === 'rests') {
      const count = chunk.endBar - chunk.startBar + 1;
      return `### Bars ${chunk.startBar + 1}–${chunk.endBar + 1} — Rest (${count} bars)`;
    }
    const sys = formatSystem(fingered.slice(chunk.startBar, chunk.endBar + 1), chunk.startBar, chartBars, chords, pitch, division, strings);
    return `### Bars ${chunk.startBar + 1}–${chunk.endBar + 1}\n\n\`\`\`text\n${sys}\n\`\`\``;
  });

  return [`# ${title} — Bass Tablature`, '', ...meta, '', ...body, ''].join('\n');
}

/** Triggers a browser download of the song's Markdown bass tablature (`<slug>-bass-tab.md`). */
export function downloadBassTabMarkdown(slug: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-bass-tab.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Songsterr-style rhythm engraving ----------

export interface EngravedStem {
  step: number;
  kind: 'none' | 'half' | 'full';
  dotted: boolean;
  flags: 0 | 1 | 2;
}

export interface EngravedBeam {
  fromStep: number;
  toStep: number;
  /** Present for isolated 16th-note stub beamlets pointing inward toward their beat partner. */
  stub?: 'left' | 'right';
}

export interface BarRhythm {
  stems: EngravedStem[];
  primaryBeams: EngravedBeam[];
  secondaryBeams: EngravedBeam[];
  tuplets: { fromStep: number; toStep: number }[];
  /** Silent beat indices (0..meter-1) within an active bar that need a quarter rest. */
  restBeats: number[];
}

/**
 * Computes per-beat rhythmic stems, 8th/16th beams, stub beamlets, augmentation dots, tuplets,
 * and quarter rests for one bar of Songsterr-style tablature.
 */
export function engraveBarRhythm(bar: BassBar, division: 3 | 4): BarRhythm {
  const stems: EngravedStem[] = [];
  const primaryBeams: EngravedBeam[] = [];
  const secondaryBeams: EngravedBeam[] = [];
  const tuplets: { fromStep: number; toStep: number }[] = [];
  const restBeats: number[] = [];

  if (!bar.notes.length) return { stems, primaryBeams, secondaryBeams, tuplets, restBeats };

  const stepsPerBar = bar.beats.length * division;

  for (let b = 0; b < bar.beats.length; b++) {
    const beatStart = b * division;
    const beatEnd = beatStart + division;
    const inBeat = bar.notes.filter((n) => n.step >= beatStart && n.step < beatEnd).sort((a, c) => a.step - c.step);

    if (!inBeat.length) {
      const sustained = bar.notes.some((n) => n.step < beatStart && n.step + n.duration > beatStart);
      if (!sustained) restBeats.push(b);
      continue;
    }

    if (inBeat.length === 1) {
      const n = inBeat[0];
      if (n.step === 0 && n.duration >= stepsPerBar) {
        stems.push({ step: n.step, kind: 'none', dotted: false, flags: 0 });
      } else if (division === 4 && n.duration >= 8 && n.step % 4 === 0) {
        stems.push({ step: n.step, kind: 'half', dotted: n.duration >= 12, flags: 0 });
      } else if ((division === 4 && n.duration >= 4) || (division === 3 && n.duration >= 3)) {
        stems.push({ step: n.step, kind: 'full', dotted: division === 4 && n.duration >= 6 && n.step % 4 === 0, flags: 0 });
      } else if (division === 4 && n.duration === 3) {
        stems.push({ step: n.step, kind: 'full', dotted: true, flags: 1 });
      } else if ((division === 4 && n.duration === 2) || division === 3) {
        stems.push({ step: n.step, kind: 'full', dotted: false, flags: 1 });
      } else {
        stems.push({ step: n.step, kind: 'full', dotted: false, flags: 2 });
      }
      continue;
    }

    primaryBeams.push({ fromStep: inBeat[0].step, toStep: inBeat.at(-1)!.step });
    if (division === 3) {
      tuplets.push({ fromStep: inBeat[0].step, toStep: inBeat.at(-1)!.step });
    }

    const effectiveGaps = inBeat.map((n, i) => Math.min(n.duration, (inBeat[i + 1]?.step ?? beatEnd) - n.step));
    inBeat.forEach((n, i) => {
      stems.push({
        step: n.step,
        kind: 'full',
        dotted: division === 4 && effectiveGaps[i] === 3,
        flags: 0,
      });
    });

    if (division === 4) {
      const is16 = inBeat.map((n, i) => effectiveGaps[i] === 1 || n.step % 2 === 1);
      let idx = 0;
      while (idx < is16.length) {
        if (!is16[idx]) {
          idx++;
          continue;
        }
        let end = idx;
        while (end + 1 < is16.length && is16[end + 1]) end++;
        if (end > idx) {
          secondaryBeams.push({ fromStep: inBeat[idx].step, toStep: inBeat[end].step });
        } else {
          secondaryBeams.push({
            fromStep: inBeat[idx].step,
            toStep: inBeat[idx].step,
            stub: idx + 1 < inBeat.length ? 'right' : 'left',
          });
        }
        idx = end + 1;
      }
    }
  }

  return { stems, primaryBeams, secondaryBeams, tuplets, restBeats };
}
