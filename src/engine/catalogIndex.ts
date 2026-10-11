/**
 * Per-catalog lookups, computed once per catalog object and cached (WeakMap),
 * so a deck request never re-scans the ~3,000 titles for things that don't
 * depend on the request: keyword rarity, quality scores, popularity ranks,
 * and each title's "traits".
 */
import type { Catalog, CatalogItem, GenreId, TitleCore } from '../contracts';
import { clamp } from './util';

export interface ItemInfo {
  item: CatalogItem;
  /** Position in catalog.items (index into the per-person score arrays). */
  idx: number;
  /** De-duplicated keywords. */
  kw: string[];
  /** Sum of rarity weights of this title's keywords. */
  kwWeightSum: number;
  /** Sum of rarity weights of this title's genres. */
  genreWeightSum: number;
  /** Rating adjusted for how many people voted (Bayesian average), 0-10. */
  bayes: number;
  /** The same, squashed to 0..1. */
  quality: number;
  /**
   * Familiarity 0 (obscure) .. 1 (everyone's heard of it): mostly how many
   * people have rated it compared with other titles of its kind, plus how
   * popular it is right now.
   */
  pop: number;
  /** Acquired tastes this title belongs to (see NICHES), usually empty. */
  niches: NicheId[];
  /** Engine-defined traits, e.g. 'dropIn', 'kind:movie', 'short'. */
  traits: string[];
}

export interface CatalogIndex {
  catalog: Catalog;
  infos: ItemInfo[];
  byId: Map<string, ItemInfo>;
  /** Every title we know anything about: catalog items plus taste references. */
  refs: Map<string, TitleCore>;
  /** Keyword rarity 0..1 (1 = very rare, so sharing it means a lot). */
  kwWeight(k: string): number;
  /** Genre rarity 0.2..1 ("drama" says little, "western" says a lot). */
  genreWeight(g: GenreId): number;
  /** Share of catalog titles carrying each genre. */
  genreShare: Map<GenreId, number>;
  builtYear: number;
}

/** Votes a title needs before its own rating outweighs the catalog average. */
const VOTE_PRIOR = 250;

/**
 * Traits are the non-genre, non-keyword things people have tastes about:
 * format, length, effort, age. Used by learning and by the "what it has
 * learned" page. Keep in sync with TRAIT_PHRASES in insights.ts.
 */
export function traitsOf(item: CatalogItem, builtYear: number): string[] {
  const t: string[] = [item.kind === 'movie' ? 'kind:movie' : 'kind:tv'];
  if (item.kind === 'tv') {
    t.push(item.dropIn ? 'dropIn' : 'serialized');
    if (item.runtime <= 32) t.push('short');
    else if (item.runtime >= 40) t.push('hourlong');
  }
  if (item.attention === 'low') t.push('attention:low');
  else if (item.attention === 'high') t.push('attention:high');
  if (item.year > 0 && item.year < 2000) t.push('classic');
  else if (item.year >= builtYear - 2) t.push('recent');
  return t;
}

/**
 * ACQUIRED TASTES. Some kinds of title are loved by their fans and a hard no
 * for most other people, however well rated. They are only suggested freely
 * to someone whose favourites, swipes or corrections show the taste.
 * Each has a correction key so the taste page can switch it on or off.
 */
export type NicheId = 'anime' | 'kids';
export const NICHES: Record<NicheId, { key: string; label: string }> = {
  anime: { key: 'keyword:anime', label: 'anime' },
  kids: { key: 'genre:kids', label: "kids' shows" },
};
const ANIME_KEYWORDS = new Set(['anime', 'based on manga', 'shounen', 'shonen', 'seinen', 'shoujo', 'shojo', 'josei', 'isekai', 'based on light novel', 'mecha', 'japanese animation']);
const KIDS_CERTS = new Set(['TV-Y', 'TV-Y7', 'TV-Y7-FV']);

/** Works for catalog items and for bare taste references (which have no certification). */
export function nichesOf(t: TitleCore & { certification?: string }): NicheId[] {
  const out: NicheId[] = [];
  if ((t.keywords ?? []).some((k) => ANIME_KEYWORDS.has(k))) out.push('anime');
  const genres = t.genres ?? [];
  if (
    t.kind === 'tv' &&
    (genres.includes('kids') || KIDS_CERTS.has(t.certification ?? '') || (t.certification === 'TV-G' && genres.includes('family')))
  ) {
    out.push('kids');
  }
  return out;
}

const cache = new WeakMap<Catalog, CatalogIndex>();

export function getIndex(catalog: Catalog): CatalogIndex {
  let idx = cache.get(catalog);
  if (!idx) {
    idx = build(catalog);
    cache.set(catalog, idx);
  }
  return idx;
}

function build(catalog: Catalog): CatalogIndex {
  const builtYear = Number.parseInt((catalog.builtAt ?? '').slice(0, 4), 10) || 2026;
  const refs = new Map<string, TitleCore>();
  for (const r of catalog.tasteRefs ?? []) refs.set(r.id, r);
  for (const i of catalog.items) refs.set(i.id, i); // the full item wins when both exist

  // How many titles carry each keyword / genre.
  const kwDf = new Map<string, number>();
  const genreDf = new Map<GenreId, number>();
  for (const r of refs.values()) {
    for (const k of new Set(r.keywords ?? [])) kwDf.set(k, (kwDf.get(k) ?? 0) + 1);
    for (const g of new Set(r.genres ?? [])) genreDf.set(g, (genreDf.get(g) ?? 0) + 1);
  }
  const n = Math.max(1, refs.size);
  const logN = Math.log(1 + n);
  const kwW = new Map<string, number>();
  for (const [k, df] of kwDf) kwW.set(k, Math.log(1 + n / df) / logN);
  const genreW = new Map<GenreId, number>();
  const genreShare = new Map<GenreId, number>();
  for (const [g, df] of genreDf) {
    genreW.set(g, clamp(-Math.log2(df / n) / 5, 0.2, 1));
    genreShare.set(g, df / n);
  }
  const kwWeight = (k: string) => kwW.get(k) ?? 1;
  const genreWeight = (g: GenreId) => genreW.get(g) ?? 0.6;

  // Quality: rating pulled toward the catalog average until enough people have voted.
  let ratingSum = 0;
  let rated = 0;
  for (const i of catalog.items) {
    if (i.votes > 0 && i.rating > 0) {
      ratingSum += i.rating;
      rated++;
    }
  }
  const meanRating = rated ? ratingSum / rated : 7;

  // Popularity as a rank, so one runaway hit doesn't flatten everything else.
  const byPop = catalog.items.map((i, k) => ({ k, p: i.popularity ?? 0, id: i.id }));
  byPop.sort((a, b) => a.p - b.p || (a.id < b.id ? -1 : 1));
  const popRank = new Float32Array(catalog.items.length);
  byPop.forEach((e, rank) => {
    popRank[e.k] = byPop.length > 1 ? rank / (byPop.length - 1) : 0.5;
  });
  // Vote counts ranked within movies and within series separately (films collect far more votes).
  const voteRank = new Float32Array(catalog.items.length);
  for (const kind of ['movie', 'tv'] as const) {
    const group = catalog.items.map((i, k) => ({ k, v: i.votes ?? 0, id: i.id, kind: i.kind })).filter((e) => e.kind === kind);
    group.sort((a, b) => a.v - b.v || (a.id < b.id ? -1 : 1));
    group.forEach((e, rank) => {
      voteRank[e.k] = group.length > 1 ? rank / (group.length - 1) : 0.5;
    });
  }

  const infos: ItemInfo[] = catalog.items.map((item, k) => {
    const niches = nichesOf(item);
    const kw = [...new Set(item.keywords ?? [])];
    // So a correction or learned weight on 'anime' reaches every anime, however it was tagged.
    if (niches.includes('anime') && !kw.includes('anime')) kw.push('anime');
    const votes = Math.max(0, item.votes ?? 0);
    const rating = item.rating > 0 ? item.rating : meanRating;
    const bayes = (votes * rating + VOTE_PRIOR * meanRating) / (votes + VOTE_PRIOR);
    return {
      item,
      idx: k,
      kw,
      kwWeightSum: kw.reduce((s, x) => s + kwWeight(x), 0),
      genreWeightSum: item.genres.reduce((s, g) => s + genreWeight(g), 0),
      bayes,
      quality: clamp((bayes - 5.8) / 2.8),
      pop: 0.6 * voteRank[k] + 0.4 * popRank[k],
      niches,
      traits: traitsOf(item, builtYear),
    };
  });
  const byId = new Map(infos.map((i) => [i.item.id, i]));
  return { catalog, infos, byId, refs, kwWeight, genreWeight, genreShare, builtYear };
}
