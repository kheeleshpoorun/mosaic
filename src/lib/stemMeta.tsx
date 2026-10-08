import type { ComponentType, SVGProps } from 'react';
import {
  BassIcon,
  DrumIcon,
  GuitarIcon,
  KeysIcon,
  MicIcon,
  NoteIcon,
  PianoIcon,
  StringsIcon,
  WindIcon,
} from '../components/icons';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface StemMeta {
  label: string;
  Icon: Icon;
  order: number;
}

const KNOWN: { match: RegExp; meta: StemMeta }[] = [
  { match: /vocal|voice|vox|sing/, meta: { label: 'Vocals', Icon: MicIcon, order: 0 } },
  { match: /drum|perc|beat/, meta: { label: 'Drums', Icon: DrumIcon, order: 1 } },
  { match: /bass/, meta: { label: 'Bass', Icon: BassIcon, order: 2 } },
  { match: /piano/, meta: { label: 'Piano', Icon: PianoIcon, order: 3 } },
  { match: /key|synth|organ/, meta: { label: 'Keys', Icon: KeysIcon, order: 4 } },
  { match: /guitar/, meta: { label: 'Guitar', Icon: GuitarIcon, order: 5 } },
  { match: /string|violin|cello/, meta: { label: 'Strings', Icon: StringsIcon, order: 6 } },
  { match: /wind|brass|sax|horn|flute|trumpet/, meta: { label: 'Wind', Icon: WindIcon, order: 7 } },
  { match: /other|instrument|accomp/, meta: { label: 'Other', Icon: NoteIcon, order: 9 } },
];

export function stemMeta(name: string): StemMeta {
  const n = name.toLowerCase();
  const hit = KNOWN.find((k) => k.match.test(n));
  if (hit) return hit.meta;
  return { label: name.charAt(0).toUpperCase() + name.slice(1), Icon: NoteIcon, order: 8 };
}

export function sortStems<T extends { name: string }>(stems: T[]): T[] {
  return [...stems].sort((a, b) => stemMeta(a.name).order - stemMeta(b.name).order || a.name.localeCompare(b.name));
}
