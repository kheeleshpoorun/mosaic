import { useRef, useState, type DragEvent } from 'react';
import { filesFromDataTransfer, songsFromFiles } from '../../lib/importFiles';
import { AUDIO_EXTENSIONS } from '../../lib/parseStemName';
import { shareSong } from '../../lib/share';
import { downloadSong, isSongSaved, removeSong } from '../../lib/stemCache';
import { toast } from '../../lib/toast';
import type { SongSource } from '../../lib/types';
import { Footer } from '../Footer';
import { CloseIcon, LinkIcon, UploadIcon, WaveIcon } from '../icons';
import { DownloadButton } from './DownloadButton';
import { SongRow } from './SongRow';
import { useSavedStems } from './useSavedStems';

interface Props {
  library: SongSource[];
  imports: SongSource[];
  onOpen: (song: SongSource) => void;
  onImport: (songs: SongSource[]) => void;
  onRemoveImport: (id: string) => void;
}

const ACCEPT = AUDIO_EXTENSIONS.map((e) => `.${e}`).join(',') + ',audio/*';

export function Home({ library, imports, onOpen, onImport, onRemoveImport }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const saved = useSavedStems();
  const [downloads, setDownloads] = useState<Record<string, number>>({});
  const [removing, setRemoving] = useState<SongSource | null>(null);

  const savedSongs = library.filter((s) => isSongSaved(s, saved));
  const savedMb = Math.round([...saved.values()].reduce((a, b) => a + b, 0) / 1e6);

  async function download(song: SongSource) {
    setDownloads((d) => ({ ...d, [song.id]: 0 }));
    try {
      await downloadSong(song, (f) => setDownloads((d) => (song.id in d ? { ...d, [song.id]: f } : d)));
      toast('Saved for offline');
    } catch (e) {
      toast(navigator.onLine ? (e as Error).message || 'Download failed' : "You're offline");
    } finally {
      setDownloads(({ [song.id]: _, ...rest }) => rest);
    }
  }

  function handleFiles(files: File[]) {
    const songs = songsFromFiles(files);
    if (songs.length === 0) {
      toast('No audio files found');
      return;
    }
    onImport(songs);
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    handleFiles(await filesFromDataTransfer(e.dataTransfer));
  }

  return (
    <div
      className="screen home"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="home__header">
        <div className="brand">
          <span className="brand__mark">
            <WaveIcon size={20} />
          </span>
          Mosaic
        </div>
      </header>

      <button
        type="button"
        className={`dropzone ${dragging ? 'dropzone--active' : ''}`}
        onClick={() => inputRef.current?.click()}
      >
        <span className="dropzone__icon">
          <UploadIcon size={28} />
        </span>
        <span className="dropzone__title">Drop your stems here</span>
        <span className="dropzone__hint">
          Drag the files exported from Moises (e.g. <em>Song_vocals_mixed.mp3</em>), or a folder of them
        </span>
        <span className="pill-button">Browse files</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          handleFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />

      {imports.length > 0 && (
        <section className="song-list">
          <h2 className="section-title">Imported</h2>
          <p className="section-hint">Plays on this device only — imported songs can't be shared.</p>
          {imports.map((song) => (
            <SongRow
              key={song.id}
              song={song}
              subtitle={`${song.stems.length} stems · Local`}
              onOpen={() => onOpen(song)}
              action={
                <button type="button" className="icon-button" aria-label="Remove" onClick={() => onRemoveImport(song.id)}>
                  <CloseIcon size={20} />
                </button>
              }
            />
          ))}
        </section>
      )}

      <section className="song-list">
        <h2 className="section-title">Library</h2>
        {savedSongs.length > 0 && (
          <p className="section-hint">
            {savedSongs.length} saved for offline · {savedMb} MB
          </p>
        )}
        {library.length === 0 ? (
          <p className="section-hint">No shared songs yet. Add stems to the library folder of the repo.</p>
        ) : (
          library.map((song) => (
            <SongRow
              key={song.id}
              song={song}
              subtitle={`${song.stems.length} stems`}
              onOpen={() => onOpen(song)}
              action={
                <>
                  <DownloadButton
                    saved={isSongSaved(song, saved)}
                    progress={downloads[song.id] ?? null}
                    onDownload={() => void download(song)}
                    onRemove={() => setRemoving(song)}
                  />
                  <button type="button" className="icon-button" aria-label="Copy share link" onClick={() => shareSong(song)}>
                    <LinkIcon size={20} />
                  </button>
                </>
              }
            />
          ))
        )}
      </section>

      <Footer />

      {dragging && <div className="drop-overlay">Drop to import</div>}

      {removing && (
        <div className="modal-backdrop" onClick={() => setRemoving(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Remove download"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal__title">Remove download?</h2>
            <p className="modal__text">
              <strong>{removing.name}</strong> will need the network again next time you open it.
            </p>
            <div className="modal__actions">
              <button type="button" className="pill-button pill-button--outline" onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="pill-button"
                onClick={() => {
                  void removeSong(removing);
                  setRemoving(null);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
