/** Helpers shared by the engine's tests and its review script. Not used by the app. */
import {
  DEFAULT_PLANS,
  type Catalog,
  type CatalogItem,
  type EngineContext,
  type PersonId,
  type PickEntry,
  type PlanSelection,
  type SeenEntry,
  type SuggestRequest,
} from '../contracts';
import { FIXTURE_CATALOG } from '../contracts/fixtures/catalog';
import { defaultProfile } from './learn';

export const TODAY = '2026-10-10';

export interface CtxSetup {
  catalog?: Catalog;
  plans?: PlanSelection;
  /** Ids (watched at an unknown time) or id -> YYYY-MM-DD last watched. */
  seen?: Partial<Record<PersonId, string[] | Record<string, string>>>;
  /** Titles on the Matches tab. */
  picks?: { itemId: string; who: PickEntry['who']; at?: number }[];
  never?: Partial<Record<PersonId, string[]>>;
  /** itemId -> date swiped. */
  notTonight?: Partial<Record<PersonId, Record<string, string>>>;
  today?: string;
}

const stamp = (ids: string[] = []): Record<string, number> => Object.fromEntries(ids.map((id) => [id, 1]));
/** Noon UTC on a YYYY-MM-DD date, as a ms timestamp. */
export const dayMs = (date: string): number => Date.parse(`${date}T12:00:00Z`);
const seenMap = (v: string[] | Record<string, string> | undefined): Record<string, SeenEntry> =>
  Array.isArray(v) || !v
    ? Object.fromEntries((v ?? []).map((id) => [id, { at: 1, source: 'manual' as const }]))
    : Object.fromEntries(Object.entries(v).map(([id, date]) => [id, { at: dayMs(date), source: 'manual' as const }]));

export function makePick(itemId: string, who: PickEntry['who'], at = 1): PickEntry {
  return {
    id: `pick-${itemId}-${who}`,
    at,
    kind: who === 'Together' ? 'match' : 'solo',
    who,
    itemId,
    snapshot: { title: itemId, year: 2020, poster: null },
    pick: { type: 'series-start' },
    service: { serviceId: 'netflix', planId: 'standard', adFree: true },
  };
}

export function makeCtx(setup: CtxSetup = {}): EngineContext {
  const catalog = setup.catalog ?? FIXTURE_CATALOG;
  return {
    catalog,
    today: setup.today ?? TODAY,
    state: {
      profiles: { HG: defaultProfile('HG', catalog), BG: defaultProfile('BG', catalog) },
      seen: { HG: seenMap(setup.seen?.HG), BG: seenMap(setup.seen?.BG) },
      never: { HG: stamp(setup.never?.HG), BG: stamp(setup.never?.BG) },
      notTonight: { HG: { ...(setup.notTonight?.HG ?? {}) }, BG: { ...(setup.notTonight?.BG ?? {}) } },
      picks: (setup.picks ?? []).map((p) => makePick(p.itemId, p.who, p.at)),
      settings: { plans: setup.plans ?? { ...DEFAULT_PLANS } },
    },
  };
}

export function req(over: Partial<SuggestRequest> = {}): SuggestRequest {
  return { who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either', genre: null, ...over };
}

export function itemsById(catalog: Catalog): Map<string, CatalogItem> {
  return new Map(catalog.items.map((i) => [i.id, i]));
}

/**
 * A big catalog for performance tests: the fixture cloned and perturbed
 * (deterministically) until it has `size` titles.
 */
export function syntheticCatalog(size: number, base: Catalog = FIXTURE_CATALOG): Catalog {
  const items: CatalogItem[] = [...base.items];
  const extraKeywords = ['heist', 'road trip', 'small business', 'robot', 'wedding', 'court', 'island', 'space', 'school', 'ghost town', 'chef', 'journalist', 'band', 'farm', 'submarine', 'detective', 'royalty', 'sports', 'hacker', 'circus'];
  let n = 0;
  while (items.length < size) {
    const src = base.items[n % base.items.length];
    const k = Math.floor(n / base.items.length) + 1;
    const tmdbId = 1_000_000 + n;
    const keywords = [...src.keywords.slice(0, 4), extraKeywords[(n * 7) % extraKeywords.length], extraKeywords[(n * 13 + k) % extraKeywords.length], `theme ${n % 400}`];
    items.push({
      ...src,
      id: `${src.kind}-${tmdbId}`,
      tmdbId,
      title: `${src.title} ${k + 1}`,
      keywords,
      related: [src.id, base.items[(n * 5 + k) % base.items.length].id],
      rating: Math.max(4, Math.min(9.2, src.rating - 1.5 + ((n * 37) % 30) / 10)),
      votes: 20 + ((n * 7919) % 9000),
      popularity: 1 + ((n * 104729) % 500),
      runtime: src.kind === 'movie' ? 80 + ((n * 11) % 90) : src.runtime,
    });
    n++;
  }
  return { ...base, items };
}
