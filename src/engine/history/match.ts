/**
 * MATCHING HISTORY ROWS TO TITLES.
 *
 * A history file lists every episode separately, in shapes like
 *     The Office (U.S.): Season 4: Dinner Party
 *     Stranger Things: Stranger Things 2: Chapter One: MADMAX
 *     The Queen's Gambit: Limited Series: Openings
 *     Black Mirror: Bandersnatch
 * Each row is cut on ": " and progressively shorter beginnings are looked up,
 * longest first; the longest beginning that is a known title wins. So
 * "Black Mirror: Bandersnatch" is the film when the lookup has it and the
 * series otherwise, and "Dune: Part Two" is the film, not an episode of Dune.
 *
 * Guard rails (nothing is guessed loosely — a wrong match would quietly mark
 * the wrong title as watched):
 *  - Names are compared exactly, after the tidying in normalize.ts.
 *  - A shortened beginning means the row was an episode, so it may only match
 *    a SERIES, never a film ("Avatar: The Last Airbender: Book 1: ..." must
 *    not become the film Avatar).
 *  - When the row has a season marker ("Season 2", "Limited Series",
 *    "Part 1", "Volume 3", "Chapter One", "Stranger Things 2"...), everything
 *    before the marker is the show's name and is never shortened further
 *    ("Star Trek: Picard: Season 1: ..." must not become Star Trek).
 *  - Same-name titles: one whose name agrees including its The / A / An is
 *    preferred over one that only agrees without it ("Hustle" is not "The
 *    Hustle" when both exist); a "(2019)" year in the row picks the title from that
 *    year; then a series is preferred when the row was an episode, and a film
 *    when a Netflix row was not (Netflix always writes series with a colon);
 *    then the more popular one wins.
 *
 * Rows that match the same title are added up (`plays`), keeping the latest
 * date. Everything else is reported in `unmatched`, most-played first.
 */
import type { HistoryRow, ImportedTitle, ImportResult, ParsedHistory, TitleIndex, TitleIndexEntry, TitleKind } from '../../contracts';
import { getLookup, nameKey, splitTag, squash, type Lookup } from './normalize';

const NUMBER_WORD = '(?:\\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
/** A segment that says "which season / part", not what the show is called. */
const MARKER = new RegExp(
  `^(?:(?:season|series|part|volume|vol\\.?|chapter|book|episode|ep\\.?|collection|cycle|installment|temporada|saison|staffel|stagione)\\s+${NUMBER_WORD}\\b.*` +
    `|limited series|mini-?series|the complete series|specials?|season \\d+.*)$`,
  'i',
);

function isMarker(segment: string, showSoFar: string): boolean {
  const s = segment.trim();
  if (MARKER.test(s)) return true;
  // Netflix's "Stranger Things: Stranger Things 2: ..." (the show's name again, plus a number).
  if (showSoFar && s.length > showSoFar.length && s.toLowerCase().startsWith(showSoFar.toLowerCase())) {
    return new RegExp(`^\\s*${NUMBER_WORD}$`, 'i').test(s.slice(showSoFar.length));
  }
  return false;
}

interface Hint {
  kind: TitleKind | null;
  /** When true, only that kind will do. */
  strict: boolean;
}

function choose(name: string, lookup: Lookup, hint: Hint, keyCache: Map<string, string>): TitleIndexEntry | null {
  const find = (text: string): TitleIndexEntry[] | undefined => {
    let key = keyCache.get(text);
    if (key === undefined) {
      key = nameKey(text);
      keyCache.set(text, key);
    }
    return key ? lookup.byKey.get(key) : undefined;
  };
  // First as written (so "The Office (UK)" can hit a lookup entry listed under exactly that), then without the tag.
  let candidates = find(name);
  let year: number | null = null;
  let asWritten = name;
  if (!candidates?.length) {
    const tag = splitTag(name);
    if (!tag.tagged) return null;
    year = tag.year;
    asWritten = tag.base;
    candidates = find(tag.base);
    if (!candidates?.length) return null;
  }
  let pool = candidates; // most popular first
  if (pool.length > 1) {
    // "Hustle" and "The Hustle" are different films: prefer the one that agrees article and all.
    const full = squash(asWritten);
    const exact = pool.filter((e) => squash(e.title) === full || (e.aka ?? []).some((a) => typeof a === 'string' && squash(a) === full));
    if (exact.length) pool = exact;
  }
  if (hint.kind && hint.strict) {
    pool = pool.filter((e) => e.kind === hint.kind);
    if (!pool.length) return null;
  }
  if (year !== null) {
    const sameYear = pool.filter((e) => Math.abs((e.year ?? 0) - year!) <= 1);
    if (sameYear.length) pool = sameYear;
  }
  if (hint.kind && !hint.strict) {
    const preferred = pool.filter((e) => e.kind === hint.kind);
    if (preferred.length) pool = preferred;
  }
  return pool[0];
}

interface RowResult {
  entry: TitleIndexEntry | null;
  /** The name to report when nothing matched. */
  name: string;
  /** For unmatched rows with no season marker: the text before the first ": " (to group a series' episodes). */
  lead: string | null;
}

function matchRow(raw: string, format: ParsedHistory['format'], lookup: Lookup, keyCache: Map<string, string>): RowResult {
  const text = raw.trim();
  const parts = text.split(': ').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { entry: null, name: text, lead: null };

  // Where the show's name ends, if the row says so.
  let marker = -1;
  for (let k = 1; k < parts.length; k++) {
    if (isMarker(parts[k], parts.slice(0, k).join(': ')) || isMarker(parts[k], parts[0])) {
      marker = k;
      break;
    }
  }

  const shortest = marker > 0 ? marker : 1;
  for (let len = parts.length; len >= shortest; len--) {
    const whole = len === parts.length;
    // A bare Netflix row is a film or a special; a typed list or other file tells us nothing.
    const hint: Hint = whole ? { kind: format === 'netflix' && parts.length === 1 ? 'movie' : null, strict: false } : { kind: 'tv', strict: true };
    const entry = choose(parts.slice(0, len).join(': '), lookup, hint, keyCache);
    if (entry) return { entry, name: text, lead: null };
  }
  if (marker > 0) return { entry: null, name: parts.slice(0, marker).join(': '), lead: null };
  return { entry: null, name: text, lead: parts.length > 1 ? parts[0] : null };
}

export function matchWatchHistory(parsed: ParsedHistory, index: TitleIndex): ImportResult {
  const rows: HistoryRow[] = Array.isArray(parsed?.rows) ? parsed.rows : [];
  if (!rows.length) return { matched: [], unmatched: [] };
  const lookup = getLookup(index);
  const format = parsed.format;
  const keyCache = new Map<string, string>();
  const rowCache = new Map<string, RowResult>();

  const matched = new Map<string, ImportedTitle>();
  const misses: RowResult[] = [];
  const leadCount = new Map<string, number>();

  for (const row of rows) {
    if (!row || typeof row.raw !== 'string') continue;
    let res = rowCache.get(row.raw);
    if (!res) {
      res = matchRow(row.raw, format, lookup, keyCache);
      rowCache.set(row.raw, res);
    }
    if (res.entry) {
      const at = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : undefined;
      const hit = matched.get(res.entry.id);
      if (!hit) matched.set(res.entry.id, at === undefined ? { entry: res.entry, plays: 1 } : { entry: res.entry, plays: 1, lastWatched: at });
      else {
        hit.plays++;
        if (at !== undefined && (hit.lastWatched === undefined || at > hit.lastWatched)) hit.lastWatched = at;
      }
    } else if (res.name) {
      misses.push(res);
      if (res.lead) {
        const k = res.lead.toLowerCase();
        leadCount.set(k, (leadCount.get(k) ?? 0) + 1);
      }
    }
  }

  // Unmatched rows: several "X: something" rows with the same X are episodes of one unknown series.
  const unmatched = new Map<string, { name: string; plays: number }>();
  for (const res of misses) {
    const name = res.lead && (leadCount.get(res.lead.toLowerCase()) ?? 0) >= 2 ? res.lead : res.name;
    const key = name.toLowerCase();
    const hit = unmatched.get(key);
    if (hit) hit.plays++;
    else unmatched.set(key, { name, plays: 1 });
  }

  return {
    matched: [...matched.values()].sort(
      (a, b) => b.plays - a.plays || (b.lastWatched ?? 0) - (a.lastWatched ?? 0) || (a.entry.title < b.entry.title ? -1 : a.entry.title > b.entry.title ? 1 : a.entry.id < b.entry.id ? -1 : 1),
    ),
    unmatched: [...unmatched.values()].sort((a, b) => b.plays - a.plays || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)),
  };
}
