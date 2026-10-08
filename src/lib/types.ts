export interface StemSource {
  name: string;
  /** Remote URL (library songs) */
  url?: string;
  /** Local file (imported songs) */
  file?: File;
}

export interface SongSource {
  id: string;
  name: string;
  /** Library songs can be shared with ?song=<id>; imports cannot. */
  shareable: boolean;
  bpm?: number;
  /** Seconds from the start of the track to the first beat. */
  offset?: number;
  stems: StemSource[];
}

export interface LibraryManifest {
  songs: {
    slug: string;
    name: string;
    bpm?: number;
    offset?: number;
    stems: { name: string; file: string }[];
  }[];
}
