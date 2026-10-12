/** New-arrivals diff between this build and the previous one. Pure. */
import type { Catalog, CatalogItem, NewArrival, NewArrivals } from '../../src/contracts/catalog';
import { daysBetween } from './util';

/** pool.json: every title seen on our providers in a build (not just the ones that made the catalog). */
export interface Pool {
  schema: 1;
  builtAt: string;
  /** Provider ids the build covered. A title only on providers outside this list is not "new" when a service is first added. */
  ids?: number[];
  /** id -> [providers, seasons?] */
  titles: Record<string, { p: number[]; s?: number }>;
}

export type PrevState = Map<string, { providers: number[]; seasons?: number }>;

/** Previous state from the previous build's pool and per-service catalog files (any may be missing). */
export function prevFromPool(pool: Pool | null, catalogs: Catalog | Catalog[] | null): PrevState | null {
  const list = catalogs ? (Array.isArray(catalogs) ? catalogs : [catalogs]) : [];
  const m: PrevState = new Map();
  for (const c of list) for (const i of c.items) m.set(i.id, { providers: i.providers, seasons: i.seasons });
  if (pool) for (const [id, v] of Object.entries(pool.titles)) m.set(id, { providers: v.p, seasons: v.s });
  return pool || list.length ? m : null;
}

/** The provider ids the previous build covered (from the pool, else from what its titles were on). */
export function prevUniverse(pool: Pool | null, prev: PrevState | null): Set<number> | undefined {
  if (pool?.ids?.length) return new Set(pool.ids);
  if (!prev) return undefined;
  const u = new Set<number>();
  for (const v of prev.values()) for (const p of v.providers) u.add(p);
  return u;
}

export interface DateInfo {
  /** Release date (movie) or first air date (tv). */
  releaseDate?: string;
  seasonPremieres: { season: number; airDate: string }[];
}

export const WINDOW_DAYS = 30;
/** The arrivals file keeps at most this many entries (newest first). */
export const MAX_ENTRIES = 400;

export interface DiffInput {
  items: CatalogItem[];
  prev: PrevState | null;
  prevNew: NewArrivals | null;
  today: string;
  builtAt: string;
  info: Map<string, DateInfo>;
  /** Providers the previous build covered; titles only on other providers (a newly added service) are not arrivals. */
  knownProviders?: Set<number>;
}

export interface DiffResult {
  arrivals: NewArrivals;
  addedTitles: number;
  addedSeasons: number;
  fromDates: boolean;
  suspicious: boolean;
}

export function diffArrivals(x: DiffInput): DiffResult {
  const { items, prev, today } = x;
  const fresh: NewArrival[] = [];
  let suspicious = false;
  const fromDates = prev === null;

  if (prev) {
    for (const i of items) {
      const before = prev.get(i.id);
      if (!before) {
        if (x.knownProviders && !i.providers.some((p) => x.knownProviders!.has(p))) continue;
        fresh.push({ itemId: i.id, type: 'title', providers: i.providers, date: today });
      }
      else if (i.kind === 'tv' && before.seasons && i.seasons && i.seasons > before.seasons)
        fresh.push({ itemId: i.id, type: 'season', season: i.seasons, providers: i.providers, date: today });
    }
    // A glitch (e.g. TMDB returning partial provider data yesterday) must not flood the feed.
    const titles = fresh.filter((f) => f.type === 'title').length;
    if (titles > Math.max(60, items.length * 0.15)) {
      suspicious = true;
      fresh.splice(0, fresh.length, ...fresh.filter((f) => f.type === 'season'));
    }
  } else {
    // First ever build: derive from release / season premiere dates within the window.
    for (const i of items) {
      const info = x.info.get(i.id);
      if (!info) continue;
      if (i.kind === 'movie') {
        if (info.releaseDate && inWindow(info.releaseDate, today)) fresh.push({ itemId: i.id, type: 'title', providers: i.providers, date: info.releaseDate });
        continue;
      }
      const recent = info.seasonPremieres.filter((s) => inWindow(s.airDate, today)).sort((a, b) => b.season - a.season)[0];
      if (!recent) continue;
      if (recent.season > 1) fresh.push({ itemId: i.id, type: 'season', season: recent.season, providers: i.providers, date: recent.airDate });
      else fresh.push({ itemId: i.id, type: 'title', providers: i.providers, date: recent.airDate });
    }
  }

  // Merge with the previous rolling window.
  const present = new Set(items.map((i) => i.id));
  const key = (e: NewArrival) => `${e.itemId}|${e.type}|${e.season ?? ''}`;
  const merged = new Map<string, NewArrival>();
  for (const e of fresh) merged.set(key(e), e);
  for (const e of x.prevNew?.entries ?? []) {
    if (!present.has(e.itemId)) continue;
    if (daysBetween(e.date, today) > WINDOW_DAYS) continue;
    if (!merged.has(key(e))) merged.set(key(e), e);
  }
  const entries = [...merged.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MAX_ENTRIES);
  return {
    arrivals: { schema: 1, builtAt: x.builtAt, entries },
    addedTitles: fresh.filter((f) => f.type === 'title').length,
    addedSeasons: fresh.filter((f) => f.type === 'season').length,
    fromDates,
    suspicious,
  };
}

function inWindow(date: string, today: string): boolean {
  const d = daysBetween(date, today);
  return d >= 0 && d <= WINDOW_DAYS;
}
