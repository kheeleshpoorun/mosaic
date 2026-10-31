import { useMemo } from 'react';
import { firstBeatAtOrAfter } from '../../audio/metronome';

interface Span {
  start: number;
  end: number;
}

/** Index of the segment (chord, drum bar, …) playing at `t` (-1 before the first one or in a gap). */
export function segmentAt(segments: Span[], starts: number[], t: number): number {
  const i = firstBeatAtOrAfter(starts, t + 1e-6) - 1;
  return i >= 0 && t < segments[i].end ? i : -1;
}

/** Segment starts, for binary search with segmentAt. */
export function useStarts(segments: Span[] | undefined): number[] {
  return useMemo(() => segments?.map((s) => s.start) ?? [], [segments]);
}
