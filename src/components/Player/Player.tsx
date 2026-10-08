import { useCallback, useEffect, useState } from 'react';
import { detectBeats } from '../../audio/bpm';
import { Engine } from '../../audio/Engine';
import { useEngineState, usePosition } from '../../audio/hooks';
import { shareSong } from '../../lib/share';
import { stemMeta } from '../../lib/stemMeta';
import { toast } from '../../lib/toast';
import type { SongSource } from '../../lib/types';
import { Footer } from '../Footer';
import { ChevronDownIcon, MoreVerticalIcon, ShareIcon } from '../icons';
import { LoadingModal } from './LoadingModal';
import { MetronomeSheet } from './MetronomeSheet';
import { PitchSpeedSheet } from './PitchSpeedSheet';
import { SeekBar } from './SeekBar';
import { MenuItem, Sheet } from './Sheet';
import { StemRow } from './StemRow';
import { Transport } from './Transport';

type Panel = null | 'metronome' | 'pitch' | 'menu' | { stem: number };

/** Bump the version when the beat tracker changes so stale results aren't reused. */
const beatsKey = (id: string) => `mosaic:beats:v2:${id}`;

interface CachedBeats {
  bpm: number;
  beats: number[];
  downbeat: number;
}

function readCachedBeats(id: string): CachedBeats | null {
  try {
    // Caches from before the rename to Mosaic (the old fixed-grid one could be badly off).
    localStorage.removeItem(`moise:bpm:${id}`);
    localStorage.removeItem(`moise:beats:v2:${id}`);
    const raw = localStorage.getItem(beatsKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedBeats(id: string, value: CachedBeats) {
  try {
    // Millisecond precision is plenty and keeps the entry small.
    const beats = value.beats.map((b) => Math.round(b * 1000) / 1000);
    localStorage.setItem(beatsKey(id), JSON.stringify({ ...value, beats }));
  } catch {
    // storage unavailable — detection just runs again next time
  }
}

export function Player({ song, onClose }: { song: SongSource; onClose: () => void }) {
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    const e = new Engine(song);
    setEngine(e);
    // Test/debug hook used by the Playwright suite.
    (window as unknown as { __mosaicEngine?: Engine }).__mosaicEngine = e;
    return () => e.dispose();
  }, [song]);

  if (!engine) return <div className="screen player" />;
  return <PlayerView engine={engine} song={song} onClose={onClose} />;
}

function PlayerView({ engine, song, onClose }: { engine: Engine; song: SongSource; onClose: () => void }) {
  const state = useEngineState(engine);
  const position = usePosition(engine, state.playing);
  const [panel, setPanel] = useState<Panel>(null);
  const closePanel = useCallback(() => setPanel(null), []);

  const runDetection = useCallback(async () => {
    engine.setMetronome({ detecting: true });
    try {
      const buffer = engine.tempoBuffer();
      if (!buffer) throw new Error('No audio to analyse');
      const result = await detectBeats(buffer);
      engine.setMetronome({ ...result, offset: 0, detecting: false });
      if (song.shareable) writeCachedBeats(song.id, result);
    } catch (e) {
      console.warn('Beat detection failed', e);
      engine.setMetronome({ detecting: false });
      toast("Couldn't detect the tempo — set it manually");
    }
  }, [engine, song]);

  // Beats: songs.json fixed tempo override → cached tracking → track now.
  useEffect(() => {
    if (state.status !== 'ready' || song.bpm) return;
    const cached = song.shareable ? readCachedBeats(song.id) : null;
    if (cached?.beats?.length) engine.setMetronome({ ...cached, offset: 0 });
    else void runDetection();
  }, [state.status]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      if (e.code === 'Space') {
        e.preventDefault();
        engine.toggle();
      } else if (e.code === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) engine.skip(-5);
      else if (e.code === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) engine.skip(5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  return (
    <div className="screen player">
      <header className="player__header">
        <button type="button" className="icon-button" aria-label="Back to songs" onClick={onClose}>
          <ChevronDownIcon size={30} />
        </button>
        <h1 className="player__title" title={song.name}>
          {song.name}
        </h1>
        <button type="button" className="icon-button" aria-label="Share" onClick={() => shareSong(song)}>
          <ShareIcon size={28} />
        </button>
        <button type="button" className="icon-button" aria-label="More options" onClick={() => setPanel('menu')}>
          <MoreVerticalIcon size={26} />
        </button>
      </header>

      {state.status === 'loading' && <LoadingModal songName={song.name} state={state} />}
      {state.status === 'error' && (
        <div className="modal-backdrop">
          <div className="modal modal--error" role="alertdialog" aria-modal="true" aria-label="Error">
            <p className="modal__title">{state.error}</p>
            <button type="button" className="pill-button" onClick={onClose}>
              Back
            </button>
          </div>
        </div>
      )}

      <div className="stems">
        {state.stems.map((_, i) => (
          <StemRow key={i} engine={engine} stems={state.stems} index={i} onMenu={() => setPanel({ stem: i })} />
        ))}
      </div>

      <div className="player__bottom">
        <SeekBar engine={engine} state={state} position={position} />
        <Transport engine={engine} state={state} onMetronome={() => setPanel('metronome')} onPitch={() => setPanel('pitch')} />
        <Footer />
      </div>

      {panel === 'metronome' && <MetronomeSheet engine={engine} state={state} onClose={closePanel} onDetect={runDetection} />}
      {panel === 'pitch' && <PitchSpeedSheet engine={engine} state={state} onClose={closePanel} />}
      {panel === 'menu' && (
        <Sheet title={song.name} onClose={closePanel}>
          {song.shareable && (
            <MenuItem
              onClick={() => {
                closePanel();
                void shareSong(song);
              }}
            >
              Copy share link
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              engine.resetMix();
              closePanel();
            }}
          >
            Reset mix
          </MenuItem>
          <MenuItem onClick={onClose}>Back to songs</MenuItem>
        </Sheet>
      )}
      {typeof panel === 'object' && panel !== null && (
        <Sheet title={stemMeta(state.stems[panel.stem].name).label} onClose={closePanel}>
          <MenuItem active={state.stems[panel.stem].soloed} onClick={() => engine.toggleSolo(panel.stem)}>
            Solo
          </MenuItem>
          <MenuItem active={state.stems[panel.stem].muted} onClick={() => engine.toggleMute(panel.stem)}>
            Mute
          </MenuItem>
          <MenuItem
            onClick={() => {
              engine.resetStem(panel.stem);
              closePanel();
            }}
          >
            Reset volume
          </MenuItem>
        </Sheet>
      )}
    </div>
  );
}
