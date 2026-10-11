/**
 * Watched titles (pure helpers shared by the memory and Firebase implementations).
 *
 * Storage (see README.md): the OLD per-person number map (`seen_HG.m.{id} = ms`) is kept exactly as it
 * always was, so the old app version keeps working. The new details (source, plays, title snapshot) live
 * in separate shard documents (`seenx/HG_3`) that the old app never reads.
 */
import type { PersonId, SeenEntry, SeenInput, SeenSource } from '../contracts';

/** Detail shards per person. Spreads the details so no document gets near 1 MiB. */
export const SEEN_SHARDS = 8;
/** Titles written per network request (one atomic batch). Keeps requests ~250 KB. */
export const SEEN_CHUNK = 1000;
/**
 * Most watched titles one person can have. Firestore allows 40,000 index entries per document and the legacy
 * number map (kept for the old app) uses 2 per title; measured against the live project: 19,900 worked, 20,100 failed.
 */
export const SEEN_MAX = 19500;

/** Stable shard number (0..SEEN_SHARDS-1) for a title id. Must never change once data exists. */
export function shardOf(itemId: string): number {
  let h = 5381;
  for (let i = 0; i < itemId.length; i++) h = ((h * 33) ^ itemId.charCodeAt(i)) >>> 0;
  return h % SEEN_SHARDS;
}

export const shardDocId = (p: PersonId, shard: number): string => `${p}_${shard}`;

const SOURCES: SeenSource[] = ['manual', 'import', 'onboarding'];

/**
 * Details are stored as ONE JSON string per title: a string is a single indexed value, whereas a nested
 * map would use ~6 of the 40,000 index entries Firestore allows per document.
 */
export function encodeDetail(e: SeenEntry): string {
  const o: Record<string, unknown> = { at: e.at, source: e.source };
  if (e.plays !== undefined) o.plays = e.plays;
  if (e.snapshot) o.snapshot = e.snapshot;
  return JSON.stringify(o);
}

export function decodeDetail(raw: unknown): SeenEntry | null {
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

/**
 * Reads ANY stored shape into SeenEntry values:
 *  - old number n                 -> { at: n, source: 'manual' }
 *  - a full SeenEntry object      -> as is (tolerated in case a later version stores objects in `m`)
 * Membership comes only from `m` (so a title the OLD app un-marks disappears even if details linger).
 * `at` always comes from `m` (so a re-mark made by the OLD app wins); other details come from `details`.
 */
export function normalizeSeen(m: Record<string, unknown> | undefined, details?: Record<string, string>): Record<string, SeenEntry> {
  const out: Record<string, SeenEntry> = {};
  for (const [id, v] of Object.entries(m ?? {})) {
    if (typeof v === 'number') {
      const d = decodeDetail(details?.[id]);
      out[id] = d ? { ...d, at: v } : { at: v, source: 'manual' };
    } else if (v && typeof v === 'object' && typeof (v as SeenEntry).at === 'number') {
      out[id] = { ...(v as SeenEntry) };
    }
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
