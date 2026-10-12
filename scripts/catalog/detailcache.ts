/**
 * Cache of TMDB title details between daily runs, so a normal day only re-fetches a fraction of the titles.
 * Each entry lives 3-6 days (spread by title id so refreshes are spread evenly across days). Today's
 * discovery results are overlaid on top, so a title that just arrived on a service shows up immediately;
 * a title that left a service can stay listed for at most the entry's lifetime.
 */
import type { Parsed } from './parse';

export interface CachedDetail {
  at: number;
  parsed: Parsed;
}
export type DetailStore = Record<string, CachedDetail>;

const DAY = 86_400_000;

function hash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

/** Days an entry for `key` stays fresh: 3, 4, 5 or 6. */
export function ttlDays(key: string): number {
  return 3 + (hash(key) % 4);
}

export function isFresh(entry: CachedDetail | undefined, key: string, now: number): entry is CachedDetail {
  return !!entry && now - entry.at >= 0 && now - entry.at < ttlDays(key) * DAY;
}

/** Providers = what the (possibly cached) detail says, plus every provider today's discovery saw the title on. */
export function overlayProviders(parsed: Parsed, observed: Iterable<number> | undefined): Parsed {
  if (!observed) return parsed;
  const set = new Set(parsed.providers);
  for (const p of observed) set.add(p);
  if (set.size === parsed.providers.length) return parsed;
  return { ...parsed, providers: [...set].sort((a, b) => a - b) };
}

/** Entries to drop: not wanted today and past twice their lifetime (so the store cannot grow forever). */
export function pruneStore(store: DetailStore, wanted: Set<string>, now: number): number {
  let dropped = 0;
  for (const [key, e] of Object.entries(store)) {
    if (!wanted.has(key) && now - e.at > 2 * ttlDays(key) * DAY) {
      delete store[key];
      dropped++;
    }
  }
  return dropped;
}
