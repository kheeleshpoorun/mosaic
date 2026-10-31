import { useEffect, useRef, useState } from 'react';
import { detectDrums } from '../../audio/drumDetect';
import type { DrumAnalysis } from '../../audio/drums';
import { beatGrid } from '../../audio/chords';
import type { Engine, EngineState } from '../../audio/Engine';
import { toast } from '../../lib/toast';
import type { SongSource } from '../../lib/types';

export interface DrumsState {
  /** 'none': the song has no drums stem. */
  status: 'analysing' | 'ready' | 'error' | 'none';
  analysis: DrumAnalysis | null;
}

/** Bump the version when the drum recogniser changes so stale results aren't reused. */
const drumsKey = (id: string) => `mosaic:drums:v1:${id}`;

function readCachedDrums(id: string): DrumAnalysis | null {
  try {
    const raw = localStorage.getItem(drumsKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedDrums(id: string, value: DrumAnalysis) {
  try {
    localStorage.setItem(drumsKey(id), JSON.stringify(value));
  } catch {
    // storage unavailable — detection just runs again next time
  }
}

/**
 * Grooves of the drums stem: cached, or recognised once the beats are known (tracked beats, the
 * songs.json tempo, or the metronome grid when tracking failed). Runs once per song; later
 * metronome changes don't move the bars.
 */
export function useDrums(engine: Engine, song: SongSource, state: EngineState): DrumsState {
  // Tagged with the engine it belongs to, so switching songs never shows the previous song's grooves.
  const [drums, setDrums] = useState<DrumsState & { engine: Engine | null }>({ status: 'analysing', analysis: null, engine: null });
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
    const buffer = engine.drumBuffer();
    if (!buffer) {
      started.current = engine;
      setDrums({ status: 'none', analysis: null, engine });
      return;
    }
    const cached = song.shareable ? readCachedDrums(song.id) : null;
    if (cached?.bars) {
      started.current = engine;
      setDrums({ status: 'ready', analysis: cached, engine });
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

    started.current = engine;
    detectDrums(buffer, grid, downbeat, duration).then(
      (analysis) => {
        if (!alive.current) return;
        setDrums({ status: 'ready', analysis, engine });
        if (song.shareable) writeCachedDrums(song.id, analysis);
      },
      (e) => {
        if (!alive.current) return;
        console.warn('Drum detection failed', e);
        setDrums({ status: 'error', analysis: null, engine });
        toast("Couldn't detect the drum grooves");
      },
    );
  }, [engine, song, state.status, beats, detecting]);

  return drums.engine === engine ? drums : { status: 'analysing', analysis: null };
}
