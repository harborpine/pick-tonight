/**
 * Watched titles (pure helpers shared by the memory and Firebase implementations).
 * Stored per member in SEEN_SHARDS documents; each title is ONE JSON string (a single indexed value).
 */
import type { SeenEntry, SeenInput, SeenSource } from '../contracts';

/** Detail shards per member. Spreads titles so no document gets near 1 MiB. */
export const SEEN_SHARDS = 8;
/** Titles written per network request (one atomic batch). Keeps requests ~250 KB. */
export const SEEN_CHUNK = 1000;
/** Most watched titles one person can have (keeps a household's storage bounded). */
export const SEEN_MAX = 10000;

/** Stable shard number (0..SEEN_SHARDS-1) for a title id. Must never change once data exists. */
export function shardOf(itemId: string): number {
  let h = 5381;
  for (let i = 0; i < itemId.length; i++) h = ((h * 33) ^ itemId.charCodeAt(i)) >>> 0;
  return h % SEEN_SHARDS;
}

const SOURCES: SeenSource[] = ['manual', 'import', 'onboarding'];

export function encodeSeen(e: SeenEntry): string {
  const o: Record<string, unknown> = { at: e.at, source: e.source };
  if (e.plays !== undefined) o.plays = e.plays;
  if (e.snapshot) o.snapshot = e.snapshot;
  return JSON.stringify(o);
}

export function decodeSeen(raw: unknown): SeenEntry | null {
  if (typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as Partial<SeenEntry> | null;
    if (!o || typeof o !== 'object' || typeof o.at !== 'number') return null;
    const e: SeenEntry = { at: o.at, source: SOURCES.includes(o.source as SeenSource) ? (o.source as SeenSource) : 'manual' };
    if (typeof o.plays === 'number') e.plays = o.plays;
    if (o.snapshot && typeof o.snapshot === 'object') e.snapshot = o.snapshot;
    return e;
  } catch {
    return null;
  }
}

/** Decode a map of JSON strings, dropping anything unreadable. */
export function decodeSeenMap(raw: Record<string, unknown> | undefined): Record<string, SeenEntry> {
  const out: Record<string, SeenEntry> = {};
  for (const [id, v] of Object.entries(raw ?? {})) {
    const e = decodeSeen(v);
    if (e) out[id] = e;
  }
  return out;
}

/** Combine inputs for the same title inside one call, then with what is already stored. */
export function mergeSeenInputs(
  inputs: SeenInput[],
  existing: Record<string, SeenEntry>,
  now: number,
): Record<string, SeenEntry> {
  const next: Record<string, SeenEntry> = {};
  for (const inp of inputs) {
    const prev = next[inp.itemId] ?? existing[inp.itemId];
    const at = Math.max(inp.at ?? now, prev?.at ?? 0);
    const plays = prev?.plays !== undefined || inp.plays !== undefined ? Math.max(prev?.plays ?? 0, inp.plays ?? 0) : undefined;
    const e: SeenEntry = { at, source: inp.source, snapshot: inp.snapshot };
    if (plays !== undefined) e.plays = plays;
    next[inp.itemId] = e;
  }
  return next;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
