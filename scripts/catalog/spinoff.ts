/**
 * "This show is a spinoff / prequel / revival / continuation of that show" links, TV only.
 * PRECISION FIRST: a wrong link makes a silly suggestion, a missed one costs nothing.
 * Signals (any one is enough, results merged):
 *   (c) a curated table of famous cases,
 *   (b) "X: Subtitle" where X is exactly another, older, well-known and unambiguous TV title,
 *   (a) a spinoff-style TMDB keyword PLUS a parent in TMDB's recommendations whose title is contained
 *       in this one's (or vice versa), e.g. "Fear the Walking Dead" / "The Walking Dead".
 * Whole universes (Marvel, Star Wars, Star Trek ...) are never linked to each other.
 */
import type { TitleIndexEntry } from '../../src/contracts/catalog';

export interface KnownTv {
  id: string;
  title: string;
  year: number;
  popularity: number;
}

export interface SpinoffChild {
  id: string;
  title: string;
  year: number;
  /** TMDB keywords, lower-cased. */
  keywords: string[];
  /** Ids TMDB recommends alongside it. */
  related: string[];
}

export function normTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function knownFromIndex(entries: TitleIndexEntry[]): KnownTv[] {
  return entries.filter((e) => e.kind === 'tv').map((e) => ({ id: e.id, title: e.title, year: e.year, popularity: e.popularity }));
}

export class KnownTitles {
  private byNorm = new Map<string, KnownTv[]>();
  private byId = new Map<string, KnownTv>();
  constructor(list: KnownTv[]) {
    for (const k of list) {
      const n = normTitle(k.title);
      if (!n) continue;
      const cur = this.byNorm.get(n);
      if (cur) cur.push(k);
      else this.byNorm.set(n, [k]);
      this.byId.set(k.id, k);
    }
    for (const arr of this.byNorm.values()) arr.sort((a, b) => b.popularity - a.popularity);
  }
  get(id: string): KnownTv | undefined {
    return this.byId.get(id);
  }
  /** Exact-name matches, most popular first, optionally limited to one first-air year. */
  find(title: string, year?: number): KnownTv[] {
    const arr = this.byNorm.get(normTitle(title)) ?? [];
    return year ? arr.filter((k) => k.year === year) : arr;
  }
}

// ---------------------------------------------------------------------------
// (c) curated
// ---------------------------------------------------------------------------

type Ref = [title: string, year?: number];
/** [child, parents]. A year is needed whenever several shows share a name. */
export const CURATED: [Ref, Ref[]][] = [
  // Westeros
  [['House of the Dragon', 2022], [['Game of Thrones', 2011]]],
  [['A Knight of the Seven Kingdoms'], [['Game of Thrones', 2011]]],
  // Grey's universe
  [['Station 19', 2018], [["Grey's Anatomy", 2005]]],
  [['Private Practice', 2007], [["Grey's Anatomy", 2005]]],
  // sitcoms
  [['How I Met Your Father', 2022], [['How I Met Your Mother', 2005]]],
  [['The Cleveland Show', 2009], [['Family Guy', 1999]]],
  [['Joey', 2004], [['Friends', 1994]]],
  [['Better Call Saul', 2015], [['Breaking Bad', 2008]]],
  [['Young Sheldon', 2017], [['The Big Bang Theory', 2007]]],
  [["Georgie & Mandy's First Marriage", 2024], [['Young Sheldon', 2017], ['The Big Bang Theory', 2007]]],
  [['Frasier', 1993], [['Cheers', 1982]]],
  [['Frasier', 2023], [['Frasier', 1993]]],
  [['Fuller House', 2016], [['Full House', 1987]]],
  [['Girl Meets World', 2014], [['Boy Meets World', 1993]]],
  [["That '90s Show", 2023], [["That '70s Show", 1998]]],
  [['The Conners', 2018], [['Roseanne', 1988]]],
  [['Grown-ish', 2018], [['Black-ish', 2014]]],
  [['Mixed-ish', 2019], [['Black-ish', 2014]]],
  [['Saved by the Bell', 2020], [['Saved by the Bell', 1989]]],
  [['Angel', 1999], [['Buffy the Vampire Slayer', 1997]]],
  [['Daria', 1997], [['Beavis and Butt-Head', 1993]]],
  [['The Good Fight', 2017], [['The Good Wife', 2009]]],
  [['Elsbeth', 2024], [['The Good Wife', 2009]]],
  // reality
  [['Love Island Games', 2023], [['Love Island', 2019], ['Love Island', 2015]]],
  [['Love Island', 2019], [['Love Island', 2015]]],
  [['Love Island Australia', 2018], [['Love Island', 2015]]],
  [['Winter House', 2021], [['Summer House', 2017]]],
  [["Summer House: Martha's Vineyard", 2022], [['Summer House', 2017]]],
  [['The Celebrity Traitors', 2025], [['The Traitors', 2022]]],
  [['Squid Game: The Challenge', 2023], [['Squid Game', 2021]]],
  [['Vanderpump Rules', 2013], [['The Real Housewives of Beverly Hills', 2010]]],
  // remakes that continue an older show
  [['Gossip Girl', 2021], [['Gossip Girl', 2007]]],
  // procedurals
  [['NCIS', 2003], [['JAG', 1995]]],
  [['Chicago P.D.', 2014], [['Chicago Fire', 2012]]],
  [['Chicago Med', 2015], [['Chicago Fire', 2012]]],
  [['Chicago Justice', 2017], [['Chicago P.D.', 2014]]],
  [['CSI: Miami', 2002], [['CSI: Crime Scene Investigation', 2000]]],
  [['CSI: NY', 2004], [['CSI: Crime Scene Investigation', 2000]]],
  [['CSI: Vegas', 2021], [['CSI: Crime Scene Investigation', 2000]]],
  [['Fear the Walking Dead', 2015], [['The Walking Dead', 2010]]],
  [['Power Book II: Ghost', 2020], [['Power', 2014]]],
  [['Power Book III: Raising Kanan', 2021], [['Power', 2014]]],
  [['Power Book IV: Force', 2022], [['Power', 2014]]],
  [['90210', 2008], [['Beverly Hills, 90210', 1990]]],
];

export function curatedLinks(children: SpinoffChild[], known: KnownTitles): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [[ct, cy], parents] of CURATED) {
    const n = normTitle(ct);
    const kids = children.filter((c) => normTitle(c.title) === n && (!cy || c.year === cy));
    if (!kids.length) continue;
    const ids: string[] = [];
    for (const [pt, py] of parents) {
      const hit = known.find(pt, py)[0];
      if (hit) ids.push(hit.id);
    }
    for (const kid of kids) {
      const mine = ids.filter((id) => id !== kid.id);
      if (mine.length) out.set(kid.id, mine);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// (b) "X: Subtitle"
// ---------------------------------------------------------------------------

/** Umbrella names that head many unrelated shows. */
const UMBRELLAS = new Set([
  'star trek', 'star wars', 'marvel', 'marvels', 'dc', 'disney', 'nickelodeon', 'lego', 'the real housewives', 'real housewives',
  'american horror', 'masters of horror', 'netflix', 'hbo', 'amazon', 'bbc', 'tales', 'doctor', 'inside', 'my', 'love', 'life', 'the', 'a',
]);
const SUBTITLE_NOT_A_SPINOFF = /^(season|series|part|volume|vol|book|chapter|episode|the complete|the movie|the series|the musical|the special)\b|^\d+$/i;

const MIN_PARENT_POPULARITY = 10;

function unambiguous(cands: KnownTv[]): KnownTv | null {
  if (!cands.length) return null;
  const top = cands[0];
  if (top.popularity < MIN_PARENT_POPULARITY) return null;
  const rival = cands.find((c) => c.id !== top.id && c.popularity >= Math.max(MIN_PARENT_POPULARITY, top.popularity * 0.3));
  return rival ? null : top;
}

export function subtitleParent(child: SpinoffChild, known: KnownTitles): string | null {
  const m = /^(.{4,}?)\s*:\s+(.+)$/.exec(child.title.trim());
  if (!m) return null;
  const [, head, sub] = m;
  const nh = normTitle(head);
  if (!nh || UMBRELLAS.has(nh) || SUBTITLE_NOT_A_SPINOFF.test(sub.trim())) return null;
  const parent = unambiguous(known.find(head).filter((k) => k.id !== child.id && k.year <= child.year));
  return parent ? parent.id : null;
}

// ---------------------------------------------------------------------------
// (a) keyword + recommended parent with shared franchise words
// ---------------------------------------------------------------------------

export const SPIN_KEYWORDS = ['spin off', 'spinoff', 'spin-off', 'prequel', 'sequel', 'sequel series', 'revival', 'continuation', 'tv spin off'];
const GENERIC_ONE_WORDERS = new Set(['the', 'show', 'life', 'love', 'house', 'home', 'family', 'new', 'girls', 'boys', 'men', 'women', 'game', 'games', 'world', 'city', 'dark', 'good', 'fall', 'you', 'us', 'we', 'one', 'time', 'kings', 'queens']);

function tokens(t: string): string[] {
  return normTitle(t).split(' ').filter(Boolean);
}
function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true;
  return false;
}

/** One title's words appear as a whole run inside the other's, and the shared run is distinctive enough. */
export function shareFranchiseWords(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.join(' ').length < 4) return false;
  if (short.length === 1 && GENERIC_ONE_WORDERS.has(short[0])) return false;
  if (UMBRELLAS.has(short.join(' '))) return false;
  return containsRun(long, short);
}

export function keywordParents(child: SpinoffChild, known: KnownTitles): string[] {
  if (!child.keywords.some((k) => SPIN_KEYWORDS.includes(k))) return [];
  const out: string[] = [];
  for (const rid of child.related) {
    if (!rid.startsWith('tv-') || rid === child.id) continue;
    const k = known.get(rid);
    if (!k || k.year > child.year || normTitle(k.title) === normTitle(child.title)) continue;
    if (k.popularity < MIN_PARENT_POPULARITY) continue;
    if (shareFranchiseWords(k.title, child.title)) out.push(rid);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface SpinoffLink {
  childId: string;
  parentIds: string[];
  via: string;
}

/** Computes links for the given TV children. `known` should hold every well-known TV title we have. */
export function findSpinoffs(children: SpinoffChild[], known: KnownTitles, maxParents = 3): SpinoffLink[] {
  const curated = curatedLinks(children, known);
  const links: SpinoffLink[] = [];
  for (const c of children) {
    const parents: string[] = [];
    const via: string[] = [];
    const add = (ids: string[], why: string) => {
      let used = false;
      for (const id of ids) if (id !== c.id && !parents.includes(id)) (parents.push(id), (used = true));
      if (used) via.push(why);
    };
    add(curated.get(c.id) ?? [], 'curated');
    const sub = subtitleParent(c, known);
    if (sub) add([sub], 'subtitle');
    add(keywordParents(c, known), 'keyword');
    if (parents.length) links.push({ childId: c.id, parentIds: parents.slice(0, maxParents), via: via.join('+') });
  }
  return links;
}
