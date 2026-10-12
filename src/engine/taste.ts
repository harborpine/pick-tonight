/**
 * TASTE: how much a person is likely to enjoy a title, before the request
 * (mood, time...) is considered. Two layers:
 *
 *  1. Favourites — how closely the title resembles the things they love.
 *     Computed for the whole catalog once per favourites list and cached.
 *  2. Learned weights and manual corrections from the profile, applied on top.
 */
import type { Catalog, CatalogItem, FavoriteTitle, GenreId, Profile, TasteWeights, TitleKind } from '../contracts';
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
/** Someone with a single favourite can only ever resemble one: don't mark them down for having no second match. */
const MULTI_NORM_SINGLE = 1;
/** A person's own favourite is, by definition, to their taste. */
export const OWN_FAVOURITE_TASTE = 0.92;

/**
 * SUPPORT: one favourite should not speak for the whole person. A feature
 * (keyword or genre) shared with a favourite counts in full only when several
 * favourites have it; a feature only ONE favourite has counts for less.
 * (A single animated favourite among twenty-two must not fill that person's
 * decks with adult animation, while four animated favourites rightly do.)
 *
 * That only makes sense for a long list. Someone who has picked three
 * favourites chose each one deliberately and every one of them DOES speak for
 * them, so the mark-down fades in with the length of the list: none at
 * SUPPORT_FROM favourites or fewer, in full from SUPPORT_FULL.
 */
const SUPPORT_FROM = 3;
const SUPPORT_FULL = 8;
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
/** In-catalog favourites needed before the "general shape" of what someone loves counts in full. */
const SHAPE_FULL_FAVS = 8;
const NAME_KEYWORDS_ALONE = 0.6;

export interface FavMatch {
  /** Title of the favourite it resembles. */
  title: string;
  favId: string;
  sim: number;
}

interface Support {
  /** 0 (a short list: every favourite counts in full) .. 1 (a long one: full mark-down for lone features). */
  strength: number;
  kwCount: Map<string, number>;
  genreCount: Map<GenreId, number>;
}
const step = (table: number[], count: number) => table[Math.min(table.length, Math.max(1, count)) - 1];
/** A mark-down factor (0..1) applied only as far as the list is long enough for it to mean something. */
const damp = (factor: number, support: Support) => 1 - support.strength * (1 - factor);

/** What we know about one favourite: the catalog's data when the title is in the catalog, else what the favourite carries. */
export interface FavCore {
  id: string;
  kind: TitleKind;
  title: string;
  genres: GenreId[];
  keywords: string[];
  related: string[];
}

interface FavInfo {
  core: FavCore;
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
  /** The favourites, one entry per title. */
  favs: FavCore[];
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

/**
 * Cached per catalog OBJECT (a WeakMap, so a replaced catalog takes its models
 * with it) and per favourites list. The key spells out the data of favourites
 * that are not in the catalog, since that data is all we know about them.
 */
export function getFavModel(catalog: Catalog, favorites: readonly FavoriteTitle[] | undefined): FavModel {
  let cache = models.get(catalog);
  if (!cache) {
    cache = new SmallCache<FavModel>(12);
    models.set(catalog, cache);
  }
  const index = getIndex(catalog);
  const favs = (favorites ?? []).filter((f): f is FavoriteTitle => !!f && typeof f.id === 'string');
  let key = '';
  for (const f of favs) {
    key += index.byId.has(f.id) ? `${f.id},` : `${f.id}~${f.kind}~${f.title}~${(f.genres ?? []).join('+')}~${(f.keywords ?? []).join('+')},`;
  }
  return cache.get(key, () => buildFavModel(index, favs));
}

/** The catalog knows a title better than a search result does (more keywords, "people also like" links). */
function favCore(f: FavoriteTitle, index: CatalogIndex): FavCore {
  const item = index.byId.get(f.id)?.item;
  if (item) return { id: item.id, kind: item.kind, title: item.title, genres: item.genres ?? [], keywords: item.keywords ?? [], related: item.related ?? [] };
  return {
    id: f.id,
    kind: f.kind === 'movie' ? 'movie' : 'tv',
    title: typeof f.title === 'string' && f.title ? f.title : 'a favourite',
    genres: Array.isArray(f.genres) ? f.genres : [],
    keywords: Array.isArray(f.keywords) ? f.keywords.filter((k) => typeof k === 'string') : [],
    related: [],
  };
}

function favInfos(index: CatalogIndex, favorites: readonly FavoriteTitle[]): FavInfo[] {
  const out: FavInfo[] = [];
  const done = new Set<string>();
  for (const f of favorites) {
    if (!f || typeof f.id !== 'string' || done.has(f.id)) continue;
    done.add(f.id);
    out.push(favInfo(favCore(f, index), index));
  }
  return out;
}

function favInfo(core: FavCore, index: CatalogIndex): FavInfo {
  const kw = new Map<string, number>();
  for (const k of core.keywords ?? []) kw.set(k, index.kwWeight(k));
  let kwWeightSum = 0;
  for (const w of kw.values()) kwWeightSum += w;
  const genres = new Set(core.genres ?? []);
  let genreWeightSum = 0;
  for (const g of genres) genreWeightSum += index.genreWeight(g);
  return { core, kw, kwWeightSum, genres, genreWeightSum, related: new Set(core.related ?? []), item: index.byId.get(core.id)?.item ?? null };
}

function buildFavModel(index: CatalogIndex, favorites: readonly FavoriteTitle[]): FavModel {
  const infos = favInfos(index, favorites);
  const favIds = new Set(infos.map((f) => f.core.id));
  const norm = infos.length === 1 ? MULTI_NORM_SINGLE : MULTI_NORM;

  const support = supportOf(infos);
  const n = index.infos.length;
  const score = new Float32Array(n);
  const matches: FavMatch[][] = new Array(n);
  const sims: { f: FavInfo; s: number; named: boolean }[] = [];

  for (const info of index.infos) {
    sims.length = 0;
    for (const f of infos) {
      if (f.core.id === info.item.id) continue;
      const p = similarityParts(info, f, index, support, false);
      if (p.sim > SIM_FLOOR) sims.push({ f, s: p.sim, named: p.named });
    }
    sims.sort((a, b) => b.s - a.s || (a.f.core.id < b.f.core.id ? -1 : 1));
    let total = 0;
    for (let k = 0; k < sims.length && k < MULTI_WEIGHTS.length; k++) {
      total += MULTI_WEIGHTS[k] * ((sims[k].s - SIM_FLOOR) / (1 - SIM_FLOOR));
    }
    score[info.idx] = clamp((total / norm) * formatSupport(info, support));
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
  for (const f of infos) {
    for (const g of f.genres) genreShare.set(g, (genreShare.get(g) ?? 0) + 1);
    for (const k of f.kw.keys()) kwCount.set(k, (kwCount.get(k) ?? 0) + 1);
    const info = index.byId.get(f.core.id);
    if (info) {
      withTraits++;
      for (const t of info.traits) traitCount.set(t, (traitCount.get(t) ?? 0) + 1);
    }
  }
  for (const [g, c] of genreShare) genreShare.set(g, c / infos.length);
  const traitShare = new Map<string, number>();
  // Only trust trait shares when enough favourites are in the catalog to judge.
  if (withTraits >= 3) for (const [t, c] of traitCount) traitShare.set(t, c / withTraits);

  const niches = new Set<NicheId>();
  for (const f of infos) for (const x of nichesOf(f.item ?? f.core)) niches.add(x);

  // The general shape of what they love. Three favourites all being hour-long says
  // far less than twelve being so: the lift counts in proportion until there are
  // SHAPE_FULL_FAVS of them to judge by.
  const traitLift = new Map<string, number>();
  if (withTraits >= 3) {
    const sure = clamp(withTraits / SHAPE_FULL_FAVS);
    for (const [t, share] of index.traitShare) traitLift.set(t, ((traitShare.get(t) ?? 0) - share) * sure);
  }

  return { favIds, favs: infos.map((f) => f.core), score, matches, genreShare, kwCount, traitShare, traitLift, niches };
}

function supportOf(favInfos: FavInfo[]): Support {
  const kwCount = new Map<string, number>();
  const genreCount = new Map<GenreId, number>();
  for (const f of favInfos) {
    for (const k of f.kw.keys()) kwCount.set(k, (kwCount.get(k) ?? 0) + 1);
    for (const g of f.genres) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
  }
  return { strength: clamp((favInfos.length - SUPPORT_FROM) / (SUPPORT_FULL - SUPPORT_FROM)), kwCount, genreCount };
}

/** 0.5..1: scales a title's whole resemblance when its format is one the favourites barely touch. */
function formatSupport(info: ItemInfo, support: Support): number {
  if (support.strength <= 0) return 1;
  let factor = 1;
  for (const g of FORMAT_GENRES) {
    if (!info.item.genres.includes(g)) continue;
    const count = support.genreCount.get(g) ?? 0;
    if (count < FORMAT_SUPPORT.length) factor = Math.min(factor, FORMAT_SUPPORT[count]);
  }
  return damp(factor, support);
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
      shared += w * damp(step(KW_SUPPORT, support.kwCount.get(k) ?? 1), support);
      if (listKeywords) sharedKw.push(k);
    }
  }
  const kwOf = (x: number) => (x > 0 ? 0.7 * (1 - Math.exp(-x / KW_SCALE)) + 0.3 * ((2 * x) / (info.kwWeightSum + f.kwWeightSum)) : 0);
  const kw = kwOf(shared);
  const kwPlain = support.strength > 0 ? kwOf(sharedPlain) : kw;

  let sharedG = 0;
  let sharedGPlain = 0;
  // Sharing only a catch-all genre ("it's also a drama") says much less than sharing a rare one.
  let rarest = 0;
  for (const g of item.genres) {
    if (!f.genres.has(g)) continue;
    const w = index.genreWeight(g);
    sharedGPlain += w;
    sharedG += w * damp(step(GENRE_SUPPORT, support.genreCount.get(g) ?? 1), support);
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
export function explainTaste(catalog: Catalog, favorites: readonly FavoriteTitle[], itemId: string): string[] {
  const index = getIndex(catalog);
  const info = index.byId.get(itemId);
  if (!info) return [`${itemId} is not in the catalog`];
  const lines: { s: number; text: string }[] = [];
  const infos = favInfos(index, favorites);
  const support = supportOf(infos);
  for (const f of infos) {
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

/**
 * WHERE LEARNED WEIGHTS LIVE. Swipes write to taste.genres / taste.keywords /
 * taste.traits. A watch-history import writes to its own namespace, stored
 * inside taste.traits under these prefixes ('imp:g:comedy', 'imp:k:sitcom',
 * 'imp:t:dropIn'), so the two kinds of evidence never overwrite each other and
 * an import can be re-run without piling up (see history/learnImport.ts).
 * Scoring reads the two added together.
 */
export const IMPORT_GENRE = 'imp:g:';
export const IMPORT_KEYWORD = 'imp:k:';
export const IMPORT_TRAIT = 'imp:t:';
export const isImportKey = (key: string): boolean => key.startsWith('imp:');

/**
 * Learned weight (genres in full, themes and habits at half) that counts as
 * knowing the person well. For scale: one "yes" adds about 0.5, so it takes
 * eight or so consistent swipes; a real imported history gets there at once.
 */
const EVIDENCE_FULL = 4;

export interface LearnedView {
  empty: boolean;
  /**
   * 0..1: how much swipes, an imported history and corrections have told us
   * about this person altogether (0 = nothing, 1 = plenty). Used to tell a
   * person we know from a person we don't (see "cold start" in rank.ts).
   */
  evidence: number;
  /** Swipes + watch history (or the manual correction, which outranks both). */
  genre(g: GenreId): number;
  keyword(k: string): number;
  trait(t: string): number;
  /** The watch-history part on its own (0 when none), so wording can say where an opinion came from. */
  imported: { genre(g: string): number; keyword(k: string): number; trait(t: string): number };
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
  // The watch-history namespace, split out once so the per-title lookups stay cheap.
  const impG = new Map<string, number>();
  const impK = new Map<string, number>();
  const impT = new Map<string, number>();
  for (const key of Object.keys(traits)) {
    if (!isImportKey(key)) continue;
    const v = traits[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (key.startsWith(IMPORT_GENRE)) impG.set(key.slice(IMPORT_GENRE.length), v);
    else if (key.startsWith(IMPORT_KEYWORD)) impK.set(key.slice(IMPORT_KEYWORD.length), v);
    else if (key.startsWith(IMPORT_TRAIT)) impT.set(key.slice(IMPORT_TRAIT.length), v);
  }
  let total = 0.5 * (corrected.genres.size + corrected.keywords.size + corrected.traits.size);
  const mass = (map: Record<string, unknown>, scale: number) => {
    for (const k of Object.keys(map)) {
      const v = map[k];
      if (typeof v === 'number' && Number.isFinite(v)) total += scale * Math.abs(v);
    }
  };
  mass(genres as Record<string, unknown>, 1);
  mass(keywords, 0.5);
  mass(traits, 0.5); // includes the watch-history namespace
  const own = (map: Record<string, number>, k: string) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : 0);
  const sum = (a: number, b: number | undefined) => (b === undefined ? a : clamp(a + b, -1, 1));
  return {
    empty: !hasCorrections && !hasLearned,
    evidence: clamp(total / EVIDENCE_FULL),
    genre: (g) => corrected.genres.get(g) ?? sum(own(genres as Record<string, number>, g), impG.get(g)),
    keyword: (k) => corrected.keywords.get(k) ?? sum(own(keywords, k), impK.get(k)),
    trait: (t) => corrected.traits.get(t) ?? sum(own(traits, t), impT.get(t)),
    imported: { genre: (g) => impG.get(g) ?? 0, keyword: (k) => impK.get(k) ?? 0, trait: (t) => impT.get(t) ?? 0 },
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
