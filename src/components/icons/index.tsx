import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

// ---------- stem icons (line style, as in the Moises mixer) ----------

export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5v4" />
  </Svg>
);

export const DrumIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="11" cy="11" rx="8.5" ry="3" />
    <path d="M2.5 11v6c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-6" />
    <path d="M6 13.6v5.8M11 14v6M16 13.6v5.8" />
    <path d="M10 10.5 21.5 3.5" />
    <path d="M13.5 9 18 2.5" />
  </Svg>
);

export const BassIcon = (p: IconProps) => (
  <Svg {...p}>
    {/* Tilted bass headstock with four tuners on one side (traced from the Moises icon) */}
    <g transform="translate(12 12) scale(1.22) translate(-11.2 -11.05)" strokeWidth={1.5 / 1.22}>
      <path d="M11.4 4.6C11.9 3.9 12.6 3.8 13.4 3.8c1.6 0 2.8 1.1 2.7 2.6-.1 1.2-1.1 1.8-1.8 2.5-.4.5-.1 1.5.3 2.4.4 1 0 2-.5 3.1-.4 1-.5 1.9-.5 2.8v1.1H9.9v-.7c0-.6-.7-.8-1.3-1.2-.6-.4-.6-1.1-.4-1.8l3.2-10Z" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.9" cy="5.3" r="0.9" />
        <circle cx="8" cy="8" r="0.9" />
        <circle cx="7.2" cy="10.7" r="0.9" />
        <circle cx="6.3" cy="13.5" r="0.9" />
      </g>
    </g>
  </Svg>
);

export const PianoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 20.5v-11a7 7 0 0 1 7-7c3.2 0 4.6 2.4 5.6 4.8.8 1.9 2.2 2.7 3.9 3.2.9.3 1.5 1.1 1.5 2v8H3Z" />
    <path d="M3 14.5h18" />
    <path d="M6.5 14.5v6M10 14.5v6M13.5 14.5v6M17 14.5v6" />
  </Svg>
);

export const GuitarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5c0-.6.5-1 1-1h6c.5 0 1 .4 1 1l.8 9.5c.2 2.5-1.2 4.1-2.3 5.2v3.3h-5v-3.3c-1.1-1.1-2.5-2.7-2.3-5.2L8 3.5Z" />
    <circle cx="5.3" cy="5" r=".7" fill="currentColor" />
    <circle cx="5" cy="9" r=".7" fill="currentColor" />
    <circle cx="5.3" cy="13" r=".7" fill="currentColor" />
    <circle cx="18.7" cy="5" r=".7" fill="currentColor" />
    <circle cx="19" cy="9" r=".7" fill="currentColor" />
    <circle cx="18.7" cy="13" r=".7" fill="currentColor" />
  </Svg>
);

export const NoteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 17.5V5.5l11-3v12" />
    <ellipse cx="6.5" cy="17.5" rx="2.5" ry="2" />
    <ellipse cx="17.5" cy="14.5" rx="2.5" ry="2" />
  </Svg>
);

export const KeysIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
    <path d="M7 6v12M12 6v12M17 6v12" />
    <path d="M5.5 6v6h2.5V6M10.5 6v6H13V6M15.5 6v6H18V6" fill="currentColor" stroke="none" />
  </Svg>
);

export const StringsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.5v4" />
    <path d="M9.5 6.5h5c.5 2-1.5 3 0 4.5s2.8 2.7 2.3 5.5c-.5 3-2.6 5-4.8 5s-4.3-2-4.8-5c-.5-2.8.8-4 2.3-5.5s-.5-2.5 0-4.5Z" />
    <path d="M10.5 13.5h3M12 6.5v12" />
  </Svg>
);

export const WindIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 9.5h14.5l3.5-2v9l-3.5-2H3Z" />
    <circle cx="7" cy="12" r=".7" fill="currentColor" />
    <circle cx="10" cy="12" r=".7" fill="currentColor" />
    <circle cx="13" cy="12" r=".7" fill="currentColor" />
  </Svg>
);

/** Muted overlay: diagonal slash drawn over a stem icon. */
export const MuteSlash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18" strokeWidth={1.7} />
  </Svg>
);

// ---------- UI icons ----------

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 9 7 6 7-6" strokeWidth={1.8} />
  </Svg>
);

export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
    <path d="M8 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-2" />
  </Svg>
);

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3.5-3.5a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3.5 3.5a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

export const MoreVerticalIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </Svg>
);

export const MetronomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.2 3h5.6l4.7 17.5h-15L9.2 3Z" />
    <path d="M5.3 16.5h13.4" />
    <path d="m12 13.5 7-9" />
  </Svg>
);

export const RewindIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="currentColor" strokeWidth={1}>
    <path d="M11.5 6.5v11L3 12l8.5-5.5ZM21 6.5v11L12.5 12 21 6.5Z" />
  </Svg>
);

export const ForwardIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="currentColor" strokeWidth={1}>
    <path d="M12.5 6.5v11L21 12l-8.5-5.5ZM3 6.5v11L11.5 12 3 6.5Z" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="currentColor" strokeWidth={1.2}>
    <path d="M6.5 3.8v16.4c0 .6.7 1 1.2.7l13-8.2a.8.8 0 0 0 0-1.4l-13-8.2c-.5-.3-1.2.1-1.2.7Z" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="5.5" y="3.5" width="4.5" height="17" rx="1.2" />
    <rect x="14" y="3.5" width="4.5" height="17" rx="1.2" />
  </Svg>
);

/** "♭♯" key / pitch control. */
export const PitchIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 8v13.5c2.4-.8 4.5-2.3 4.5-4.4 0-1.7-1.8-2.4-4.5-.6" />
    <path d="M14 4.5v8.5M18 3.5v8.5M12.5 7.2l7-1.8M12.5 10.7l7-1.8" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15.5V4" />
    <path d="m7 8.5 5-5 5 5" />
    <path d="M4 14.5v3.5A2.5 2.5 0 0 0 6.5 20.5h11a2.5 2.5 0 0 0 2.5-2.5v-3.5" />
  </Svg>
);

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" strokeWidth={1.8} />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" strokeWidth={1.8} />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" strokeWidth={1.8} />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" strokeWidth={1.8} />
  </Svg>
);

export const WaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" strokeWidth={1.8} />
  </Svg>
);

export const HeartIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none" aria-hidden={p['aria-label'] ? undefined : true}>
    <path d="M12 21s-7.5-4.6-9.6-9.4C.9 8.2 3 4 6.9 4c2.2 0 3.8 1.2 5.1 3 1.3-1.8 2.9-3 5.1-3 3.9 0 6 4.2 4.5 7.6C19.5 16.4 12 21 12 21Z" />
  </Svg>
);
