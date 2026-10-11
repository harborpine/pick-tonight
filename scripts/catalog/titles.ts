/**
 * public/data/titles.json: a broad name lookup for the "import my watch history" feature.
 * Pure helpers here (row conversion, merging, trimming, validation); the network part is fetchTitleRows().
 */
import type { CatalogItem, TasteRef, TitleIndex, TitleIndexEntry, TitleKind } from '../../src/contracts/catalog';
import { mapGenres } from './tagging';
import { round2 } from './util';

export const TITLES_MIN = 8000;
export const TITLES_MAX_BYTES = 3_000_000;

/** What we keep from one TMDB list row (also what the per-run cache stores). */
export interface ListRow {
  id: number;
  title: string;
  original: string;
  date: string;
  genreIds: number[];
  poster: string | null;
  popularity: number;
}

/** Normalises one raw TMDB list result (movie or tv) or returns null when unusable. */
export function toListRow(kind: TitleKind, r: any): ListRow | null {
  if (!r || typeof r.id !== 'number' || r.adult) return null;
  const title: string = (kind === 'movie' ? r.title : r.name) || '';
  const original: string = (kind === 'movie' ? r.original_title : r.original_name) || '';
  const date: string = (kind === 'movie' ? r.release_date : r.first_air_date) || '';
  if (!title.trim() || !/^\d{4}/.test(date)) return null;
  return {
    id: r.id,
    title: title.trim(),
    original: original.trim(),
    date,
    genreIds: Array.isArray(r.genre_ids) ? r.genre_ids : [],
    poster: r.poster_path ?? null,
    popularity: round2(r.popularity ?? 0),
  };
}

export function rowToEntry(kind: TitleKind, row: ListRow): TitleIndexEntry {
  const aka = row.original && row.original.toLowerCase() !== row.title.toLowerCase() ? [row.original] : [];
  return {
    id: `${kind}-${row.id}`,
    kind,
    title: row.title,
    year: Number(row.date.slice(0, 4)),
    genres: mapGenres(row.genreIds),
    keywords: [],
    ...(aka.length ? { aka } : {}),
    poster: row.poster,
    popularity: Math.round(row.popularity * 10) / 10,
  };
}

function mergeAka(a: string[] | undefined, b: string[] | undefined, title: string): string[] {
  const seen = new Set<string>([title.toLowerCase()]);
  const out: string[] = [];
  for (const x of [...(a ?? []), ...(b ?? [])]) {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Alternate names (aka)
// ---------------------------------------------------------------------------

export interface AltTitle {
  country: string;
  title: string;
  type: string;
}

const ENGLISH_GROUPS = [['US'], ['GB', 'CA', 'AU', 'IE', 'NZ']];
const JUNK = /\bseason\s*\d|\bseries\s*\d|\bworking\b|\btemp(orary)?\b|\bepisode\b|\bpromo\b|\bdvd\b|\bprovisional\b|\btbd\b/i;
export const AKA_MAX = 5;

/** Hand-checked names TMDB lacks (id -> US names). Only for shows people actually import. */
export const EXTRA_AKA: Record<string, string[]> = {
  // Channel 4 era of the show; US streaming calls both eras "The Great British Baking Show".
  'tv-87012': ['The Great British Baking Show'],
};

export function isJunkName(name: string): boolean {
  const t = name.trim();
  return !t || t.length > 80 || JUNK.test(t);
}

/**
 * Tidy alternate names: `existing` (original-language title and anything already known) first,
 * then US names, then other English-speaking countries; case-insensitive de-dupe, no names equal to
 * the title, no junk (working titles, "Season 1", over 80 characters), at most AKA_MAX.
 */
export function cleanAka(title: string, existing: string[] | undefined, alts: AltTitle[] | undefined): string[] {
  const seen = new Set<string>([title.trim().toLowerCase()]);
  const out: string[] = [];
  const take = (name: string, trusted: boolean) => {
    const n = name.trim().replace(/\s+/g, ' ');
    const k = n.toLowerCase();
    if (!n || seen.has(k) || n.length > 80) return;
    if (!trusted && isJunkName(n)) return;
    seen.add(k);
    out.push(n);
  };
  for (const e of existing ?? []) take(e, true);
  const usable = (alts ?? []).filter((a) => !/working/i.test(a.type));
  for (const group of ENGLISH_GROUPS) for (const a of usable) if (group.includes(a.country)) take(a.title, false);
  return out.slice(0, AKA_MAX);
}

export interface IndexInputs {
  items: CatalogItem[];
  tasteRefs: TasteRef[];
  /** Original titles for catalog items / tasteRefs where known (id -> original title). */
  originals?: Map<string, string>;
  listRows: { kind: TitleKind; row: ListRow }[];
  /** Alternative titles by id (catalog items from their details, others from the alt-name cache). */
  alternates?: Map<string, AltTitle[]>;
}

/**
 * Builds the entries: catalog items and tasteRefs win (real keywords, first 6), list rows fill the rest.
 * De-duplicated by id; alternates are merged; sorted most popular first.
 */
export function buildTitleIndex(inp: IndexInputs): TitleIndexEntry[] {
  const byId = new Map<string, TitleIndexEntry>();
  const put = (e: TitleIndexEntry) => {
    const prev = byId.get(e.id);
    if (!prev) {
      byId.set(e.id, e);
      return;
    }
    const aka = mergeAka(prev.aka, e.aka, prev.title);
    byId.set(e.id, {
      ...prev,
      keywords: prev.keywords.length ? prev.keywords : e.keywords,
      genres: prev.genres.length ? prev.genres : e.genres,
      poster: prev.poster ?? e.poster ?? null,
      popularity: Math.max(prev.popularity, e.popularity),
      ...(aka.length ? { aka } : {}),
    });
  };
  const fromCore = (c: { id: string; kind: TitleKind; title: string; year: number; genres: TitleIndexEntry['genres']; keywords: string[] }, poster: string | null, popularity: number): TitleIndexEntry => {
    const orig = inp.originals?.get(c.id);
    const aka = orig && orig.toLowerCase() !== c.title.toLowerCase() ? [orig] : [];
    return {
      id: c.id,
      kind: c.kind,
      title: c.title,
      year: c.year,
      genres: c.genres,
      keywords: c.keywords.slice(0, 6),
      ...(aka.length ? { aka } : {}),
      poster,
      popularity: Math.round(popularity * 10) / 10,
    };
  };
  for (const i of inp.items) put(fromCore(i, i.poster, i.popularity));
  for (const r of inp.tasteRefs) put(fromCore(r, null, 0));
  for (const { kind, row } of inp.listRows) put(rowToEntry(kind, row));
  for (const [id, e] of byId) {
    const aka = cleanAka(e.title, [...(e.aka ?? []), ...(EXTRA_AKA[id] ?? [])], inp.alternates?.get(id));
    const { aka: _old, ...rest } = e;
    void _old;
    byId.set(id, aka.length ? { ...rest, aka } : rest);
  }
  return [...byId.values()].sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id));
}

/** Drops the least popular entries (never `keep` ids) until the JSON fits the byte budget. */
export function trimIndexToBytes(entries: TitleIndexEntry[], keep: Set<string>, builtAt: string, maxBytes = TITLES_MAX_BYTES): TitleIndexEntry[] {
  const size = (list: TitleIndexEntry[]) => Buffer.byteLength(JSON.stringify({ schema: 1, builtAt, titles: list }));
  let list = entries;
  let bytes = size(list);
  while (bytes > maxBytes && list.length > 0) {
    const drop = Math.max(50, Math.ceil(((bytes - maxBytes) / bytes) * list.length));
    // list is sorted by popularity desc: remove from the tail, skipping protected ids
    const kept: TitleIndexEntry[] = [];
    let dropped = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (dropped < drop && !keep.has(list[i].id)) dropped++;
      else kept.push(list[i]);
    }
    if (dropped === 0) break;
    list = kept.reverse();
    bytes = size(list);
  }
  return list;
}

export function validateTitleIndex(idx: TitleIndex, bytes: number, requiredIds: string[], minEntries = TITLES_MIN, maxBytes = TITLES_MAX_BYTES + 200_000): string[] {
  const problems: string[] = [];
  if (idx.titles.length < minEntries) problems.push(`titles.json has only ${idx.titles.length} entries (minimum ${minEntries})`);
  if (bytes > maxBytes) problems.push(`titles.json is ${bytes} bytes (limit ${maxBytes})`);
  const ids = new Set(idx.titles.map((t) => t.id));
  if (ids.size !== idx.titles.length) problems.push('titles.json has duplicate ids');
  const missing = requiredIds.filter((id) => !ids.has(id));
  if (missing.length) problems.push(`titles.json is missing ${missing.length} catalog/taste titles, e.g. ${missing.slice(0, 5).join(', ')}`);
  return problems;
}

// ---------------------------------------------------------------------------
// Fetching list pages
// ---------------------------------------------------------------------------

export interface ListJob {
  kind: TitleKind;
  /** Path under /3, e.g. '/discover/movie'. */
  path: string;
  params: Record<string, string | number | boolean>;
  pages: number;
  /** Stable name for the cache file. */
  name: string;
}

const LANGS = ['ko', 'ja', 'es', 'fr', 'de', 'hi', 'it', 'pt', 'tr', 'zh', 'th', 'sv', 'da', 'no', 'pl', 'ru', 'id', 'ta'];

/** The list pages to fetch: about 1,500 calls for ~15,000 distinct titles. */
export function titleListJobs(): ListJob[] {
  const jobs: ListJob[] = [];
  for (const kind of ['movie', 'tv'] as const) {
    const base = { include_adult: false, language: 'en-US' };
    jobs.push({ kind, path: `/discover/${kind}`, params: { ...base, sort_by: 'popularity.desc', 'vote_count.gte': 25 }, pages: 230, name: `${kind}-disc-pop` });
    jobs.push({ kind, path: `/discover/${kind}`, params: { ...base, sort_by: 'vote_count.desc' }, pages: 230, name: `${kind}-disc-votes` });
    jobs.push({ kind, path: `/${kind}/popular`, params: { ...base }, pages: 80, name: `${kind}-popular` });
    jobs.push({ kind, path: `/${kind}/top_rated`, params: { ...base }, pages: 80, name: `${kind}-top` });
    for (const lang of LANGS)
      jobs.push({ kind, path: `/discover/${kind}`, params: { ...base, sort_by: 'popularity.desc', with_original_language: lang, 'vote_count.gte': 15 }, pages: 8, name: `${kind}-lang-${lang}` });
  }
  return jobs;
}
