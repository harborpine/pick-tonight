/**
 * TASTE: how much a person is likely to enjoy a title, before the request
 * (mood, time...) is considered. Two layers:
 *
 *  1. Favourites — how closely the title resembles the things they love.
 *     Computed for the whole catalog once per favourites list and cached.
 *  2. Learned weights and manual corrections from the profile, applied on top.
 */
import type { Catalog, CatalogItem, GenreId, Profile, TasteWeights, TitleCore } from '../contracts';
import { getIndex, nichesOf, type CatalogIndex, type ItemInfo, type NicheId } from './catalogIndex';
import { clamp, SmallCache } from './util';

// ---- tuning knobs for "resembles a favourite" -----------------------------
/** Shared keywords: how quickly overlap saturates (lower = one shared rare keyword counts for more). */
const KW_SCALE = 1.0;
const W_KW = 0.44;
const W_GENRE = 0.18;
const W_RELATED = 0.3;
const W_FORMAT = 0.08;
/** Resemblance below this is noise ("it's also a drama") and is ignored. */
const SIM_FLOOR = 0.14;
/** The best match counts fully, then each further favourite it resembles adds less. */
const MULTI_WEIGHTS = [1, 0.6, 0.4, 0.25];
const MULTI_NORM = 1.55;
/** A person's own favourite is, by definition, to their taste. */
export const OWN_FAVOURITE_TASTE = 0.92;

/**
 * SUPPORT: one favourite should not speak for the whole person. A feature
 * (keyword or genre) shared with a favourite counts in full only when several
 * favourites have it; a feature only ONE favourite has counts for less.
 * (BG's single animated favourite among twenty-two must not fill her decks
 * with adult animation, while HG's four animated favourites rightly do.)
 * Only applied once there are enough favourites for "only one" to mean something.
 */
const SUPPORT_MIN_FAVS = 6;
/** Keyword shared with 1 / 2 / 3+ favourites. */
const KW_SUPPORT = [0.65, 0.85, 1];
/** Genre shared with 1 / 2 / 3+ favourites. */
const GENRE_SUPPORT = [0.5, 0.75, 1];
/**
 * Genres that define a whole FORMAT rather than a theme. A title in a format
 * that none / one / two of the favourites are in has its whole resemblance
 * scaled by FORMAT_SUPPORT[0 / 1 / 2] (three or more: no change).
 */
const FORMAT_GENRES: GenreId[] = ['animation', 'reality', 'documentary', 'talk', 'kids'];
const FORMAT_SUPPORT = [0.5, 0.6, 0.85];

/**
 * A favourite is only NAMED as a reason ("Because you love X") when the title
 * visibly has something in common with it — shared themes and/or genres. A
 * bare "people also watched" link from the catalog is too noisy to say out loud.
 */
const NAME_MIN_EVIDENCE = 0.7;
const NAME_KEYWORDS_ALONE = 0.6;

export interface FavMatch {
  /** Title of the favourite it resembles. */
  title: string;
  favId: string;
  sim: number;
}

interface Support {
  on: boolean;
  kwCount: Map<string, number>;
  genreCount: Map<GenreId, number>;
}
const step = (table: number[], count: number) => table[Math.min(table.length, Math.max(1, count)) - 1];

interface FavInfo {
  core: TitleCore;
  kw: Map<string, number>;
  kwWeightSum: number;
  genres: Set<GenreId>;
  genreWeightSum: number;
  related: Set<string>;
  /** Present when the favourite is itself in the catalog. */
  item: CatalogItem | null;
}

export interface FavModel {
  favIds: Set<string>;
  /** Favourites we could resolve to a known title. */
  favs: TitleCore[];
  /** 0..1 resemblance to the favourites, per catalog item (by ItemInfo.idx). */
  score: Float32Array;
  /**
   * The favourites each item resembles closely enough, and visibly enough, to
   * be named in a reason (best first, itself excluded).
   */
  matches: FavMatch[][];
  /** Share of favourites carrying each genre / keyword / trait. */
  genreShare: Map<GenreId, number>;
  kwCount: Map<string, number>;
  traitShare: Map<string, number>;
  /** How much more (+) or less (-) common each trait is among the favourites than in the catalog. */
  traitLift: Map<string, number>;
  /** Acquired tastes (anime, kids' shows) that at least one favourite belongs to. */
  niches: Set<NicheId>;
}

const models = new WeakMap<Catalog, SmallCache<FavModel>>();

export function getFavModel(catalog: Catalog, favorites: readonly string[] | undefined): FavModel {
  let cache = models.get(catalog);
  if (!cache) {
    cache = new SmallCache<FavModel>(8);
    models.set(catalog, cache);
  }
  const favs = favorites ?? [];
  return cache.get(favs.join(','), () => buildFavModel(getIndex(catalog), favs));
}

function favInfo(core: TitleCore, index: CatalogIndex): FavInfo {
  const kw = new Map<string, number>();
  for (const k of core.keywords ?? []) kw.set(k, index.kwWeight(k));
  let kwWeightSum = 0;
  for (const w of kw.values()) kwWeightSum += w;
  const genres = new Set(core.genres ?? []);
  let genreWeightSum = 0;
  for (const g of genres) genreWeightSum += index.genreWeight(g);
  return { core, kw, kwWeightSum, genres, genreWeightSum, related: new Set(core.related ?? []), item: index.byId.get(core.id)?.item ?? null };
}

function buildFavModel(index: CatalogIndex, favorites: readonly string[]): FavModel {
  const favIds = new Set(favorites);
  const favInfos: FavInfo[] = [];
  for (const id of favIds) {
    const core = index.refs.get(id);
    if (!core) continue; // a favourite we know nothing about can't teach us anything
    favInfos.push(favInfo(core, index));
  }

  const support = supportOf(favInfos);
  const n = index.infos.length;
  const score = new Float32Array(n);
  const matches: FavMatch[][] = new Array(n);
  const sims: { f: FavInfo; s: number; named: boolean }[] = [];

  for (const info of index.infos) {
    sims.length = 0;
    for (const f of favInfos) {
      if (f.core.id === info.item.id) continue;
      const p = similarityParts(info, f, index, support, false);
      if (p.sim > SIM_FLOOR) sims.push({ f, s: p.sim, named: p.named });
    }
    sims.sort((a, b) => b.s - a.s || (a.f.core.id < b.f.core.id ? -1 : 1));
    let total = 0;
    for (let k = 0; k < sims.length && k < MULTI_WEIGHTS.length; k++) {
      total += MULTI_WEIGHTS[k] * ((sims[k].s - SIM_FLOOR) / (1 - SIM_FLOOR));
    }
    score[info.idx] = clamp((total / MULTI_NORM) * formatSupport(info, support));
    matches[info.idx] = sims
      .filter((x) => x.named)
      .slice(0, 3)
      .map((x) => ({ title: x.f.core.title, favId: x.f.core.id, sim: x.s }));
  }

  // What the favourites have in common (for the "what it has learned" page and learning).
  const genreShare = new Map<GenreId, number>();
  const kwCount = new Map<string, number>();
  const traitCount = new Map<string, number>();
  let withTraits = 0;
  for (const f of favInfos) {
    for (const g of f.genres) genreShare.set(g, (genreShare.get(g) ?? 0) + 1);
    for (const k of f.kw.keys()) kwCount.set(k, (kwCount.get(k) ?? 0) + 1);
    const info = index.byId.get(f.core.id);
    if (info) {
      withTraits++;
      for (const t of info.traits) traitCount.set(t, (traitCount.get(t) ?? 0) + 1);
    }
  }
  for (const [g, c] of genreShare) genreShare.set(g, c / favInfos.length);
  const traitShare = new Map<string, number>();
  // Only trust trait shares when enough favourites are in the catalog to judge.
  if (withTraits >= 3) for (const [t, c] of traitCount) traitShare.set(t, c / withTraits);

  const niches = new Set<NicheId>();
  for (const f of favInfos) for (const x of nichesOf(f.item ?? f.core)) niches.add(x);

  const traitLift = new Map<string, number>();
  if (withTraits >= 3) {
    for (const [t, share] of index.traitShare) traitLift.set(t, (traitShare.get(t) ?? 0) - share);
  }

  return { favIds, favs: favInfos.map((f) => f.core), score, matches, genreShare, kwCount, traitShare, traitLift, niches };
}

function supportOf(favInfos: FavInfo[]): Support {
  const kwCount = new Map<string, number>();
  const genreCount = new Map<GenreId, number>();
  for (const f of favInfos) {
    for (const k of f.kw.keys()) kwCount.set(k, (kwCount.get(k) ?? 0) + 1);
    for (const g of f.genres) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
  }
  return { on: favInfos.length >= SUPPORT_MIN_FAVS, kwCount, genreCount };
}

/** 0.5..1: scales a title's whole resemblance when its format is one the favourites barely touch. */
function formatSupport(info: ItemInfo, support: Support): number {
  if (!support.on) return 1;
  let factor = 1;
  for (const g of FORMAT_GENRES) {
    if (!info.item.genres.includes(g)) continue;
    const count = support.genreCount.get(g) ?? 0;
    if (count < FORMAT_SUPPORT.length) factor = Math.min(factor, FORMAT_SUPPORT[count]);
  }
  return factor;
}

interface SimilarityParts {
  sim: number;
  kw: number;
  genre: number;
  rel: number;
  format: number;
  /** Enough visibly in common to name this favourite as a reason. */
  named: boolean;
  sharedKw: string[];
}

/**
 * How much one title resembles one favourite, 0..1.
 *  - shared keywords, rarer ones counting for more (the heart of it);
 *  - shared genres, rarer ones counting for more;
 *  - "people who like one like the other" links (strong signal, either direction,
 *    plus having recommended titles in common);
 *  - same kind of thing (movie vs series, drop-in vs serialized, similar length).
 */
function similarityParts(info: ItemInfo, f: FavInfo, index: CatalogIndex, support: Support, listKeywords: boolean): SimilarityParts {
  const item = info.item;

  // Keywords: `shared` is support-weighted (used for the score); `sharedPlain` is not (used for naming).
  let shared = 0;
  let sharedPlain = 0;
  const sharedKw: string[] = [];
  for (const k of info.kw) {
    const w = f.kw.get(k);
    if (w !== undefined) {
      sharedPlain += w;
      shared += support.on ? w * step(KW_SUPPORT, support.kwCount.get(k) ?? 1) : w;
      if (listKeywords) sharedKw.push(k);
    }
  }
  const kwOf = (x: number) => (x > 0 ? 0.7 * (1 - Math.exp(-x / KW_SCALE)) + 0.3 * ((2 * x) / (info.kwWeightSum + f.kwWeightSum)) : 0);
  const kw = kwOf(shared);
  const kwPlain = support.on ? kwOf(sharedPlain) : kw;

  let sharedG = 0;
  let sharedGPlain = 0;
  // Sharing only a catch-all genre ("it's also a drama") says much less than sharing a rare one.
  let rarest = 0;
  for (const g of item.genres) {
    if (!f.genres.has(g)) continue;
    const w = index.genreWeight(g);
    sharedGPlain += w;
    sharedG += support.on ? w * step(GENRE_SUPPORT, support.genreCount.get(g) ?? 1) : w;
    if (w > rarest) rarest = w;
  }
  const unionG = info.genreWeightSum + f.genreWeightSum - sharedGPlain;
  const genreOf = (x: number) => (unionG > 0 ? (x / unionG) * (0.4 + 0.6 * rarest) : 0);
  const genre = genreOf(sharedG);
  const genrePlain = genreOf(sharedGPlain);

  let rel = 0;
  const itemRelated = item.related ?? [];
  if (f.related.has(item.id)) rel += 0.75;
  let common = 0;
  for (const r of itemRelated) {
    if (r === f.core.id) rel += 0.5;
    else if (f.related.has(r)) common++;
  }
  if (common > 0) rel += 0.5 * (common / Math.max(1, Math.min(itemRelated.length, f.related.size)));
  rel = Math.min(1, rel);

  let format = 0;
  if (item.kind === f.core.kind) {
    format = 0.5;
    if (f.item && item.kind === 'tv') {
      if (f.item.dropIn === item.dropIn) format += 0.25;
      if (Math.abs(f.item.runtime - item.runtime) <= 12) format += 0.25;
    } else if (item.kind === 'movie') {
      format = 0.8;
    }
  }

  const named = kwPlain + genrePlain >= NAME_MIN_EVIDENCE && (genrePlain > 0 || kwPlain >= NAME_KEYWORDS_ALONE);
  return { sim: clamp(W_KW * kw + W_GENRE * genre + W_RELATED * rel + W_FORMAT * format), kw, genre, rel, format, named, sharedKw };
}

/** Development aid (used by dev/review.ts): why a title does or doesn't resemble each favourite. */
export function explainTaste(catalog: Catalog, favorites: readonly string[], itemId: string): string[] {
  const index = getIndex(catalog);
  const info = index.byId.get(itemId);
  if (!info) return [`${itemId} is not in the catalog`];
  const lines: { s: number; text: string }[] = [];
  const favInfos = [...new Set(favorites)].flatMap((id) => {
    const core = index.refs.get(id);
    return core ? [favInfo(core, index)] : [];
  });
  const support = supportOf(favInfos);
  for (const f of favInfos) {
    if (f.core.id === itemId) continue;
    const p = similarityParts(info, f, index, support, true);
    lines.push({ s: p.sim, text: `${p.sim.toFixed(2)} ${f.core.title}${p.named ? '' : ' (not named)'}: keywords ${p.kw.toFixed(2)} [${p.sharedKw.join(', ')}], genres ${p.genre.toFixed(2)}, related ${p.rel.toFixed(2)}, format ${p.format.toFixed(2)}` });
  }
  lines.sort((a, b) => b.s - a.s);
  return [`format support x${formatSupport(info, support).toFixed(2)}`, ...lines.map((l) => l.text)];
}

// ---------------------------------------------------------------------------
// Learned weights and manual corrections
// ---------------------------------------------------------------------------

export interface LearnedView {
  empty: boolean;
  genre(g: GenreId): number;
  keyword(k: string): number;
  trait(t: string): number;
  /** Corrections by kind, so scoring can apply their direct boost. */
  corrected: { genres: Map<string, number>; keywords: Map<string, number>; traits: Map<string, number> };
  hasCorrections: boolean;
}

/**
 * Reads a profile's learned weights with manual corrections laid over them:
 * a corrected key behaves as fully liked (+1) or fully disliked (-1) no matter
 * what the swipes have taught.
 */
export function learnedView(taste: TasteWeights | undefined): LearnedView {
  const genres = taste?.genres ?? {};
  const keywords = taste?.keywords ?? {};
  const traits = taste?.traits ?? {};
  const corrected = { genres: new Map<string, number>(), keywords: new Map<string, number>(), traits: new Map<string, number>() };
  for (const [key, dir] of Object.entries(taste?.corrections ?? {})) {
    const v = dir === 'more' ? 1 : dir === 'less' ? -1 : 0;
    if (!v) continue;
    const at = key.indexOf(':');
    const kind = key.slice(0, at);
    const name = key.slice(at + 1);
    if (kind === 'genre') corrected.genres.set(name, v);
    else if (kind === 'keyword') corrected.keywords.set(name, v);
    else if (kind === 'trait') corrected.traits.set(name, v);
  }
  const hasCorrections = corrected.genres.size + corrected.keywords.size + corrected.traits.size > 0;
  const hasLearned = Object.keys(genres).length + Object.keys(keywords).length + Object.keys(traits).length > 0;
  return {
    empty: !hasCorrections && !hasLearned,
    genre: (g) => corrected.genres.get(g) ?? (genres as Record<string, number>)[g] ?? 0,
    keyword: (k) => corrected.keywords.get(k) ?? (Object.prototype.hasOwnProperty.call(keywords, k) ? keywords[k] : 0),
    trait: (t) => corrected.traits.get(t) ?? (Object.prototype.hasOwnProperty.call(traits, t) ? traits[t] : 0),
    corrected,
    hasCorrections,
  };
}

/**
 * -1..1: what the swipes (and corrections) say about this title.
 * Genres are averaged (weighted by rarity), keywords add up and saturate,
 * traits are averaged.
 */
export function learnedScore(info: ItemInfo, view: LearnedView, index: CatalogIndex): number {
  if (view.empty) return 0;
  let g = 0;
  if (info.genreWeightSum > 0) {
    for (const x of info.item.genres) g += view.genre(x) * index.genreWeight(x);
    g /= info.genreWeightSum;
  }
  let k = 0;
  for (const x of info.kw) {
    const w = view.keyword(x);
    if (w) k += w * (0.4 + 0.6 * index.kwWeight(x));
  }
  k = Math.tanh(k / 1.1);
  let t = 0;
  for (const x of info.traits) t += view.trait(x);
  t /= Math.max(1, info.traits.length) * 0.6;
  return clamp(0.45 * g + 0.35 * k + 0.2 * clamp(t, -1, 1), -1, 1);
}

/**
 * The direct effect of manual corrections on a title: each "more" it matches
 * lifts it, each "less" sinks it, by enough to visibly reorder a deck.
 */
export function correctionDelta(info: ItemInfo, view: LearnedView): number {
  if (!view.hasCorrections) return 0;
  let d = 0;
  for (const g of info.item.genres) d += view.corrected.genres.get(g) ?? 0;
  if (info.niches.includes('kids') && !info.item.genres.includes('kids')) d += view.corrected.genres.get('kids') ?? 0;
  if (view.corrected.keywords.size) for (const k of info.kw) d += view.corrected.keywords.get(k) ?? 0;
  if (view.corrected.traits.size) for (const t of info.traits) d += view.corrected.traits.get(t) ?? 0;
  return clamp(d, -2, 2);
}

/**
 * -1..1: does this title have the general shape of what the person loves?
 * (Drop-in half-hours vs hour-long serials, films vs series, grown-up vs
 * teen vs family rating, old vs new.) Positive when its traits are more common
 * among their favourites than in the catalog at large. This is what separates
 * two titles that both share nothing specific with any favourite.
 */
export function traitFit(info: ItemInfo, fav: FavModel): number {
  if (!fav.traitLift.size || !info.traits.length) return 0;
  let sum = 0;
  let n = 0;
  for (const t of info.traits) {
    // Film-vs-series is left out: a favourites list that happens to be mostly
    // series is no evidence of disliking films (swipes can still teach that).
    if (t === 'kind:movie' || t === 'kind:tv') continue;
    sum += fav.traitLift.get(t) ?? 0;
    n++;
  }
  return n ? clamp((sum / n) * 2.2, -1, 1) : 0;
}

/** How much an acquired taste the person hasn't shown costs a title. */
const NICHE_PENALTY = 0.24;
/** A learned weight this strong fully lifts the penalty (it fades in proportion below that). */
const NICHE_LEARNED_ENOUGH = 0.15;

/**
 * 0 or negative: anime and kids' shows are marked down for someone whose
 * favourites don't include any, until their swipes (or a "more" correction)
 * show interest. A "less" correction is handled by correctionDelta instead.
 */
export function nichePenalty(info: ItemInfo, fav: FavModel, view: LearnedView): number {
  if (!info.niches.length) return 0;
  let p = 0;
  for (const n of info.niches) {
    if (fav.niches.has(n)) continue;
    const learned = n === 'anime' ? view.keyword('anime') : view.genre('kids');
    if (learned < 0) p -= NICHE_PENALTY;
    else p -= NICHE_PENALTY * (1 - clamp(learned / NICHE_LEARNED_ENOUGH));
  }
  return p;
}

export function emptyTaste(): TasteWeights {
  return { genres: {}, keywords: {}, traits: {}, corrections: {} };
}

export function profileTaste(profile: Profile | undefined): TasteWeights {
  return profile?.taste ?? emptyTaste();
}
