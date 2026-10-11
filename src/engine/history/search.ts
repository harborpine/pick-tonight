/**
 * TITLE SEARCH for "add something I've watched". Called on every keystroke, so
 * it is one pass over names that were tidied once per lookup (normalize.ts).
 *
 * Best first:
 *   0  the name IS the query                    "the office"  -> The Office
 *   1  the name starts with it                  "off"         -> (The) Office, Office Space
 *   2  a later word starts with it              "anatomy"     -> Grey's Anatomy
 *   3  it appears somewhere inside (3+ letters) "natom"       -> Grey's Anatomy
 * A match on an alternative (`aka`) name ranks just behind the same kind of
 * match on the main title. Within a rank, the more popular title comes first.
 * A leading The / A / An is optional on both sides.
 */
import type { TitleIndex, TitleIndexEntry } from '../../contracts';
import { dropArticle, getLookup, squash } from './normalize';

export function searchTitles(query: string, index: TitleIndex, limit: number): TitleIndexEntry[] {
  const max = Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0));
  if (max === 0 || typeof query !== 'string') return [];
  const q = squash(query);
  if (!q) return [];
  const bareQ = dropArticle(q);
  const spaced = ` ${q}`;
  const allowInside = q.length >= 3;
  const lookup = getLookup(index);

  // lookup.search is already most-popular-first, so each rank's bucket fills in popularity order.
  const buckets: TitleIndexEntry[][] = [[], [], [], [], [], [], [], []];
  for (const { entry, names } of lookup.search) {
    let best = 99;
    for (const n of names) {
      let rank: number;
      if (n.full === q || n.bare === q || n.bare === bareQ) rank = 0;
      else if (n.full.startsWith(q) || n.bare.startsWith(q)) rank = 1;
      else if (n.full.includes(spaced)) rank = 2;
      else if (allowInside && n.full.includes(q)) rank = 3;
      else continue;
      const r = rank * 2 + (n.aka ? 1 : 0);
      if (r < best) best = r;
    }
    if (best < 99) buckets[best].push(entry);
  }
  const out: TitleIndexEntry[] = [];
  for (const b of buckets) {
    for (const e of b) {
      out.push(e);
      if (out.length >= max) return out;
    }
  }
  return out;
}
