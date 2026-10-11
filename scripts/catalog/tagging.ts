/**
 * Rule-based tagging: genres, attention, moods, dropIn, flags, runtime.
 * Pure functions only (no network) so they are unit-tested.
 */
import type { Attention, GenreId, MoodId, TitleKind } from '../../src/contracts/catalog';
import { MOODS } from '../../src/contracts/catalog';
import { median, round2 } from './util';
import { findOverride, type Override } from './overrides';

// ---------------------------------------------------------------------------
// Genres
// ---------------------------------------------------------------------------

/** TMDB movie + TV genre ids folded into our slugs. Dropped: TV Movie (10770), News (10763). */
const GENRE_MAP: Record<number, GenreId[]> = {
  28: ['action'],
  12: ['adventure'],
  16: ['animation'],
  35: ['comedy'],
  80: ['crime'],
  99: ['documentary'],
  18: ['drama'],
  10751: ['family'],
  14: ['fantasy'],
  36: ['history'],
  27: ['horror'],
  10402: ['music'],
  9648: ['mystery'],
  10749: ['romance'],
  878: ['scifi'],
  10770: [],
  53: ['thriller'],
  10752: ['war'],
  37: ['western'],
  10759: ['action', 'adventure'], // Action & Adventure
  10762: ['kids'],
  10763: [], // News
  10764: ['reality'],
  10765: ['scifi', 'fantasy'], // Sci-Fi & Fantasy
  10766: ['soap'],
  10767: ['talk'],
  10768: ['war'], // War & Politics
};

export function mapGenres(ids: number[]): GenreId[] {
  const out: GenreId[] = [];
  for (const id of ids) for (const g of GENRE_MAP[id] ?? []) if (!out.includes(g)) out.push(g);
  return out;
}

// ---------------------------------------------------------------------------
// Keyword matching
// ---------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map<string, RegExp>();
function termsRe(terms: readonly string[]): RegExp {
  const key = terms.join('|');
  let re = reCache.get(key);
  if (!re) {
    re = new RegExp(`(?:^|[^a-z0-9])(?:${terms.map(escapeRe).join('|')})(?:s|es)?(?![a-z0-9])`, 'i');
    reCache.set(key, re);
  }
  return re;
}
/** How many of the title's keywords match any of the terms (whole-word, plural tolerant). */
export function countKw(keywords: readonly string[], terms: readonly string[]): number {
  const re = termsRe(terms);
  let n = 0;
  for (const k of keywords) if (re.test(k)) n++;
  return n;
}
const hasKw = (k: readonly string[], terms: readonly string[]) => countKw(k, terms) > 0;

// ---------------------------------------------------------------------------
// Keyword vocabularies
// ---------------------------------------------------------------------------

/** Plot-heavy: needs your eyes on the screen. */
const COMPLEX_KW = [
  'complex plot', 'time travel', 'time loop', 'political intrigue', 'court intrigue', 'intrigue', 'nonlinear timeline',
  'non-linear timeline', 'nonlinear', 'conspiracy', 'mind-bending', 'mind bending', 'multiple timelines', 'dual timeline',
  'parallel universe', 'alternate timeline', 'alternate reality', 'power struggle', 'political drama', 'unreliable narrator',
  'psychological thriller', 'subtitled', 'philosophy', 'espionage', 'cold war', 'surrealism', 'dream within a dream',
];
const SITCOM_KW = ['sitcom', 'workplace comedy', 'hangout comedy', 'mockumentary', 'sketch comedy', 'stand-up comedy', 'adult animation', 'cringe comedy', 'family sitcom'];
const PROCEDURAL_KW = ['procedural', 'police procedural', 'case of the week', 'episodic', 'monster of the week', 'anthology', 'talk show', 'late night', 'sketch comedy', 'news magazine'];
const COMPETITION_KW = ['competition', 'strategy', 'elimination', 'social game', 'deception', 'survival', 'puzzle', 'game'];
const EASY_REALITY_KW = ['baking', 'cooking', 'cooking competition', 'food', 'chef', 'dating show', 'dating', 'docusoap', 'makeover', 'home renovation', 'house hunting', 'home improvement', 'fashion', 'lifestyle', 'talent show', 'singing competition', 'family'];
const NATURE_KW = ['nature', 'wildlife', 'animals', 'travel', 'cooking', 'food'];

const HORROR_KW = [
  'horror', 'slasher', 'gore', 'splatter', 'body horror', 'psychological horror', 'supernatural horror', 'haunted house',
  'demonic possession', 'zombie', 'creature feature', 'found footage', 'ghost story',
  'folk horror', 'cosmic horror', 'survival horror', 'satanic',
];
const SCARY_KW = [
  'monster', 'serial killer', 'haunted', 'ghost', 'demon', 'vampire', 'werewolf', 'undead', 'creepy', 'disturbing',
  'torture', 'paranormal', 'evil spirit', 'home invasion', 'psychopath', 'gruesome', 'macabre', 'exorcism', 'possession',
  'occult', 'cannibal', 'stalker',
];
const TRUE_CRIME_KW = ['true crime', 'true-crime', 'unsolved murder', 'serial killer documentary', 'crime documentary'];
const TRUE_CRIME_NAME = /^(dateline|48 hours|20\/20|forensic files|snapped|cold case files|unsolved mysteries|american greed|the first 48|i \(almost\) got away with it|making a murderer|the jinx|the staircase|how to catch a killer|crime scene|murder in the|killer couples|deadly women|true crime|evil lives here|a body in the)/i;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface TagInput {
  kind: TitleKind;
  tmdbId: number;
  title: string;
  year: number;
  genres: GenreId[];
  /** All lower-cased keywords (uncapped). */
  keywords: string[];
  originalLanguage: string;
  runtime: number;
  rating: number;
  votes: number;
  seasons?: number;
}

export interface Tags {
  attention: Attention;
  moods: Partial<Record<MoodId, number>>;
  dropIn: boolean;
  flags: { horror: boolean; trueCrime: boolean; scary: boolean };
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export function computeFlags(t: TagInput): Tags['flags'] {
  const g = new Set(t.genres);
  const horror = g.has('horror') || hasKw(t.keywords, HORROR_KW);
  // Comedies that merely mention ghosts / vampires / witches (What We Do in the Shadows, Ghosts) are not scary.
  const comedyOnly = g.has('comedy') && !g.has('horror');
  // Animation (anime, kids) only counts as scary through explicit horror keywords; "supernatural" needs a dark genre.
  const animated = g.has('animation') || g.has('kids') || g.has('family');
  const supernatural = hasKw(t.keywords, ['supernatural']) && (['drama', 'mystery', 'thriller', 'scifi'] as GenreId[]).some((x) => g.has(x)) && !animated && !g.has('romance') && !g.has('fantasy');
  let scary = horror || (!comedyOnly && !animated && (hasKw(t.keywords, SCARY_KW) || supernatural));
  if (comedyOnly && countKw(t.keywords, HORROR_KW) >= 2) scary = true;
  const doc = g.has('documentary');
  const trueCrime =
    hasKw(t.keywords, TRUE_CRIME_KW) ||
    (doc && g.has('crime')) ||
    (doc && hasKw(t.keywords, ['murder', 'serial killer', 'police investigation', 'wrongful conviction', 'trial', 'cold case'])) ||
    (g.has('crime') && hasKw(t.keywords, ['true story', 'based on true story', 'based on a true story']) && hasKw(t.keywords, ['murder', 'serial killer'])) ||
    TRUE_CRIME_NAME.test(t.title);
  return { horror, trueCrime, scary };
}

// ---------------------------------------------------------------------------
// dropIn (TV only)
// ---------------------------------------------------------------------------

export function computeDropIn(t: TagInput): boolean {
  if (t.kind !== 'tv') return false;
  const g = new Set(t.genres);
  const kw = t.keywords;
  if (hasKw(kw, ['anthology'])) return true;
  if (g.has('talk') || g.has('kids')) return true;
  if (g.has('reality')) {
    const competitive = hasKw(kw, COMPETITION_KW);
    const easy = hasKw(kw, ['baking', 'cooking', 'chef', 'food', 'home renovation', 'makeover', 'dating', 'docusoap', 'talent show']);
    return !competitive || easy;
  }
  if (hasKw(kw, PROCEDURAL_KW)) return true;
  if (g.has('animation') && g.has('comedy')) return true;
  if (g.has('comedy')) return hasKw(kw, SITCOM_KW) || !g.has('drama');
  if (g.has('documentary')) return hasKw(kw, NATURE_KW) || hasKw(kw, ['news magazine']);
  if (g.has('family') && g.has('animation')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

/**
 * Points toward "high": subtitled / non-English (3), each complexity keyword (2, max 4), serialized
 * genre drama (+1/+2), prestige dense TV (+1). 3+ points => high. Otherwise low if the title is
 * easy to follow while looking away, else medium.
 */
export function computeAttention(t: TagInput, dropIn: boolean): Attention {
  const g = new Set(t.genres);
  const kw = t.keywords;
  let points = 0;
  if (t.originalLanguage && t.originalLanguage !== 'en') points += 3;
  points += Math.min(4, countKw(kw, COMPLEX_KW) * 2);
  const heavyGenre = (['mystery', 'scifi', 'fantasy', 'thriller', 'war', 'history', 'crime'] as GenreId[]).some((x) => g.has(x));
  if (t.kind === 'tv') {
    if (!dropIn && g.has('drama') && heavyGenre) points += 2;
    else if (!dropIn && heavyGenre) points += 1;
    if (!dropIn && g.has('drama') && t.runtime >= 50 && t.rating >= 8.2 && t.votes >= 1500) points += 1;
  } else {
    if (g.has('mystery') || g.has('scifi') || g.has('war') || g.has('history')) points += 1;
    if (t.runtime >= 150) points += 1;
  }
  if (points >= 3) return 'high';

  const comedy = g.has('comedy');
  const darkOrHeavy = heavyGenre || g.has('drama');
  // Easy to follow while looking away.
  if (g.has('talk') || g.has('kids') || hasKw(kw, ['sketch comedy', 'baking', 'cooking competition'])) return 'low';
  if (g.has('reality')) {
    const strategic = hasKw(kw, COMPETITION_KW) && !hasKw(kw, EASY_REALITY_KW);
    return strategic ? 'medium' : 'low';
  }
  if (t.kind === 'tv') {
    if (dropIn && (comedy || g.has('animation') || g.has('family'))) return 'low';
    if (dropIn && g.has('documentary') && hasKw(kw, NATURE_KW)) return 'low';
    if (comedy && !g.has('drama') && !heavyGenre && points < 2) return 'low';
    if (g.has('animation') && (g.has('family') || comedy) && points < 2) return 'low';
    if (g.has('soap') && !heavyGenre) return 'medium';
  } else {
    if (g.has('animation') && (g.has('family') || comedy) && points < 2) return 'low';
    if (comedy && !darkOrHeavy && points < 2) return 'low';
    if (comedy && g.has('romance') && !heavyGenre && points < 2) return 'low';
    if (g.has('family') && !darkOrHeavy && points < 2) return 'low';
  }
  return 'medium';
}

// ---------------------------------------------------------------------------
// Moods
// ---------------------------------------------------------------------------
/**
 * Mood fit mapping (each value is 0..1, values under 0.2 are dropped):
 *  laugh    comedy .75 (+.1 animation, +.15 sitcom/satire/parody keywords); sketch/talk .5
 *  cozy     family/kids .6, comedy .3, romance .25, feel-good keywords (wholesome, small town, baking, christmas...) +.4,
 *           low attention +.15; dark genres (horror, crime, war, thriller) pull it down
 *  brainoff low attention .55, medium .15; reality .7, talk .6, comedy +.2, action +.25; high attention => 0; dark pulls down
 *  gripped  thriller .8, mystery .7, crime .6, horror .5, action .4, drama .3, scifi .3, competition reality .5;
 *           cliffhanger/twist/conspiracy keywords +.2; rating >= 7.8 +.1
 *  feelgood family .5, music .5, comedy .3, romance .3, animation .25; uplifting keywords (wholesome, inspiration,
 *           underdog, friendship, coming of age) +.35; dark genres pull it down
 *  think    documentary .8, history .6, scifi .35, mystery .3; keywords (social commentary, philosophy, dystopia, true story,
 *           biography, politics, science, nature) +.35; high attention +.15
 *  romantic romance .85; dating/wedding/love keywords +.25; dating reality .5
 *  scared   horror genre .95, scary flag .7, thriller .2; scary keywords +.3
 *  cry      drama .3, romance .2, war .3; tearjerker/grief/terminal illness/loss keywords +.5; family+animation .3
 *  hyped    action .85, adventure .4, war .3, scifi .3, thriller .2, western .3; superhero/chase/martial arts/battle keywords +.3
 */
export function computeMoods(t: TagInput, attention: Attention, flags: Tags['flags']): Partial<Record<MoodId, number>> {
  const g = new Set(t.genres);
  const kw = t.keywords;
  const m: Record<MoodId, number> = { laugh: 0, cozy: 0, brainoff: 0, gripped: 0, feelgood: 0, think: 0, romantic: 0, scared: 0, cry: 0, hyped: 0 };
  const dark = (['horror', 'crime', 'war', 'thriller'] as GenreId[]).filter((x) => g.has(x)).length;
  const darkPenalty = (g.has('horror') ? 0.5 : 0) + (g.has('war') ? 0.3 : 0) + (g.has('crime') ? 0.2 : 0) + (g.has('thriller') ? 0.2 : 0);

  // laugh
  if (g.has('comedy')) m.laugh += 0.75;
  if (g.has('comedy') && g.has('animation')) m.laugh += 0.1;
  if (hasKw(kw, ['sitcom', 'satire', 'parody', 'dark comedy', 'cringe comedy', 'stand-up comedy', 'sketch comedy', 'slapstick', 'spoof', 'mockumentary', 'workplace comedy'])) m.laugh += 0.15;
  if (g.has('talk') || hasKw(kw, ['sketch comedy'])) m.laugh = Math.max(m.laugh, 0.5);
  if (g.has('drama') && g.has('comedy')) m.laugh -= 0.1;

  // cozy
  if (g.has('family') || g.has('kids')) m.cozy += 0.6;
  if (g.has('comedy')) m.cozy += 0.3;
  if (g.has('romance')) m.cozy += 0.25;
  if (hasKw(kw, ['wholesome', 'small town', 'baking', 'cooking', 'christmas', 'holiday', 'friendship', 'heartwarming', 'comfort', 'feel-good', 'feel good', 'british', 'nature', 'cozy'])) m.cozy += 0.4;
  if (attention === 'low') m.cozy += 0.15;
  if (attention === 'high') m.cozy -= 0.2;
  m.cozy -= darkPenalty;

  // brainoff
  if (attention === 'low') m.brainoff += 0.55;
  else if (attention === 'medium') m.brainoff += 0.15;
  if (g.has('reality')) m.brainoff += 0.7;
  if (g.has('talk')) m.brainoff += 0.6;
  if (g.has('comedy')) m.brainoff += 0.2;
  if (g.has('action')) m.brainoff += 0.25;
  if (attention === 'high') m.brainoff = 0;
  m.brainoff -= darkPenalty * 0.8;

  // gripped
  if (g.has('thriller')) m.gripped += 0.8;
  else if (g.has('mystery')) m.gripped += 0.7;
  else if (g.has('crime')) m.gripped += 0.6;
  else if (g.has('horror')) m.gripped += 0.5;
  else if (g.has('action')) m.gripped += 0.4;
  else if (g.has('drama')) m.gripped += 0.3;
  else if (g.has('scifi')) m.gripped += 0.3;
  if (g.has('reality') && hasKw(kw, COMPETITION_KW)) m.gripped = Math.max(m.gripped, 0.5);
  if (hasKw(kw, ['cliffhanger', 'twist ending', 'plot twist', 'conspiracy', 'suspense', 'edge of your seat', 'whodunit', 'cat and mouse'])) m.gripped += 0.2;
  if (g.has('comedy') && !g.has('drama') && !g.has('thriller') && !g.has('mystery')) m.gripped -= 0.2;
  if (t.rating >= 7.8 && m.gripped > 0) m.gripped += 0.1;

  // feelgood
  if (g.has('family')) m.feelgood += 0.5;
  if (g.has('music')) m.feelgood += 0.5;
  if (g.has('comedy')) m.feelgood += 0.3;
  if (g.has('romance')) m.feelgood += 0.3;
  if (g.has('animation')) m.feelgood += 0.25;
  if (hasKw(kw, ['wholesome', 'inspiration', 'inspirational', 'underdog', 'friendship', 'coming of age', 'feel-good', 'feel good', 'heartwarming', 'uplifting', 'kindness', 'happy ending', 'sports'])) m.feelgood += 0.35;
  m.feelgood -= darkPenalty;

  // think
  if (g.has('documentary')) m.think += 0.8;
  if (g.has('history')) m.think += 0.6;
  if (g.has('scifi')) m.think += 0.35;
  if (g.has('mystery')) m.think += 0.3;
  if (hasKw(kw, ['social commentary', 'philosophy', 'dystopia', 'true story', 'based on true story', 'biography', 'biopic', 'politics', 'science', 'nature', 'psychology', 'ethics', 'technology', 'satire'])) m.think += 0.35;
  if (attention === 'high') m.think += 0.15;
  if (g.has('reality') || g.has('kids') || g.has('talk')) m.think = Math.min(m.think, 0.2);

  // romantic
  if (g.has('romance')) m.romantic += 0.85;
  if (hasKw(kw, ['romance', 'love', 'wedding', 'dating', 'love triangle', 'first love', 'rom-com', 'romantic comedy', 'relationship'])) m.romantic += 0.25;
  if (g.has('reality') && hasKw(kw, ['dating', 'dating show', 'romance', 'love'])) m.romantic = Math.max(m.romantic, 0.5);
  if (g.has('horror')) m.romantic -= 0.3;

  // scared
  if (g.has('horror')) m.scared += 0.95;
  else if (flags.horror) m.scared += 0.85;
  else if (flags.scary) m.scared += 0.7;
  if (g.has('thriller')) m.scared += 0.2;
  if (hasKw(kw, SCARY_KW) && (flags.scary || flags.horror)) m.scared += 0.3;
  if (!flags.scary && !flags.horror) m.scared = Math.min(m.scared, 0.3);

  // cry
  if (g.has('drama')) m.cry += 0.3;
  if (g.has('romance')) m.cry += 0.2;
  if (g.has('war')) m.cry += 0.3;
  if (g.has('family') && g.has('animation')) m.cry += 0.3;
  if (hasKw(kw, ['tearjerker', 'grief', 'terminal illness', 'death of a loved one', 'loss of loved one', 'loss', 'cancer', 'sad', 'bereavement', 'dying', 'heartbreak', 'tragedy'])) m.cry += 0.5;
  if (g.has('comedy') && !g.has('drama')) m.cry -= 0.2;
  if (g.has('reality') || g.has('talk') || g.has('kids')) m.cry = Math.min(m.cry, 0.1);

  // hyped
  if (g.has('action')) m.hyped += 0.85;
  if (g.has('adventure')) m.hyped += 0.4;
  if (g.has('war')) m.hyped += 0.3;
  if (g.has('scifi')) m.hyped += 0.3;
  if (g.has('western')) m.hyped += 0.3;
  if (g.has('thriller')) m.hyped += 0.2;
  if (hasKw(kw, ['superhero', 'car chase', 'martial arts', 'battle', 'heist', 'explosion', 'shootout', 'chase', 'fight', 'spy'])) m.hyped += 0.3;
  if (g.has('reality') && hasKw(kw, COMPETITION_KW)) m.hyped = Math.max(m.hyped, 0.4);
  if (dark > 3) m.cozy = 0;

  const out: Partial<Record<MoodId, number>> = {};
  for (const { id } of MOODS) {
    const v = Math.max(0, Math.min(1, m[id]));
    if (v >= 0.2) out[id] = round2(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export function defaultRuntime(kind: TitleKind, genres: GenreId[]): number {
  if (kind === 'movie') return 100;
  const g = new Set(genres);
  if (g.has('kids')) return 15;
  if (g.has('reality') || g.has('talk')) return 45;
  if (g.has('animation')) return 22;
  if (g.has('comedy') && !g.has('drama')) return 25;
  if (g.has('documentary')) return 45;
  return 42;
}

export function pickRuntime(kind: TitleKind, d: { runtime?: number | null; episode_run_time?: number[]; last?: number | null; next?: number | null }, genres: GenreId[]): number {
  if (kind === 'movie') return d.runtime && d.runtime > 0 ? Math.round(d.runtime) : defaultRuntime(kind, genres);
  const eps = (d.episode_run_time ?? []).filter((x) => x > 0);
  if (eps.length) return Math.round(median(eps));
  if (d.last && d.last > 0) return Math.round(d.last);
  if (d.next && d.next > 0) return Math.round(d.next);
  return defaultRuntime(kind, genres);
}

// ---------------------------------------------------------------------------
// Everything together (with curated overrides applied last)
// ---------------------------------------------------------------------------

export function tagTitle(t: TagInput, override: Override | undefined = findOverride(t.kind, t.title, t.year)): Tags {
  const dropIn0 = computeDropIn(t);
  const dropIn = t.kind === 'tv' ? (override?.dropIn ?? dropIn0) : false;
  const attention = override?.attention ?? computeAttention(t, dropIn);
  const flags0 = computeFlags(t);
  const flags = {
    horror: override?.flags?.horror ?? flags0.horror,
    trueCrime: override?.flags?.trueCrime ?? flags0.trueCrime,
    scary: override?.flags?.scary ?? flags0.scary,
  };
  if (flags.horror) flags.scary = override?.flags?.scary ?? true;
  const moods = computeMoods(t, attention, flags);
  for (const [k, v] of Object.entries(override?.moods ?? {})) {
    if (v === undefined) continue;
    if (v < 0.2) delete moods[k as MoodId];
    else moods[k as MoodId] = v;
  }
  return { attention, moods, dropIn, flags };
}
