import type { ReactNode } from 'react';
import { stemMeta } from '../../lib/stemMeta';
import type { SongSource } from '../../lib/types';

interface Props {
  song: SongSource;
  subtitle: string;
  onOpen: () => void;
  action: ReactNode;
}

/** Deterministic artwork colour from the song name. */
function hue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function SongRow({ song, subtitle, onOpen, action }: Props) {
  const h = hue(song.name);
  return (
    <div className="song-row">
      <button type="button" className="song-row__main" onClick={onOpen}>
        <span
          className="song-row__art"
          style={{ background: `linear-gradient(135deg, hsl(${h} 45% 38%), hsl(${(h + 50) % 360} 50% 22%))` }}
        >
          {song.name.charAt(0).toUpperCase()}
        </span>
        <span className="song-row__text">
          <span className="song-row__title">{song.name}</span>
          <span className="song-row__subtitle">
            {song.stems.slice(0, 6).map((s, i) => {
              const { Icon } = stemMeta(s.name);
              return <Icon key={i} size={14} />;
            })}
            <span>{subtitle}</span>
          </span>
        </span>
      </button>
      {action}
    </div>
  );
}
