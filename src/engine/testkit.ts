/**
 * Helpers shared by the engine's tests and its review script. Not used by the app.
 *
 * THE TEST PEOPLE (nobody real; nothing here ships):
 *   alex  the fixture's comedy / adult-animation / fantasy fan (14 favourites), no never-show-me choices
 *   sam   the fixture's drama / reality / competition fan (22 favourites); never horror, true crime or anything scary
 *   kit   the fixture's brand-new person: no favourites, no history (cold start)
 *   dee   a fourth person for households of four: three favourites; never reality TV, nothing not in English
 *
 * `makeCtx()` with no arguments is a household of two (alex and sam). Pass
 * `members` for any other household: ['kit'] is a person using the app alone,
 * ['alex', 'sam', 'kit', 'dee'] a full house.
 */
import {
  NO_DEALBREAKERS,
  normalizeWho,
  type Catalog,
  type CatalogItem,
  type Dealbreakers,
  type EngineContext,
  type FavoriteTitle,
  type Member,
  type MemberId,
  type PickEntry,
  type PlanSelection,
  type Profile,
  type SeenEntry,
  type SuggestRequest,
  type Who,
} from '../contracts';
import { FIXTURE_CATALOG, FIXTURE_FAVORITES, FIXTURE_MEMBERS, FIXTURE_PLANS } from '../contracts/fixtures/catalog';
import { emptyProfile } from './learn';

export const TODAY = '2026-10-10';

/** The sample household's plans (six services, several ad tiers). */
export const PLANS: PlanSelection = FIXTURE_PLANS;

// ---- audiences -------------------------------------------------------------
export const ALEX: Who = ['alex'];
export const SAM: Who = ['sam'];
export const KIT: Who = ['kit'];
export const DEE: Who = ['dee'];
/** alex and sam together. */
export const BOTH: Who = ['alex', 'sam'];
export const HOUSE_OF_FOUR: MemberId[] = ['alex', 'sam', 'kit', 'dee'];

/** Every non-empty audience that can be drawn from a household (1, 3, 7 or 15 of them). */
export function audiencesOf(members: MemberId[]): Who[] {
  const out: Who[] = [];
  for (let mask = 1; mask < 1 << members.length; mask++) out.push(normalizeWho(members.filter((_, k) => mask & (1 << k))));
  return out.sort((a, b) => a.length - b.length || (a.join() < b.join() ? -1 : 1));
}

const favOf = (id: string): FavoriteTitle => {
  const i = FIXTURE_CATALOG.items.find((x) => x.id === id);
  if (!i) throw new Error(`testkit: ${id} is not in the fixture catalog`);
  return { id, kind: i.kind, title: i.title, year: i.year, genres: i.genres, keywords: i.keywords, poster: null };
};

/** A favourite built from any catalog item (as if the person had found it by search). */
export const asFavorite = (i: CatalogItem): FavoriteTitle => ({ id: i.id, kind: i.kind, title: i.title, year: i.year, genres: i.genres, keywords: i.keywords, poster: null });

const TEST_MEMBERS: Record<MemberId, Member> = {
  ...FIXTURE_MEMBERS,
  dee: { id: 'dee', name: 'Dee', joinedAt: 4 },
};

const TEST_FAVORITES: Record<MemberId, FavoriteTitle[]> = {
  ...FIXTURE_FAVORITES,
  // Inception, Black Mirror, Succession.
  dee: ['movie-27205', 'tv-42009', 'tv-76331'].map(favOf),
};

const TEST_DEALBREAKERS: Record<MemberId, Dealbreakers> = {
  alex: NO_DEALBREAKERS,
  sam: { horror: true, trueCrime: true, scary: true, genres: [], subtitled: false },
  kit: NO_DEALBREAKERS,
  dee: { horror: false, trueCrime: false, scary: false, genres: ['reality'], subtitled: true },
};

/**
 * Made-up catalogs can come with made-up favourites for the test people.
 * A catalog registered here gives each person exactly the favourites listed
 * (nobody else has any); an unregistered catalog gets the sample favourites.
 */
const catalogFavorites = new WeakMap<Catalog, Partial<Record<MemberId, FavoriteTitle[]>>>();
export function withFavorites<C extends Catalog>(catalog: C, favorites: Partial<Record<MemberId, (FavoriteTitle | CatalogItem)[]>>): C {
  const out: Partial<Record<MemberId, FavoriteTitle[]>> = {};
  for (const [id, list] of Object.entries(favorites)) out[id] = (list ?? []).map((f) => ('providers' in f ? asFavorite(f) : f));
  catalogFavorites.set(catalog, out);
  return catalog;
}

export interface CtxSetup {
  catalog?: Catalog;
  plans?: PlanSelection;
  /** The household. Default: alex and sam. Any ids work; unknown ones become blank people named after their id. */
  members?: MemberId[];
  /** Replace a person's favourites (default: the sample favourites, or those registered with the catalog). */
  favorites?: Partial<Record<MemberId, FavoriteTitle[]>>;
  /** Replace a person's never-show-me choices. */
  dealbreakers?: Partial<Record<MemberId, Partial<Dealbreakers>>>;
  /** Ids (watched at an unknown time) or id -> YYYY-MM-DD last watched. */
  seen?: Partial<Record<MemberId, string[] | Record<string, string>>>;
  /** Titles on the Matches tab. */
  picks?: { itemId: string; who: Who; at?: number }[];
  never?: Partial<Record<MemberId, string[]>>;
  /** itemId -> date swiped. */
  notTonight?: Partial<Record<MemberId, Record<string, string>>>;
  today?: string;
}

const stamp = (ids: string[] = []): Record<string, number> => Object.fromEntries(ids.map((id) => [id, 1]));
/** Noon UTC on a YYYY-MM-DD date, as a ms timestamp. */
export const dayMs = (date: string): number => Date.parse(`${date}T12:00:00Z`);
const seenMap = (v: string[] | Record<string, string> | undefined): Record<string, SeenEntry> =>
  Array.isArray(v) || !v
    ? Object.fromEntries((v ?? []).map((id) => [id, { at: 1, source: 'manual' as const }]))
    : Object.fromEntries(Object.entries(v).map(([id, date]) => [id, { at: dayMs(date), source: 'manual' as const }]));

export function makePick(itemId: string, who: Who, at = 1): PickEntry {
  return {
    id: `pick-${itemId}-${who.join('+')}`,
    at,
    kind: who.length > 1 ? 'match' : 'solo',
    who: normalizeWho(who),
    itemId,
    snapshot: { title: itemId, year: 2020, poster: null },
    pick: { type: 'series-start' },
    service: { serviceId: 'netflix', planId: 'standard', adFree: true },
  };
}

export function makeCtx(setup: CtxSetup = {}): EngineContext {
  const catalog = setup.catalog ?? FIXTURE_CATALOG;
  const ids = setup.members ?? ['alex', 'sam'];
  const registered = catalogFavorites.get(catalog);
  const members: Record<MemberId, Member> = {};
  const profiles: Record<MemberId, Profile> = {};
  const seen: Record<MemberId, Record<string, SeenEntry>> = {};
  const never: Record<MemberId, Record<string, number>> = {};
  const notTonight: Record<MemberId, Record<string, string>> = {};
  ids.forEach((id, k) => {
    members[id] = TEST_MEMBERS[id] ?? { id, name: id.charAt(0).toUpperCase() + id.slice(1), joinedAt: 10 + k };
    const favorites = setup.favorites?.[id] ?? (registered ? (registered[id] ?? []) : (TEST_FAVORITES[id] ?? []));
    const d = { ...(TEST_DEALBREAKERS[id] ?? NO_DEALBREAKERS), ...(setup.dealbreakers?.[id] ?? {}) };
    profiles[id] = { ...emptyProfile(), id, favorites: [...favorites], dealbreakers: { ...d, genres: [...d.genres] } };
    seen[id] = seenMap(setup.seen?.[id]);
    never[id] = stamp(setup.never?.[id]);
    notTonight[id] = { ...(setup.notTonight?.[id] ?? {}) };
  });
  return {
    catalog,
    today: setup.today ?? TODAY,
    state: {
      members,
      profiles,
      seen,
      never,
      notTonight,
      picks: (setup.picks ?? []).map((p) => makePick(p.itemId, p.who, p.at)),
      settings: { plans: setup.plans ?? { ...PLANS } },
    },
  };
}

/** A blank profile for one of the test people (their sample favourites and choices are NOT applied). */
export function blankProfile(id: MemberId): Profile {
  return { ...emptyProfile(), id };
}

/** The sample profile of one of the test people, as makeCtx() would build it. */
export function sampleProfile(id: MemberId): Profile {
  return makeCtx({ members: [id] }).state.profiles[id];
}

export function req(over: Partial<SuggestRequest> = {}): SuggestRequest {
  return { who: ALEX, viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either', genre: null, ...over };
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
