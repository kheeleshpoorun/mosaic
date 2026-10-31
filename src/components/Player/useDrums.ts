import { useEffect, useMemo, useRef, useState } from 'react';
import { detectDrums } from '../../audio/drumDetect';
import { LANES, type DrumAnalysis } from '../../audio/drums';
import { beatGrid } from '../../audio/chords';
import type { Engine, EngineState } from '../../audio/Engine';
import { isNumber, isNumberArray, readAnalysis, writeAnalysis } from '../../lib/analysisCache';
import { toast } from '../../lib/toast';
import type { SongSource } from '../../lib/types';

export interface DrumsState {
  /** 'none': the song has no drums stem. */
  status: 'analysing' | 'ready' | 'error' | 'none';
  analysis: DrumAnalysis | null;
}

/** A cached result the sheets can draw: every bar with one row of steps per lane. */
function isDrumAnalysis(value: unknown): value is DrumAnalysis {
  const a = value as Partial<DrumAnalysis> | null;
  if (!a || (a.meter !== 3 && a.meter !== 4) || (a.division !== 3 && a.division !== 4) || !Array.isArray(a.bars)) return false;
  const steps = a.meter * a.division;
  return a.bars.every(
    (b) =>
      isNumber(b?.start) &&
      isNumber(b.end) &&
      isNumberArray(b.beats) &&
      ['groove', 'fill', 'rest'].includes(b.kind) &&
      isNumber(b.groove) &&
      Array.isArray(b.steps) &&
      b.steps.length === LANES.length &&
      b.steps.every((lane) => isNumberArray(lane) && lane.length === steps),
  );
}

/**
 * Grooves of the drums stem: cached, or recognised once the beats are known (tracked beats, the
 * songs.json tempo, or the metronome grid when tracking failed). Runs once per song; later
 * metronome changes don't move the bars.
 */
export function useDrums(engine: Engine, song: SongSource, state: EngineState, run: number): DrumsState {
  // One job per engine and run (Re-analyse song starts a new one). Results are tagged with their job,
  // so switching songs or re-analysing never shows an earlier job's grooves.
  const job = useMemo(() => ({ engine, run }), [engine, run]);
  const [drums, setDrums] = useState<DrumsState & { job: object | null }>({ status: 'analysing', analysis: null, job: null });
  const started = useRef<object | null>(null);
  const alive = useRef(true);
  const { beats, detecting } = state.metronome;

  // A result arriving after unmount is dropped. (Not tied to the effect below: once started, a later
  // beat change must not cancel the running analysis.)
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current === job || state.status !== 'ready') return;
    const buffer = engine.drumBuffer();
    if (!buffer) {
      started.current = job;
      setDrums({ status: 'none', analysis: null, job });
      return;
    }
    const cached = song.shareable ? readAnalysis('drums', song.id, isDrumAnalysis) : null;
    if (cached) {
      started.current = job;
      setDrums({ status: 'ready', analysis: cached, job });
      return;
    }
    // Read the engine directly: the beats effect may have updated it in this same commit.
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

    started.current = job;
    detectDrums(buffer, grid, downbeat, duration).then(
      (analysis) => {
        if (!alive.current || started.current !== job) return;
        setDrums({ status: 'ready', analysis, job });
        if (song.shareable) writeAnalysis('drums', song.id, analysis);
      },
      (e) => {
        if (!alive.current || started.current !== job) return;
        console.warn('Drum detection failed', e);
        setDrums({ status: 'error', analysis: null, job });
        toast("Couldn't detect the drum grooves");
      },
    );
  }, [job, engine, song, state.status, beats, detecting]);

  return drums.job === job ? drums : { status: 'analysing', analysis: null };
}
