import { useEffect, useRef, useState } from 'react';
import { detectChords } from '../../audio/chordDetect';
import { beatGrid, type ChordAnalysis } from '../../audio/chords';
import type { Engine, EngineState } from '../../audio/Engine';
import { toast } from '../../lib/toast';
import type { SongSource } from '../../lib/types';

export interface ChordsState {
  status: 'analysing' | 'ready' | 'error';
  analysis: ChordAnalysis | null;
}

/** Bump the version when the chord recogniser changes so stale results aren't reused. */
const chordsKey = (id: string) => `mosaic:chords:v1:${id}`;

function readCachedChords(id: string): ChordAnalysis | null {
  try {
    const raw = localStorage.getItem(chordsKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedChords(id: string, value: ChordAnalysis) {
  try {
    // Millisecond precision is plenty and keeps the entry small.
    const ms = (t: number) => Math.round(t * 1000) / 1000;
    const segments = value.segments.map((s) => ({ ...s, start: ms(s.start), end: ms(s.end) }));
    localStorage.setItem(chordsKey(id), JSON.stringify({ ...value, segments }));
  } catch {
    // storage unavailable — detection just runs again next time
  }
}

/**
 * Chords and key of the song: cached, or recognised once the beats are known (tracked beats, the
 * songs.json tempo, or the metronome grid when tracking failed). Runs once per song; later
 * metronome changes don't move the chords.
 */
export function useChords(engine: Engine, song: SongSource, state: EngineState): ChordsState {
  // Tagged with the engine it belongs to, so switching songs never shows the previous song's chords.
  const [chords, setChords] = useState<ChordsState & { engine: Engine | null }>({ status: 'analysing', analysis: null, engine: null });
  const started = useRef<Engine | null>(null);
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
    if (started.current === engine || state.status !== 'ready') return;
    const cached = song.shareable ? readCachedChords(song.id) : null;
    if (cached?.segments) {
      started.current = engine;
      setChords({ status: 'ready', analysis: cached, engine });
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

    started.current = engine;
    detectChords(engine.chordBuffers(), grid, duration).then(
      (analysis) => {
        if (!alive.current) return;
        setChords({ status: 'ready', analysis, engine });
        if (song.shareable) writeCachedChords(song.id, analysis);
      },
      (e) => {
        if (!alive.current) return;
        console.warn('Chord detection failed', e);
        setChords({ status: 'error', analysis: null, engine });
        toast("Couldn't detect the chords");
      },
    );
  }, [engine, song, state.status, beats, detecting]);

  return chords.engine === engine ? chords : { status: 'analysing', analysis: null };
}
