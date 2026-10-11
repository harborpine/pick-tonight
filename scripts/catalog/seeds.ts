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
 * Ids confirmed from the workflow run of 10 Oct 2026 ("SEED RESOLVED" lines). Missing entries fall back to search.
 * Key: `${kind}|${title}`.
 */
export const SEED_IDS: Record<string, number> = {
"movie|Forrest Gump": 13, // Forrest Gump (1994)
  "movie|The Hateful Eight": 273248, // The Hateful Eight (2015)
  "movie|The Hunger Games": 70160, // The Hunger Games (2012)
  "tv|Community": 18347, // Community (2009)
  "tv|Crazy Ex-Girlfriend": 63161, // Crazy Ex-Girlfriend (2015)
  "tv|Curb Your Enthusiasm": 4546, // Curb Your Enthusiasm (2000)
  "tv|Disenchantment": 73021, // Disenchantment (2018)
  "tv|Family Guy": 1434, // Family Guy (1999)
  "tv|Friends": 1668, // Friends (1994)
  "tv|Game of Thrones": 1399, // Game of Thrones (2011)
  "tv|Gilmore Girls": 4586, // Gilmore Girls (2000)
  "tv|Gossip Girl": 1395, // Gossip Girl (2007)
  "tv|Grey's Anatomy": 1416, // Grey's Anatomy (2005)
  "tv|How I Met Your Mother": 1100, // How I Met Your Mother (2005)
  "tv|How to Get Away with Murder": 61056, // How to Get Away with Murder (2014)
  "tv|Killing Eve": 72750, // Killing Eve (2018)
  "tv|Love Island": 90521, // Love Island USA (2019)
  "tv|Paradise": 245927, // Paradise (2025)
  "tv|Scandal": 39269, // Scandal (2012)
  "tv|Scrubs": 4556, // Scrubs (2001)
  "tv|Shameless": 34307, // Shameless (2011)
  "tv|South Park": 2190, // South Park (1997)
  "tv|Squid Game": 93405, // Squid Game (2021)
  "tv|Summer House": 69720, // Summer House (2017)
  "tv|Survivor": 14658, // Survivor (2000)
  "tv|The Devil's Plan": 214582, // The Devil's Plan (2023)
  "tv|The Great British Baking Show": 34549, // The Great British Bake Off (2010)
  "tv|The Simpsons": 456, // The Simpsons (1989)
  "tv|The Traitors": 215943, // The Traitors (2023)
  "tv|Why Women Kill": 87428, // Why Women Kill (2019)
  "tv|You": 78191, // You (2018)
};

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
