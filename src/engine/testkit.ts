/** Helpers shared by the engine's tests and its review script. Not used by the app. */
import {
  DEFAULT_PLANS,
  type Catalog,
  type CatalogItem,
  type EngineContext,
  type PersonId,
  type PlanSelection,
  type SuggestRequest,
} from '../contracts';
import { FIXTURE_CATALOG } from '../contracts/fixtures/catalog';
import { defaultProfile } from './learn';

export const TODAY = '2026-10-10';

export interface CtxSetup {
  catalog?: Catalog;
  plans?: PlanSelection;
  seen?: Partial<Record<PersonId, string[]>>;
  never?: Partial<Record<PersonId, string[]>>;
  /** itemId -> date swiped. */
  notTonight?: Partial<Record<PersonId, Record<string, string>>>;
  today?: string;
}

const stamp = (ids: string[] = []): Record<string, number> => Object.fromEntries(ids.map((id) => [id, 1]));

export function makeCtx(setup: CtxSetup = {}): EngineContext {
  const catalog = setup.catalog ?? FIXTURE_CATALOG;
  return {
    catalog,
    today: setup.today ?? TODAY,
    state: {
      profiles: { HG: defaultProfile('HG', catalog), BG: defaultProfile('BG', catalog) },
      seen: { HG: stamp(setup.seen?.HG), BG: stamp(setup.seen?.BG) },
      never: { HG: stamp(setup.never?.HG), BG: stamp(setup.never?.BG) },
      notTonight: { HG: { ...(setup.notTonight?.HG ?? {}) }, BG: { ...(setup.notTonight?.BG ?? {}) } },
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
