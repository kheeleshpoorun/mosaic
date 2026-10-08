import { useCallback, useEffect, useState } from 'react';
import { Home } from './components/Home/Home';
import { Player } from './components/Player/Player';
import { Toast } from './components/Toast';
import { librarySongs } from './lib/library';
import { toast } from './lib/toast';
import type { SongSource } from './lib/types';

/** Resolves the current URL (?song=<slug> for library songs, ?import=<id> for this session's imports). */
function songFromUrl(imports: SongSource[]): SongSource | null {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('song');
  if (slug) return librarySongs.find((s) => s.id === slug) ?? null;
  const importId = params.get('import');
  if (importId) return imports.find((s) => s.id === importId) ?? null;
  return null;
}

function urlFor(song: SongSource | null): string {
  const url = new URL(window.location.href);
  url.search = '';
  if (song) url.searchParams.set(song.shareable ? 'song' : 'import', song.id);
  return url.toString();
}

export default function App() {
  const [imports, setImports] = useState<SongSource[]>([]);
  const [current, setCurrent] = useState<SongSource | null>(() => songFromUrl([]));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('song') && !current) toast('Song not found');
    if (!current && (params.has('song') || params.has('import'))) history.replaceState(null, '', urlFor(null));
  }, []);

  useEffect(() => {
    const onPop = () => setCurrent(songFromUrl(imports));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [imports]);

  const open = useCallback((song: SongSource) => {
    history.pushState({ fromHome: true }, '', urlFor(song));
    setCurrent(song);
  }, []);

  const close = useCallback(() => {
    // Shared links land directly on the player, so there may be no history entry to go back to.
    if (history.state?.fromHome) history.back();
    else history.pushState(null, '', urlFor(null));
    setCurrent(null);
  }, []);

  const addImports = useCallback(
    (songs: SongSource[]) => {
      setImports((prev) => [...songs, ...prev]);
      if (songs.length === 1) open(songs[0]);
    },
    [open],
  );

  const removeImport = useCallback((id: string) => setImports((prev) => prev.filter((s) => s.id !== id)), []);

  useEffect(() => {
    document.title = current ? `${current.name} · Mosaic` : 'Mosaic';
  }, [current]);

  return (
    <>
      {current ? (
        <Player key={current.id} song={current} onClose={close} />
      ) : (
        <Home library={librarySongs} imports={imports} onOpen={open} onImport={addImports} onRemoveImport={removeImport} />
      )}
      <Toast />
    </>
  );
}
