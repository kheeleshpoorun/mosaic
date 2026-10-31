import { useEffect, useMemo, useRef, useState } from 'react';
import { detectChords } from '../../audio/chordDetect';
import { beatGrid, type ChordAnalysis } from '../../audio/chords';
import type { Engine, EngineState } from '../../audio/Engine';
import { isNumber, readAnalysis, writeAnalysis } from '../../lib/analysisCache';
import { toast } from '../../lib/toast';
import type { SongSource } from '../../lib/types';

export interface ChordsState {
  status: 'analysing' | 'ready' | 'error';
  analysis: ChordAnalysis | null;
}

const QUALITIES = ['maj', 'min', '7', 'maj7', 'm7', 'N'];

/** A cached result the strip and sheet can draw. */
function isChordAnalysis(value: unknown): value is ChordAnalysis {
  const a = value as Partial<ChordAnalysis> | null;
  const key = a?.key;
  return (
    !!a &&
    Array.isArray(a.segments) &&
    a.segments.every((s) => isNumber(s?.start) && isNumber(s.end) && Number.isInteger(s.root) && QUALITIES.includes(s.quality)) &&
    (key === null || (!!key && Number.isInteger(key.tonic) && (key.mode === 'major' || key.mode === 'minor') && isNumber(key.confidence)))
  );
}

function writeCachedChords(id: string, value: ChordAnalysis) {
  // Millisecond precision is plenty and keeps the entry small.
  const ms = (t: number) => Math.round(t * 1000) / 1000;
  const segments = value.segments.map((s) => ({ ...s, start: ms(s.start), end: ms(s.end) }));
  writeAnalysis('chords', id, { ...value, segments });
}

/**
 * Chords and key of the song: cached, or recognised once the beats are known (tracked beats, the
 * songs.json tempo, or the metronome grid when tracking failed). Runs once per song; later
 * metronome changes don't move the chords.
 */
export function useChords(engine: Engine, song: SongSource, state: EngineState, run: number): ChordsState {
  // One job per engine and run (Re-analyse song starts a new one). Results are tagged with their job,
  // so switching songs or re-analysing never shows an earlier job's chords.
  const job = useMemo(() => ({ engine, run }), [engine, run]);
  const [chords, setChords] = useState<ChordsState & { job: object | null }>({ status: 'analysing', analysis: null, job: null });
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
    const cached = song.shareable ? readAnalysis('chords', song.id, isChordAnalysis) : null;
    if (cached) {
      started.current = job;
      setChords({ status: 'ready', analysis: cached, job });
      return;
    }
    // Read the engine directly: the beats effect may have updated it in this same commit.
    const m = engine.getState().metronome;
    const { duration } = engine.getState();
    let grid: number[];
    if (song.bpm) grid = beatGrid(song.bpm, song.offset ?? 0, duration);
    else if (m.beats?.length) grid = m.beats;
    else if (m.detecting) return; // wait for the beat tracker
    else grid = beatGrid(m.bpm, m.offset, duration);

    started.current = job;
    detectChords(engine.chordBuffers(), grid, duration).then(
      (analysis) => {
        if (!alive.current || started.current !== job) return;
        setChords({ status: 'ready', analysis, job });
        if (song.shareable) writeCachedChords(song.id, analysis);
      },
      (e) => {
        if (!alive.current || started.current !== job) return;
        console.warn('Chord detection failed', e);
        setChords({ status: 'error', analysis: null, job });
        toast("Couldn't detect the chords");
      },
    );
  }, [job, engine, song, state.status, beats, detecting]);

  return chords.job === job ? chords : { status: 'analysing', analysis: null };
}
