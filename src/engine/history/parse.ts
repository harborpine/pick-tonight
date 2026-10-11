/**
 * READING A WATCH-HISTORY FILE (or a pasted list). Text in, rows out; never throws.
 *
 * What it understands, tried in this order:
 *
 *  1. JSON — an array of objects with a title-like field (or an object that
 *     holds such an array somewhere inside), or one JSON object per line.
 *     Data-request exports from several services arrive as JSON.
 *  2. Netflix's per-profile "Viewing activity > Download all" CSV: header
 *     `Title,Date`.                                              -> 'netflix'
 *     Netflix's full account data request (ViewingActivity.csv, columns
 *     Profile Name, Start Time, Duration, Attributes, Title, Supplemental Video
 *     Type, ...) is also read as 'netflix': trailers / previews (rows with a
 *     Supplemental Video Type) are skipped. NOTE: that file covers every
 *     profile on the account and this reader cannot know whose rows to keep —
 *     the per-profile download is the one to use.
 *  3. Any other CSV / TSV / semicolon file whose header row has a title-like
 *     column (title, name, show, series, program...) and optionally a date
 *     column. A "series/show" column beats a plain "title" column, and an
 *     "episode title" column is never taken for the show.       -> 'csv'
 *  4. A table with no header where one column is clearly dates.  -> 'csv'
 *  5. Plain text, one title per line.                            -> 'list'
 *
 * Anything else (empty, binary, HTML, a zip...) gives { format: 'unknown', rows: [] }.
 *
 * VERIFIED LAYOUTS: only Netflix's two files were verified against real
 * exports and published descriptions. Hulu, Disney+, Max, Prime Video, Peacock
 * and Paramount+ hand out data-request files whose layouts could not be
 * verified, so nothing here is written for them specifically; they are read by
 * the generic CSV / JSON readers when they carry a recognisable title column.
 *
 * DATES. Understood: 2026-10-02 (optionally with a time), 10/2/26, 10/2/2026,
 * 02.10.2026, "Oct 2, 2026", "2 October 2026", and numeric timestamps in JSON.
 * The ambiguity rule for a/b/year: if either number is over 12 the answer is
 * forced. Otherwise the WHOLE FILE is looked at: if some date in it can only
 * be day-first (e.g. 25/12/2026) and none can only be month-first, every
 * ambiguous date in the file is read day-first; in every other case it is
 * month-first, which is what Netflix's US export uses. Two-digit years 00-69
 * are 2000-2069. A date is stored as noon UTC of that calendar day (the time of
 * day in the file is ignored), so it shows as the same day in any US timezone.
 *
 * `raw` is the title text as it appeared. One exception: when a table has a
 * separate series column AND a season / episode column, raw is rebuilt in
 * Netflix's shape ("Show: Season 2: Episode name") so the matcher can tell the
 * row was an episode.
 */
import type { HistoryRow, ParsedHistory } from '../../contracts';

const NOTHING: ParsedHistory = { format: 'unknown', rows: [] };
const MAX_TITLE_LENGTH = 300;
const MAX_ROWS = 200_000;

export function parseWatchHistory(text: string, filename?: string): ParsedHistory {
  try {
    return parse(text, filename);
  } catch {
    return { format: 'unknown', rows: [] };
  }
}

function parse(input: unknown, filename?: string): ParsedHistory {
  if (typeof input !== 'string') return NOTHING;
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (!text.trim()) return NOTHING;
  if (looksBinary(text)) return NOTHING;
  text = text.replace(/\r\n?/g, '\n');
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) return NOTHING;
  const ext = (filename ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

  // ---- 1. JSON ----
  const first = text.trimStart()[0];
  if (first === '[' || first === '{' || ext === 'json') {
    const rows = fromJson(text);
    if (rows) return rows.length ? { format: 'json', rows } : NOTHING;
  }

  // ---- 2-4. tables ----
  const table = fromTable(text, ext);
  if (table) return table;

  // ---- 5. one title per line ----
  const rows: HistoryRow[] = [];
  for (const line of text.split('\n')) {
    const t = cleanListLine(line);
    if (t) rows.push({ raw: t });
    if (rows.length >= MAX_ROWS) break;
  }
  return rows.length ? { format: 'list', rows } : NOTHING;
}

function looksBinary(text: string): boolean {
  if (text.startsWith('PK\u0003\u0004') || text.startsWith('%PDF')) return true;
  const sample = text.slice(0, 4000);
  let odd = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) odd++;
  }
  return odd > Math.max(2, sample.length * 0.02);
}

function cleanListLine(line: string): string {
  let t = line.trim();
  if (!t) return '';
  t = t.replace(/^(?:[-*•–—·]+\s+|\d{1,4}[.)]\s+|\[[ xX]?\]\s+)/, '').trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”')))) t = t.slice(1, -1).trim();
  t = t.replace(/[,;]+$/, '').trim();
  return t && t.length <= MAX_TITLE_LENGTH ? t : '';
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** "seriesTitle", "Series_Title", " Series Title " -> "series title". */
function headerKey(h: unknown): string {
  return String(h ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type Role = 'show' | 'title' | 'episode' | 'season' | 'date' | 'supplemental' | 'other';

const QUALIFIER = '(?:tv|video|content|asset|item|media|movie|film|program|programme|series|show|main|parent|full|display|original)';
const SHOW_RE = new RegExp(`^(?:${QUALIFIER} )*(?:series|show|program|programme|franchise)(?: (?:title|name))?$`);
const TITLE_RE = new RegExp(`^(?:${QUALIFIER} )*(?:title|name|movie|film)$`);
/** Things called "name" that are not what was watched. */
const NOT_A_TITLE = /\b(?:profile|user|account|device|file|country|customer|first name|last name|plan|subscription|payment|card|billing|email|genre|category|network|channel|studio|provider|service|language|region|city|state)\b/;
const DATE_RE = /\b(?:date|time|timestamp|watched|viewed|played|started|start|when|day)\b/;
const NOT_A_DATE = /\b(?:duration|runtime|length|bookmark|zone|elapsed|remaining|position|progress|title|name)\b/;

function roleOf(key: string): Role {
  if (!key) return 'other';
  if (/\bsupplemental\b/.test(key)) return 'supplemental';
  if (/\bepisode\b/.test(key)) return 'episode';
  if (/^season(?: (?:number|num|no|title|name))?$/.test(key)) return 'season';
  if (DATE_RE.test(key) && !NOT_A_DATE.test(key)) return 'date';
  if (NOT_A_TITLE.test(key)) return 'other';
  if (SHOW_RE.test(key)) return 'show';
  if (TITLE_RE.test(key)) return 'title';
  return 'other';
}

/**
 * The row's title text. When the file keeps the show apart from the season /
 * episode, the pieces are joined in Netflix's shape ("Show: Season 2: Episode")
 * so the matcher can tell the row was an episode of a series.
 */
function composeRaw(show: string, title: string, season: string, episode: string): string {
  const name = show || title;
  if (!name) return '';
  // The title column already holds the whole "Show: Season 1: Episode" text.
  if (show && title.length > show.length && title.toLowerCase().startsWith(show.toLowerCase())) return title;
  const ep = episode || (show && title && title !== show ? title : '');
  if (!season && !ep) return name;
  const s = season ? (/^\d+$/.test(season) ? `Season ${season}` : season) : '';
  return [name, s, ep].filter(Boolean).join(': ');
}

// ---------------------------------------------------------------------------
// Tables (CSV / TSV / ...)
// ---------------------------------------------------------------------------

/** RFC-4180-style reader: quoted fields may hold the delimiter, doubled quotes and newlines. */
export function readDelimited(text: string, delimiter: string, maxRows = Number.POSITIVE_INFINITY): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(wasQuoted ? field : field.trim());
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
      wasQuoted = true;
    } else if (ch === delimiter) endField();
    else if (ch === '\n') {
      endRow();
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  if (field !== '' || row.length || wasQuoted) endRow();
  return rows;
}

const DELIMITERS = [',', '\t', ';', '|'];

function fromTable(text: string, ext: string): ParsedHistory | null {
  const order = ext === 'tsv' || ext === 'tab' ? ['\t', ',', ';', '|'] : DELIMITERS;

  // A header row with a title-like column, under whichever delimiter gives one.
  let best: { delimiter: string; roles: Role[]; keys: string[]; width: number } | null = null;
  for (const delimiter of order) {
    const header = readDelimited(text, delimiter, 1)[0];
    if (!header || header.length > 200) continue;
    const keys = header.map(headerKey);
    if (keys.some((k) => k.length > 40)) continue;
    const roles = keys.map(roleOf);
    if (!roles.includes('title') && !roles.includes('show')) continue;
    if (header.length === 1 && delimiter !== order[0]) continue;
    if (!best || header.length > best.width) best = { delimiter, roles, keys, width: header.length };
  }
  if (best) {
    const all = readDelimited(text, best.delimiter, MAX_ROWS + 1);
    const netflixSimple = best.keys.length === 2 && best.keys[0] === 'title' && best.keys[1] === 'date';
    const netflixFull = best.keys.includes('title') && best.keys.includes('supplemental video type') && best.keys.includes('start time');
    const rows = rowsFromTable(all.slice(1), best.roles, best.keys);
    return { format: netflixSimple || netflixFull ? 'netflix' : 'csv', rows };
  }

  // No header: accept a table only when one column is plainly dates.
  for (const delimiter of order) {
    if (!text.includes(delimiter)) continue;
    const all = readDelimited(text, delimiter, MAX_ROWS);
    if (all.length < 2) continue;
    const width = all[0].length;
    if (width < 2 || width > 12) continue;
    const sample = all.slice(0, 200);
    if (sample.filter((r) => r.length === width).length < sample.length * 0.9) continue;
    let dateCol = -1;
    for (let c = 0; c < width; c++) {
      if (sample.every((r) => !r[c] || looksLikeDate(r[c])) && sample.filter((r) => r[c]).length >= sample.length * 0.8) {
        dateCol = c;
        break;
      }
    }
    if (dateCol < 0) continue;
    // The title is the first other column that is mostly text.
    let titleCol = -1;
    for (let c = 0; c < width; c++) {
      if (c === dateCol) continue;
      if (sample.filter((r) => /\p{L}/u.test(r[c] ?? '')).length >= sample.length * 0.8) {
        titleCol = c;
        break;
      }
    }
    if (titleCol < 0) continue;
    const roles: Role[] = all[0].map((_, c) => (c === dateCol ? 'date' : c === titleCol ? 'title' : 'other'));
    return { format: 'csv', rows: rowsFromTable(all, roles, roles) };
  }
  return null;
}

function rowsFromTable(data: string[][], roles: Role[], keys: string[]): HistoryRow[] {
  const cols = (role: Role) => roles.flatMap((r, c) => (r === role ? [c] : []));
  const showCols = cols('show');
  // Prefer a column called exactly "title" / "name" over longer variants.
  const titleCols = cols('title').sort((a, b) => keys[a].length - keys[b].length);
  const episodeCols = cols('episode').filter((c) => !/\b(?:number|num|no|id|count)\b/.test(keys[c]));
  const seasonCols = cols('season');
  const supplemental = cols('supplemental');
  const dateCols = pickDateColumns(data, cols('date'));
  const firstOf = (row: string[], list: number[]) => {
    for (const c of list) {
      const v = (row[c] ?? '').trim();
      if (v) return v;
    }
    return '';
  };

  const drafts: { raw: string; date: string }[] = [];
  for (const row of data) {
    if (supplemental.some((c) => (row[c] ?? '').trim())) continue; // a trailer / preview, not a viewing
    const raw = composeRaw(firstOf(row, showCols), firstOf(row, titleCols), firstOf(row, seasonCols), firstOf(row, episodeCols));
    if (!raw || raw.length > MAX_TITLE_LENGTH) continue;
    drafts.push({ raw, date: firstOf(row, dateCols) });
  }
  const dayFirst = fileIsDayFirst(drafts.map((d) => d.date));
  return drafts.map((d): HistoryRow => {
    const at = d.date ? parseDate(d.date, dayFirst) : undefined;
    return at === undefined ? { raw: d.raw } : { raw: d.raw, at };
  });
}

/** Of the columns whose header sounds like a date, keep those whose values really are dates. */
function pickDateColumns(data: string[][], candidates: number[]): number[] {
  const sample = data.slice(0, 50);
  return candidates.filter((c) => {
    const filled = sample.map((r) => (r[c] ?? '').trim()).filter(Boolean);
    return filled.length > 0 && filled.filter(looksLikeDate).length >= filled.length * 0.7;
  });
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** Rows from JSON text, or null when the text is not JSON at all. */
function fromJson(text: string): HistoryRow[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // One JSON object per line?
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 1 || !lines.every((l) => l.startsWith('{'))) return null;
    const objs: unknown[] = [];
    for (const l of lines) {
      try {
        objs.push(JSON.parse(l.replace(/,$/, '')));
      } catch {
        return null;
      }
    }
    data = objs;
  }
  const list = findRecords(data, 0);
  if (!list) return [];
  const drafts: { raw: string; date: unknown }[] = [];
  for (const rec of list) {
    if (typeof rec === 'string') {
      const t = rec.trim();
      if (t && t.length <= MAX_TITLE_LENGTH) drafts.push({ raw: t, date: undefined });
      continue;
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const d = recordToRow(rec as Record<string, unknown>);
    if (d) drafts.push(d);
    if (drafts.length >= MAX_ROWS) break;
  }
  const dayFirst = fileIsDayFirst(drafts.map((d) => (typeof d.date === 'string' ? d.date : '')));
  return drafts.map((d): HistoryRow => {
    const at = typeof d.date === 'number' ? fromEpoch(d.date) : typeof d.date === 'string' && d.date ? parseDate(d.date, dayFirst) : undefined;
    return at === undefined ? { raw: d.raw } : { raw: d.raw, at };
  });
}

function titleOfValue(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  // { title: { name: "..." } } style nesting, one level.
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const role = roleOf(headerKey(k));
      if ((role === 'title' || role === 'show') && typeof o[k] === 'string') return (o[k] as string).trim();
    }
  }
  return '';
}

function recordToRow(rec: Record<string, unknown>): { raw: string; date: unknown } | null {
  let show = '';
  let title = '';
  let titleLen = Number.POSITIVE_INFINITY;
  let episode = '';
  let season = '';
  let date: unknown;
  for (const k of Object.keys(rec)) {
    const key = headerKey(k);
    const role = roleOf(key);
    const v = rec[k];
    if (role === 'supplemental' && typeof v === 'string' && v.trim()) return null;
    if (role === 'show' && !show) show = titleOfValue(v);
    else if (role === 'title') {
      const t = titleOfValue(v);
      if (t && key.length < titleLen) {
        title = t;
        titleLen = key.length;
      }
    } else if (role === 'episode' && !episode && typeof v === 'string' && !/\b(?:number|num|no|id|count)\b/.test(key)) episode = v.trim();
    else if (role === 'season' && !season && (typeof v === 'string' || typeof v === 'number')) season = String(v).trim();
    else if (role === 'date' && date === undefined) {
      if (typeof v === 'number' && fromEpoch(v) !== undefined) date = v;
      else if (typeof v === 'string' && looksLikeDate(v.trim())) date = v.trim();
    }
  }
  const raw = composeRaw(show, title, season, episode);
  if (!raw || raw.length > MAX_TITLE_LENGTH) return null;
  return { raw, date };
}

/** The array of viewing records inside a JSON document: the biggest array whose objects carry a title. */
function findRecords(data: unknown, depth: number): unknown[] | null {
  if (depth > 4 || data === null || typeof data !== 'object') return null;
  if (Array.isArray(data)) {
    const sample = data.slice(0, 20);
    const titled = sample.filter((x) => typeof x === 'string' || (x && typeof x === 'object' && !Array.isArray(x) && hasTitleField(x as Record<string, unknown>)));
    if (sample.length && titled.length >= sample.length * 0.5) return data;
    let best: unknown[] | null = null;
    for (const x of sample) {
      const inner = findRecords(x, depth + 1);
      if (inner && (!best || inner.length > best.length)) best = inner;
    }
    return best;
  }
  let best: unknown[] | null = null;
  for (const v of Object.values(data as Record<string, unknown>)) {
    const inner = findRecords(v, depth + 1);
    if (inner && (!best || inner.length > best.length)) best = inner;
  }
  return best;
}

function hasTitleField(o: Record<string, unknown>): boolean {
  return Object.keys(o).some((k) => {
    const role = roleOf(headerKey(k));
    return (role === 'title' || role === 'show') && titleOfValue(o[k]) !== '';
  });
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const NUMERIC_DATE = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})(?:[\sT,]|$)/;
const MONTH_FIRST_WORDS = /^(?:[a-z]{3,9}\.?,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i;
const DAY_FIRST_WORDS = /^(?:[a-z]{3,9}\.?,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/i;

function noonUtc(y: number, m: number, d: number): number | undefined {
  if (!(y >= 1900 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return undefined;
  const t = Date.UTC(y, m - 1, d, 12);
  // Reject 31 February and friends (Date.UTC would roll them over).
  return new Date(t).getUTCDate() === d ? t : undefined;
}

const fullYear = (y: number, digits: number) => (digits <= 2 ? (y <= 69 ? 2000 + y : 1900 + y) : y);

function fromEpoch(n: number): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  const ms = n > 1e11 ? n : n > 1e8 ? n * 1000 : NaN; // milliseconds, or seconds
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  return noonUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 'd' = can only be day-first, 'm' = can only be month-first, '' = can't tell / not that kind of date. */
function numericOrder(s: string): 'd' | 'm' | '' {
  const m = NUMERIC_DATE.exec(s.trim());
  if (!m || m[1].length > 2) return '';
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 12 && b <= 12) return 'd';
  if (b > 12 && a <= 12) return 'm';
  return '';
}

function fileIsDayFirst(dates: string[]): boolean {
  let d = 0;
  let m = 0;
  for (const s of dates) {
    if (!s) continue;
    const o = numericOrder(s);
    if (o === 'd') d++;
    else if (o === 'm') m++;
  }
  return d > 0 && m === 0;
}

export function parseDate(text: string, dayFirst = false): number | undefined {
  const s = text.trim();
  if (!s) return undefined;
  let m = NUMERIC_DATE.exec(s);
  if (m) {
    if (m[1].length === 4) return noonUtc(Number(m[1]), Number(m[2]), Number(m[3])); // 2026-10-02
    if (m[1].length > 2) return undefined;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]), m[3].length);
    if (m[3].length === 3) return undefined;
    const order = numericOrder(s);
    return order === 'd' || (order === '' && dayFirst) ? noonUtc(y, b, a) : noonUtc(y, a, b);
  }
  m = MONTH_FIRST_WORDS.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return noonUtc(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  m = DAY_FIRST_WORDS.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return noonUtc(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  if (/^\d{10}$|^\d{13}$/.test(s)) return fromEpoch(Number(s));
  return undefined;
}

const looksLikeDate = (s: string): boolean => parseDate(s) !== undefined;
