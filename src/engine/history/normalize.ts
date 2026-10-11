/**
 * NAME MATCHING for the watch-history import and the "add something I've
 * watched" search. One lookup is built per TitleIndex object and cached, so
 * matching thousands of rows (or searching on every keystroke) never
 * re-normalises the 20,000 names.
 *
 * Two names are "the same" when they agree after:
 *   - ignoring case and accents            Amélie            = amelie
 *   - "&" and "and" being the same word    Love & Death      = Love and Death
 *   - dropping apostrophes                 Grey's Anatomy    = Greys Anatomy
 *   - treating other punctuation as space  Spider-Man: Home  = Spider Man Home
 *   - dropping a leading The / A / An      The Office        = Office
 *   - dropping a trailing (U.S.) / (US) / (UK) / (2019)
 * plus any `aka` name the lookup lists. Nothing looser than that: no partial
 * or sounds-like matching.
 */
import type { TitleIndex, TitleIndexEntry } from '../../contracts';

const APOSTROPHES = /['‘’ʼ`´]/g;
const NOT_WORD = /[^\p{L}\p{N}]+/gu;
const MARKS = /\p{M}+/gu;
const LEADING_ARTICLE = /^(?:the|an|a) (?=\S)/;
/** A trailing bracket that only says which country's version or which year: "(U.S.)", "(US)", "(UK)", "(2019)". */
const TRAILING_TAG = /\s*\((?:u\.?\s?s\.?(?:\.?a\.?)?|u\.?\s?k\.?|au|ca|\d{4})\)\s*$/i;

/** Lower-case, accent-free, punctuation-free words separated by single spaces. Leading articles are KEPT. */
export function squash(name: string): string {
  const s = String(name ?? '')
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(/&/g, ' and ')
    .replace(NOT_WORD, ' ')
    .trim();
  // A name that is nothing but punctuation ("?", "!!!") keeps its raw text so it can still match itself.
  return s || String(name ?? '').trim().toLowerCase();
}

export const dropArticle = (squashed: string): string => squashed.replace(LEADING_ARTICLE, '');

/** The key names are compared by. */
export const nameKey = (name: string): string => dropArticle(squash(name));

/** Splits a trailing "(U.S.)" / "(2019)" off a name. `year` is set when the tag was a year. */
export function splitTag(name: string): { base: string; year: number | null; tagged: boolean } {
  const m = TRAILING_TAG.exec(name);
  if (!m) return { base: name, year: null, tagged: false };
  const y = /\d{4}/.exec(m[0]);
  const year = y ? Number(y[0]) : null;
  // "(1917)"-style brackets are only a year tag when the year is plausible for a film or show.
  if (year !== null && (year < 1900 || year > 2100)) return { base: name, year: null, tagged: false };
  const base = name.slice(0, m.index).trim();
  return base ? { base, year, tagged: true } : { base: name, year: null, tagged: false };
}

export interface SearchName {
  /** Squashed, article kept ("the office"). */
  full: string;
  /** Squashed, article dropped ("office"). */
  bare: string;
  aka: boolean;
}

export interface Lookup {
  /** nameKey -> every entry listed under that name (title or aka), most popular first. */
  byKey: Map<string, TitleIndexEntry[]>;
  /** For searching: each entry with its squashed names, most popular first. */
  search: { entry: TitleIndexEntry; names: SearchName[] }[];
}

const cache = new WeakMap<TitleIndex, Lookup>();

const byPopularity = (a: TitleIndexEntry, b: TitleIndexEntry) =>
  (b.popularity ?? 0) - (a.popularity ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function getLookup(index: TitleIndex): Lookup {
  let hit = cache.get(index);
  if (hit) return hit;
  const byKey = new Map<string, TitleIndexEntry[]>();
  const search: Lookup['search'] = [];
  const titles = Array.isArray(index?.titles) ? index.titles : [];
  const add = (key: string, entry: TitleIndexEntry) => {
    if (!key) return;
    const list = byKey.get(key);
    if (!list) byKey.set(key, [entry]);
    else if (!list.includes(entry)) list.push(entry);
  };
  for (const entry of titles) {
    if (!entry || typeof entry.title !== 'string' || typeof entry.id !== 'string') continue;
    const names: SearchName[] = [];
    const all = [entry.title, ...(Array.isArray(entry.aka) ? entry.aka : [])];
    all.forEach((name, k) => {
      if (typeof name !== 'string' || !name.trim()) return;
      const full = squash(name);
      const bare = dropArticle(full);
      add(bare, entry);
      // A lookup title that itself carries a tag ("Shameless (US)") is also findable without it.
      const tag = splitTag(name);
      if (tag.tagged) add(nameKey(tag.base), entry);
      if (!names.some((n) => n.full === full)) names.push({ full, bare, aka: k > 0 });
    });
    if (names.length) search.push({ entry, names });
  }
  for (const list of byKey.values()) if (list.length > 1) list.sort(byPopularity);
  search.sort((a, b) => byPopularity(a.entry, b.entry));
  hit = { byKey, search };
  cache.set(index, hit);
  return hit;
}
