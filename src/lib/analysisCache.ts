import versions from 'virtual:analyser-versions';

/** Analyses whose results are cached per library song. */
export type AnalysisKind = keyof typeof versions;

/**
 * Analysis results cached in localStorage as `mosaic:<kind>:<version>:<song id>`. The version is a
 * hash of the analyser's source (scripts/analyser-versions.ts), so changing an analyser makes older
 * results unreachable without a hand-bumped key. Reads also check the shape, and writes drop the
 * song's results from older analysers.
 */
const prefix = (kind: AnalysisKind) => `mosaic:${kind}:`;
const keyOf = (kind: AnalysisKind, id: string) => `${prefix(kind)}${versions[kind]}:${id}`;

/** This song's keys for one kind, from any analyser version. */
function keysOf(kind: AnalysisKind, id: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix(kind))) continue;
    const rest = key.slice(prefix(kind).length);
    const colon = rest.indexOf(':');
    if (colon > 0 && rest.slice(colon + 1) === id) out.push(key);
  }
  return out;
}

export function readAnalysis<T>(kind: AnalysisKind, id: string, valid: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(keyOf(kind, id));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (valid(value)) return value;
    localStorage.removeItem(keyOf(kind, id));
  } catch {
    // unreadable — detection just runs again
  }
  return null;
}

export function writeAnalysis(kind: AnalysisKind, id: string, value: unknown) {
  try {
    for (const key of keysOf(kind, id)) localStorage.removeItem(key);
    localStorage.setItem(keyOf(kind, id), JSON.stringify(value));
  } catch {
    // storage unavailable — detection just runs again next time
  }
}

/** Forgets every cached analysis of the song (Re-analyse song). */
export function clearAnalyses(id: string) {
  try {
    for (const kind of Object.keys(versions) as AnalysisKind[]) for (const key of keysOf(kind, id)) localStorage.removeItem(key);
  } catch {
    // storage unavailable — nothing cached
  }
}

export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNumber);
