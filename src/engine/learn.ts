/**
 * PROFILES AND LEARNING.
 *
 * Every card action nudges the person's learned weights a little:
 *
 *   yes          clearly positive
 *   save         positive (a bit less than yes: "sounds good", not "watching now")
 *   seen         slightly positive (they chose to watch it once)
 *   not tonight  almost nothing (it's about tonight, not about taste)
 *   never        strongly negative
 *
 * Each nudge moves a weight a fraction of the way toward +1 or -1, so weights
 * can never leave -1..1 and no single swipe dominates: it takes a run of
 * consistent swipes to build a strong opinion. Every swipe also fades all
 * existing weights very slightly, so old habits give way to new ones.
 * A dislike of something the favourites clearly love is discounted (one bad
 * sitcom shouldn't turn a sitcom-lover's deck upside down).
 * Manual corrections are stored separately and are never touched by learning.
 */
import { NO_DEALBREAKERS, type Catalog, type CatalogItem, type Dealbreakers, type GenreId, type Profile, type SwipeAction, type TasteWeights } from '../contracts';
import { getIndex, nichesOf, traitsOf } from './catalogIndex';
import { getFavModel, emptyTaste, isImportKey } from './taste';
import { clamp, round4 } from './util';

/** Signed learning rate per action. */
export const LEARN_RATE: Record<SwipeAction, number> = {
  yes: 0.08,
  save: 0.06,
  seen: 0.02,
  'not-tonight': -0.008,
  never: -0.22,
};
/** Every swipe multiplies existing weights by this (slow forgetting). */
const DECAY = 0.998;
const KEYWORD_SHARE = 0.8;
const TRAIT_SHARE = 0.6;
/** Only a title's most relevant keywords are learned from. */
const KEYWORDS_LEARNED = 8;
/** Keep the stored profile small: only the strongest keyword opinions are kept. */
const MAX_KEYWORDS = 150;
const FORGET_BELOW = 0.004;

/**
 * Where everybody starts: nothing known. No favourites, no "never show me"
 * choices, no learned taste. (Picks for such a person are quality-led and
 * varied — see "cold start" in rank.ts.) A fresh object every time.
 */
export function emptyProfile(): Omit<Profile, 'id'> {
  return { favorites: [], dealbreakers: copyDealbreakers(NO_DEALBREAKERS), taste: emptyTaste(), onboarded: false };
}

export function copyDealbreakers(d: Dealbreakers | undefined): Dealbreakers {
  return {
    horror: !!d?.horror,
    trueCrime: !!d?.trueCrime,
    scary: !!d?.scary,
    genres: Array.isArray(d?.genres) ? [...d.genres] : [],
    subtitled: !!d?.subtitled,
  };
}

function copyTaste(t: TasteWeights | undefined): TasteWeights {
  return {
    genres: { ...(t?.genres ?? {}) },
    keywords: { ...(t?.keywords ?? {}) },
    traits: { ...(t?.traits ?? {}) },
    corrections: { ...(t?.corrections ?? {}) },
  };
}

function nudge(map: Record<string, number>, key: string, rate: number): void {
  const w = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : 0;
  const target = rate >= 0 ? 1 : -1;
  map[key] = clamp(w + Math.abs(rate) * (target - w), -1, 1);
}

function fade(map: Record<string, number>): void {
  for (const k of Object.keys(map)) {
    // What a watch-history import taught is a record of what they watched, not a swipe habit: it does not fade.
    if (isImportKey(k)) continue;
    const v = map[k] * DECAY;
    if (Math.abs(v) < FORGET_BELOW || !Number.isFinite(v)) delete map[k];
    else map[k] = v;
  }
}

function tidy(map: Record<string, number>): void {
  for (const k of Object.keys(map)) map[k] = round4(map[k]);
}

export function learnFromSwipe(profile: Profile, item: CatalogItem, action: SwipeAction, catalog: Catalog): Profile {
  const rate = LEARN_RATE[action] ?? 0;
  const taste = copyTaste(profile.taste);
  const next: Profile = {
    ...profile,
    favorites: [...(profile.favorites ?? [])],
    dealbreakers: copyDealbreakers(profile.dealbreakers),
    taste,
  };
  if (rate === 0) return next;

  const genres = taste.genres as Record<string, number>;
  fade(genres);
  fade(taste.keywords);
  fade(taste.traits);

  const index = getIndex(catalog);
  const fav = getFavModel(catalog, profile.favorites);
  const negative = rate < 0;
  // A dislike counts for less against something the favourites are full of.
  const discount = (share: number) => (negative ? 1 - 0.6 * clamp(share) : 1);

  for (const g of new Set(item.genres ?? [])) nudge(genres, g, rate * discount((fav.genreShare.get(g as GenreId) ?? 0) * 1.5));
  for (const k of [...new Set(item.keywords ?? [])].slice(0, KEYWORDS_LEARNED)) {
    nudge(taste.keywords, k, rate * KEYWORD_SHARE * discount((fav.kwCount.get(k) ?? 0) / 3));
  }
  // Acquired tastes are learned under their own key however the title was tagged.
  const niches = nichesOf(item);
  const learnedKw = new Set([...new Set(item.keywords ?? [])].slice(0, KEYWORDS_LEARNED));
  if (niches.includes('anime') && !learnedKw.has('anime')) nudge(taste.keywords, 'anime', rate * KEYWORD_SHARE);
  if (niches.includes('kids') && !(item.genres ?? []).includes('kids')) nudge(genres, 'kids', rate);
  const traits = index.byId.get(item.id)?.traits ?? traitsOf(item, index.builtYear);
  for (const t of traits) nudge(taste.traits, t, rate * TRAIT_SHARE * discount(fav.traitShare.get(t) ?? 0));

  // Keep only the strongest keyword opinions.
  const keys = Object.keys(taste.keywords);
  if (keys.length > MAX_KEYWORDS) {
    keys.sort((a, b) => Math.abs(taste.keywords[b]) - Math.abs(taste.keywords[a]) || (a < b ? -1 : 1));
    for (const k of keys.slice(MAX_KEYWORDS)) delete taste.keywords[k];
  }
  tidy(genres);
  tidy(taste.keywords);
  tidy(taste.traits);
  return next;
}

export { copyTaste };

export function correctTaste(profile: Profile, insightKey: string, correction: 'more' | 'less' | null): Profile {
  const taste = copyTaste(profile.taste);
  if (correction === 'more' || correction === 'less') taste.corrections[insightKey] = correction;
  else delete taste.corrections[insightKey];
  return { ...profile, favorites: [...(profile.favorites ?? [])], dealbreakers: copyDealbreakers(profile.dealbreakers), taste };
}
