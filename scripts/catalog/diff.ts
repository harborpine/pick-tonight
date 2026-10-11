/** New-arrivals diff between this build and the previous one. Pure. */
import type { Catalog, CatalogItem, NewArrival, NewArrivals } from '../../src/contracts/catalog';
import { daysBetween } from './util';

/** pool.json: every title seen on our providers in a build (not just the ones that made the catalog). */
export interface Pool {
  schema: 1;
  builtAt: string;
  /** id -> [providers, seasons?] */
  titles: Record<string, { p: number[]; s?: number }>;
}

export type PrevState = Map<string, { providers: number[]; seasons?: number }>;

export function prevFromPool(pool: Pool | null, catalog: Catalog | null): PrevState | null {
  const m: PrevState = new Map();
  if (catalog) for (const i of catalog.items) m.set(i.id, { providers: i.providers, seasons: i.seasons });
  if (pool) for (const [id, v] of Object.entries(pool.titles)) m.set(id, { providers: v.p, seasons: v.s });
  return pool || catalog ? m : null;
}

export interface SeedInfo {
  /** Release date (movie) or first air date (tv). */
  releaseDate?: string;
  seasonPremieres: { season: number; airDate: string }[];
}

export const WINDOW_DAYS = 30;

export interface DiffInput {
  items: CatalogItem[];
  prev: PrevState | null;
  prevNew: NewArrivals | null;
  today: string;
  builtAt: string;
  info: Map<string, SeedInfo>;
}

export interface DiffResult {
  arrivals: NewArrivals;
  addedTitles: number;
  addedSeasons: number;
  seeded: boolean;
  suspicious: boolean;
}

export function diffArrivals(x: DiffInput): DiffResult {
  const { items, prev, today } = x;
  const fresh: NewArrival[] = [];
  let suspicious = false;
  const seeded = prev === null;

  if (prev) {
    for (const i of items) {
      const before = prev.get(i.id);
      if (!before) fresh.push({ itemId: i.id, type: 'title', providers: i.providers, date: today });
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
    // First ever build: seed from release / season premiere dates within the window.
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
  const entries = [...merged.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return {
    arrivals: { schema: 1, builtAt: x.builtAt, entries },
    addedTitles: fresh.filter((f) => f.type === 'title').length,
    addedSeasons: fresh.filter((f) => f.type === 'season').length,
    seeded,
    suspicious,
  };
}

function inWindow(date: string, today: string): boolean {
  const d = daysBetween(date, today);
  return d >= 0 && d <= WINDOW_DAYS;
}
