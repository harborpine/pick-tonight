/**
 * LEARNING TASTE FROM AN IMPORTED WATCH HISTORY.
 *
 * A history is far more evidence than a list of favourites: hundreds of titles
 * the person actually chose to watch. It is turned into "what does this person
 * watch a lot of" weights for genres, themes (keywords) and habits (traits).
 *
 * How much each title counts — plays, with diminishing returns:
 *     weight = log2(1 + plays), capped at MAX_TITLE_WEIGHT
 *   1 play = 1, 3 plays = 2, 7 = 3, 15 = 4, 31 or more = 5.
 * So a 200-episode binge counts five times a single film, not two hundred
 * times, and cannot swamp everything else.
 *
 * What is learned (all weights are 0..MAX_*, never negative — not having
 * watched something on one service is no evidence of disliking it):
 *  - Genres: how much of the history (by weight) each genre makes up, compared
 *    with how common the genre is in the catalog. Watching a lot of something
 *    everybody watches a lot of (drama) says little; a fifth of the history
 *    being reality TV says a lot.
 *  - Themes: keywords shared by at least two watched titles, by share of the
 *    history, rarer ones counting for more. Titles with no keywords still
 *    count towards genres and film-vs-series.
 *  - Habits: film vs series from every matched title; the finer habits
 *    (drop-in vs serialized, episode length, grown-up vs family...) from the
 *    matched titles that are in our catalog, when there are enough of them.
 *  - Acquired tastes (anime, kids' shows) are switched on when the history
 *    plainly includes them.
 * Everything is scaled by CONFIDENCE in the amount of evidence, so a five-line
 * paste teaches little and a real history teaches a lot.
 *
 * WHERE IT IS STORED, AND WHY IMPORTING TWICE DOES NOT DOUBLE IT.
 * Import weights live in their own namespace (taste.traits keys starting
 * 'imp:', see taste.ts), apart from what swipes teach, and scoring adds the
 * two. Each import MERGES into that namespace by keeping, per key, the larger
 * of the stored value and the new one:
 *  - the same file again        -> identical values -> nothing changes at all;
 *  - a newer, longer copy       -> values move only where the new file is stronger;
 *  - a second service's history -> its strong points are added to the first's,
 *                                  rather than wiping them (which "replace the
 *                                  namespace" would do) or stacking (which
 *                                  "add" would do).
 * This needs no record of past imports. The price: an import can never lower a
 * weight; the taste page's "less" correction is the way to do that.
 *
 * Swipe learning and manual corrections are left exactly as they were.
 */
import type { Catalog, GenreId, ImportedTitle, Profile } from '../../contracts';
import { GENRES } from '../../contracts';
import { getIndex, nichesOf, type CatalogIndex } from '../catalogIndex';
import { copyTaste } from '../learn';
import { IMPORT_GENRE, IMPORT_KEYWORD, IMPORT_TRAIT } from '../taste';
import { clamp, round4 } from '../util';

const MAX_TITLE_WEIGHT = 5;
/** Evidence (sum of title weights) at which confidence reaches one half. */
const HALF_CONFIDENCE = 12;
export const IMPORT_MAX_GENRE = 0.5;
export const IMPORT_MAX_KEYWORD = 0.45;
export const IMPORT_MAX_TRAIT = 0.3;
/** Only a title's most relevant keywords are learned from (as with swipes). */
const KEYWORDS_PER_TITLE = 8;
/** A theme must be shared by this many watched titles. */
const KEYWORD_MIN_TITLES = 2;
/** A theme making up this share of the history counts in full. */
const KEYWORD_FULL_SHARE = 0.12;
/** Keep the stored profile small. */
export const IMPORT_MAX_KEYWORDS = 40;
const FORGET_BELOW = 0.03;
/** Finer habits need this many matched titles that are in our catalog. */
const TRAITS_MIN_TITLES = 5;
/** An acquired taste is switched on when it makes up this much of the history (in at least two titles). */
const NICHE_MIN_SHARE = 0.05;

const catalogKeywords = new WeakMap<CatalogIndex, Set<string>>();
function knownKeywords(index: CatalogIndex): Set<string> {
  let set = catalogKeywords.get(index);
  if (!set) {
    set = new Set<string>();
    for (const info of index.infos) for (const k of info.kw) set.add(k);
    catalogKeywords.set(index, set);
  }
  return set;
}

export function titleWeight(plays: number): number {
  const p = Number.isFinite(plays) && plays > 0 ? plays : 1;
  return Math.min(MAX_TITLE_WEIGHT, Math.log2(1 + p));
}

export function learnFromImport(profile: Profile, matched: ImportedTitle[], catalog: Catalog): Profile {
  const taste = copyTaste(profile.taste);
  const next: Profile = { ...profile, favorites: [...(profile.favorites ?? [])], dealbreakers: { ...profile.dealbreakers }, taste };

  // One entry per title (a title listed twice keeps its larger play count).
  const titles = new Map<string, ImportedTitle>();
  for (const m of Array.isArray(matched) ? matched : []) {
    if (!m?.entry || typeof m.entry.id !== 'string') continue;
    const had = titles.get(m.entry.id);
    if (!had || (m.plays ?? 0) > (had.plays ?? 0)) titles.set(m.entry.id, m);
  }
  if (!titles.size) return next;

  const index = getIndex(catalog);
  const known = knownKeywords(index);
  const genreW = new Map<string, number>();
  const genreN = new Map<string, number>();
  const kwW = new Map<string, number>();
  const kwN = new Map<string, number>();
  const traitW = new Map<string, number>();
  const nicheW = new Map<string, number>();
  const nicheN = new Map<string, number>();
  let total = 0;
  let inCatalog = 0;
  let inCatalogW = 0;
  let movieW = 0;
  const add = (map: Map<string, number>, key: string, by: number) => map.set(key, (map.get(key) ?? 0) + by);

  for (const m of titles.values()) {
    const w = titleWeight(m.plays);
    total += w;
    const info = index.byId.get(m.entry.id);
    // Our own catalog knows the title better than the broad lookup does.
    const genres = info ? info.item.genres : (m.entry.genres ?? []);
    const keywords = info ? info.kw : (m.entry.keywords ?? []);
    for (const g of new Set(genres)) {
      if (!(g in GENRES)) continue;
      add(genreW, g, w);
      add(genreN, g, 1);
    }
    for (const k of [...new Set(keywords)].slice(0, KEYWORDS_PER_TITLE)) {
      if (typeof k !== 'string' || !known.has(k)) continue; // a theme no catalog title has can't affect a pick
      add(kwW, k, w);
      add(kwN, k, 1);
    }
    if (m.entry.kind === 'movie') movieW += w;
    if (info) {
      inCatalog++;
      inCatalogW += w;
      for (const t of info.traits) if (t !== 'kind:movie' && t !== 'kind:tv') add(traitW, t, w);
    }
    const niches = nichesOf(info ? info.item : { ...m.entry, tmdbId: 0, related: [], genres: (m.entry.genres ?? []) as GenreId[], keywords: m.entry.keywords ?? [] });
    for (const n of niches) {
      add(nicheW, n, w);
      add(nicheN, n, 1);
    }
  }
  if (total <= 0) return next;
  const confidence = total / (total + HALF_CONFIDENCE);
  const learned = new Map<string, number>();

  // ---- genres ----
  for (const [g, w] of genreW) {
    if ((genreN.get(g) ?? 0) < 2) continue;
    const share = w / total;
    const base = index.genreShare.get(g as GenreId) ?? 0.05;
    const aboveUsual = clamp((share - 0.75 * base) / 0.25); // a big slice of the history, beyond what's usual
    const unusually = clamp((share / Math.max(base, 0.01) - 1) / 2) * clamp(share / 0.1); // or far more than usual
    learned.set(IMPORT_GENRE + g, IMPORT_MAX_GENRE * confidence * Math.max(aboveUsual, unusually));
  }

  // ---- themes ----
  for (const [k, w] of kwW) {
    if ((kwN.get(k) ?? 0) < KEYWORD_MIN_TITLES) continue;
    learned.set(IMPORT_KEYWORD + k, IMPORT_MAX_KEYWORD * confidence * clamp(w / total / KEYWORD_FULL_SHARE) * (0.5 + 0.5 * index.kwWeight(k)));
  }

  // ---- habits ----
  const movieShare = movieW / total;
  learned.set(IMPORT_TRAIT + 'kind:movie', IMPORT_MAX_TRAIT * confidence * clamp((movieShare - 0.2) / 0.4));
  learned.set(IMPORT_TRAIT + 'kind:tv', IMPORT_MAX_TRAIT * confidence * clamp((1 - movieShare - 0.2) / 0.4));
  if (inCatalog >= TRAITS_MIN_TITLES && inCatalogW > 0) {
    for (const [t, w] of traitW) {
      const lift = w / inCatalogW - (index.traitShare.get(t) ?? 0);
      learned.set(IMPORT_TRAIT + t, IMPORT_MAX_TRAIT * confidence * clamp(lift / 0.3));
    }
  }

  // ---- acquired tastes ----
  for (const [n, w] of nicheW) {
    if ((nicheN.get(n) ?? 0) < 2 || w / total < NICHE_MIN_SHARE) continue;
    const key = n === 'anime' ? IMPORT_KEYWORD + 'anime' : IMPORT_GENRE + 'kids';
    const v = (n === 'anime' ? IMPORT_MAX_KEYWORD : IMPORT_MAX_GENRE) * confidence * clamp(w / total / 0.15);
    learned.set(key, Math.max(learned.get(key) ?? 0, v));
  }

  // ---- merge: per key, keep the larger of what was stored and what this import says ----
  const traits = taste.traits;
  for (const [key, value] of learned) {
    const v = round4(value);
    if (!(v >= FORGET_BELOW)) continue;
    const had = Object.prototype.hasOwnProperty.call(traits, key) ? traits[key] : 0;
    if (!(had >= v)) traits[key] = v;
  }
  // Only the strongest themes are kept.
  const kwKeys = Object.keys(traits).filter((k) => k.startsWith(IMPORT_KEYWORD));
  if (kwKeys.length > IMPORT_MAX_KEYWORDS) {
    kwKeys.sort((a, b) => traits[b] - traits[a] || (a < b ? -1 : 1));
    for (const k of kwKeys.slice(IMPORT_MAX_KEYWORDS)) delete traits[k];
  }
  return next;
}
