import { useEffect, useMemo, useRef, useState } from 'react';
import { BASS_MAX_FRET, BASS_STRINGS, type BassAnalysis } from '../../audio/bass';
import { detectBass } from '../../audio/bassDetect';
import { beatGrid } from '../../audio/chords';
import type { Engine, EngineState } from '../../audio/Engine';
import { isNumber, isNumberArray, readAnalysis, writeAnalysis } from '../../lib/analysisCache';
import { toast } from '../../lib/toast';
import type { SongSource } from '../../lib/types';
import type { DrumsState } from './useDrums';

export interface BassState {
  /** 'none': the song has no bass stem. */
  status: 'analysing' | 'ready' | 'error' | 'none';
  analysis: BassAnalysis | null;
}

/** Shape check for cached bass transcription before rendering sheets or strips. */
function isBassAnalysis(value: unknown): value is BassAnalysis {
  const a = value as Partial<BassAnalysis> | null;
  if (!a || (a.meter !== 3 && a.meter !== 4) || (a.division !== 3 && a.division !== 4) || typeof a.swing !== 'boolean' || !Array.isArray(a.bars)) {
    return false;
  }
  const steps = a.meter * a.division;
  return a.bars.every(
    (b) =>
      isNumber(b?.start) &&
      isNumber(b.end) &&
      isNumberArray(b.beats) &&
      ['riff', 'fill', 'rest'].includes(b.kind) &&
      Number.isInteger(b.riff) &&
      typeof b.repeat === 'boolean' &&
      Array.isArray(b.notes) &&
      b.notes.every(
        (n) =>
          Number.isInteger(n?.step) &&
          n.step >= 0 &&
          n.step < steps &&
          Number.isInteger(n.midi) &&
          Number.isInteger(n.string) &&
          n.string >= 0 &&
          n.string < BASS_STRINGS.length &&
          Number.isInteger(n.fret) &&
          n.fret >= 0 &&
          n.fret <= BASS_MAX_FRET &&
          Number.isInteger(n.duration) &&
          n.duration >= 1 &&
          isNumber(n.velocity) &&
          (n.slide === undefined || n.slide === 'up' || n.slide === 'down'),
      ),
  );
}

/**
 * 5-string bass tablature transcription of the bass stem: cached, or analysed once beats and drum
 * meter/feel are known. Runs once per song; later metronome changes don't move the bars.
 */
export function useBass(engine: Engine, song: SongSource, state: EngineState, drums: DrumsState, run: number): BassState {
  const job = useMemo(() => ({ engine, run }), [engine, run]);
  const [bass, setBass] = useState<BassState & { job: object | null }>({ status: 'analysing', analysis: null, job: null });
  const started = useRef<object | null>(null);
  const alive = useRef(true);
  const { beats, detecting } = state.metronome;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current === job || state.status !== 'ready') return;
    const buffer = engine.bassBuffer();
    if (!buffer) {
      started.current = job;
      setBass({ status: 'none', analysis: null, job });
      return;
    }
    const cached = song.shareable ? readAnalysis('bass', song.id, isBassAnalysis) : null;
    if (cached) {
      started.current = job;
      setBass({ status: 'ready', analysis: cached, job });
      return;
    }

    const m = engine.getState().metronome;
    const { duration } = engine.getState();
    let grid: number[];
    let downbeat = 0;
    if (song.bpm) grid = beatGrid(song.bpm, song.offset ?? 0, duration);
    else if (m.beats?.length) {
      grid = m.beats;
      downbeat = m.downbeat;
    } else if (m.detecting) return; // wait for the beat tracker
    else grid = beatGrid(m.bpm, m.offset, duration);

    // Wait for drums analysis so meter/feel and waltz downbeat match the rest of the charts.
    if (drums.status === 'analysing') return;

    const meter = drums.analysis?.meter ?? 4;
    const division = drums.analysis?.division ?? 4;
    const swing = drums.analysis?.swing ?? false;
    if (drums.analysis?.bars.length && grid.length) {
      const b1Start = drums.analysis.bars[1]?.start ?? drums.analysis.bars[0].start;
      const match = grid.findIndex((t) => Math.abs(t - b1Start) < 0.02);
      if (match >= 0) downbeat = match % meter;
    }

    started.current = job;
    detectBass(buffer, grid, downbeat, duration, meter, division, swing).then(
      (analysis) => {
        if (!alive.current || started.current !== job) return;
        setBass({ status: 'ready', analysis, job });
        if (song.shareable) writeAnalysis('bass', song.id, analysis);
      },
      (e) => {
        if (!alive.current || started.current !== job) return;
        console.warn('Bass transcription failed', e);
        setBass({ status: 'error', analysis: null, job });
        toast("Couldn't transcribe the bass tab");
      },
    );
  }, [job, engine, song, state.status, beats, detecting, drums.status, drums.analysis]);

  return bass.job === job ? bass : { status: 'analysing', analysis: null };
}
