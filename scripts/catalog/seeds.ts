/**
 * Resolving the seeded favourites (SEED_FAVORITE_TITLES) to TMDB ids.
 * SEED_IDS holds ids confirmed from a workflow run log; search (with hints) is only the fallback.
 */
import type { TitleKind } from '../../src/contracts/catalog';
import { SEED_FAVORITE_TITLES } from '../../src/contracts/catalog';

export interface SeedHint {
  /** Search text if different from the title. */
  query?: string;
  /** Release (movie) or first-air (tv) year. */
  year?: number;
  /** ISO country the show originates from. */
  country?: string;
}

/** Disambiguation for titles that have several TMDB entries (remakes, other countries). */
export const SEED_HINTS: Record<string, SeedHint> = {
  'tv|Scrubs': { year: 2001 },
  'tv|How I Met Your Mother': { year: 2005 },
  'movie|The Hateful Eight': { year: 2015 },
  'movie|Forrest Gump': { year: 1994 },
  'tv|Family Guy': { year: 1999 },
  'tv|The Simpsons': { year: 1989 },
  'tv|Curb Your Enthusiasm': { year: 2000 },
  "tv|Grey's Anatomy": { year: 2005 },
  'movie|The Hunger Games': { year: 2012 },
  'tv|South Park': { year: 1997 },
  'tv|Disenchantment': { year: 2018 },
  "tv|The Devil's Plan": { year: 2023, country: 'KR' },
  'tv|Summer House': { year: 2017, country: 'US' },
  'tv|Game of Thrones': { year: 2011 },
  'tv|Scandal': { year: 2012, country: 'US' },
  'tv|The Great British Baking Show': { query: 'The Great British Bake Off', year: 2010, country: 'GB' },
  'tv|Survivor': { year: 2000, country: 'US' },
  'tv|The Traitors': { year: 2023, country: 'US' },
  'tv|Community': { year: 2009 },
  'tv|How to Get Away with Murder': { year: 2014 },
  'tv|Love Island': { query: 'Love Island', year: 2019, country: 'US' },
  'tv|Squid Game': { year: 2021 },
  'tv|Friends': { year: 1994 },
  'tv|Crazy Ex-Girlfriend': { year: 2015 },
  'tv|Killing Eve': { year: 2018 },
  'tv|Why Women Kill': { year: 2019 },
  'tv|Paradise': { year: 2025, country: 'US' },
  'tv|Shameless': { year: 2011, country: 'US' },
  'tv|Gossip Girl': { year: 2007 },
  'tv|Gilmore Girls': { year: 2000 },
  'tv|You': { year: 2018, country: 'US' },
};

/**
 * Ids confirmed from a workflow run log ("SEED RESOLVED" lines). Empty entries fall back to search.
 * Key: `${kind}|${title}`.
 */
export const SEED_IDS: Record<string, number> = {};

export const hintKey = (kind: TitleKind, title: string) => `${kind}|${title}`;

export interface SeedTitle {
  key: string;
  title: string;
  kind: TitleKind;
  hint: SeedHint;
}

/** Unique seed titles across HG and BG. */
export function allSeedTitles(): SeedTitle[] {
  const seen = new Map<string, SeedTitle>();
  for (const who of ['HG', 'BG'] as const)
    for (const s of SEED_FAVORITE_TITLES[who]) {
      const key = hintKey(s.kind, s.title);
      if (!seen.has(key)) seen.set(key, { key, title: s.title, kind: s.kind, hint: SEED_HINTS[key] ?? {} });
    }
  return [...seen.values()];
}

/** Pick the right search hit: year match, then origin country, then popularity. */
export function chooseSearchResult(results: any[], kind: TitleKind, hint: SeedHint): { hit: any; confident: boolean } | null {
  if (!results.length) return null;
  const dateOf = (r: any): string => (kind === 'movie' ? r.release_date : r.first_air_date) || '';
  const yearOf = (r: any) => Number(dateOf(r).slice(0, 4));
  const pop = (r: any) => r.popularity ?? 0;
  let pool = results;
  let confident = true;
  if (hint.year) {
    const exact = pool.filter((r) => yearOf(r) === hint.year);
    const near = pool.filter((r) => Math.abs(yearOf(r) - hint.year!) <= 1);
    if (exact.length) pool = exact;
    else if (near.length) pool = near;
    else confident = false;
  }
  if (hint.country && kind === 'tv') {
    const c = pool.filter((r) => (r.origin_country ?? []).includes(hint.country));
    if (c.length) pool = c;
    else confident = false;
  }
  const hit = [...pool].sort((a, b) => pop(b) - pop(a))[0];
  return { hit, confident };
}
