/**
 * CONTRACT: the catalog — what the daily build produces and the phone loads.
 * Only the lead edits files in src/contracts/. Message the lead for changes.
 */

// ---------------------------------------------------------------------------
// Services and plans
// ---------------------------------------------------------------------------

/** A streaming service's id: the `id` of an entry in SERVICES (e.g. 'netflix'). */
export type ServiceId = string;

export interface PlanDef {
  /** Stable id, unique within its service. */
  id: string;
  label: string;
  adFree: boolean;
  /**
   * TMDB (JustWatch) US provider ids whose titles are INCLUDED in this plan.
   * A title is on this plan iff item.providers intersects this list.
   */
  providerIds: number[];
}

export interface ServiceDef {
  id: ServiceId;
  name: string;
  plans: PlanDef[];
}

/**
 * PUBLIC VERSION NOTE: this list is being widened to every major US subscription service.
 * The catalog teammate verifies provider ids against TMDB and proposes the full table; the
 * lead pastes it in here. Code must treat SERVICES as data (never assume these six).
 *
 * Every plan the settings screen can offer. Provider ids verified against TMDB
 * /watch/providers (US) on 10 Oct 2026. TMDB has a single provider for Hulu,
 * HBO Max and Disney+, so their ad / ad-free plans share an id and differ only
 * in `adFree`. Never add Amazon / Apple TV / Roku channel variants here.
 */
export const SERVICES: ServiceDef[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    plans: [
      { id: 'standard', label: 'Ad-free', adFree: true, providerIds: [8] },
      { id: 'ads', label: 'Standard with ads', adFree: false, providerIds: [1796] },
    ],
  },
  {
    id: 'disney',
    name: 'Disney+',
    plans: [
      { id: 'premium', label: 'Ad-free', adFree: true, providerIds: [337] },
      { id: 'ads', label: 'With ads', adFree: false, providerIds: [337] },
    ],
  },
  {
    id: 'hulu',
    name: 'Hulu',
    plans: [
      { id: 'ads', label: 'With ads', adFree: false, providerIds: [15] },
      { id: 'noads', label: 'No ads', adFree: true, providerIds: [15] },
    ],
  },
  {
    id: 'hbo',
    name: 'HBO Max',
    plans: [
      { id: 'ads', label: 'With ads', adFree: false, providerIds: [1899] },
      { id: 'adfree', label: 'Ad-free', adFree: true, providerIds: [1899] },
    ],
  },
  {
    id: 'peacock',
    name: 'Peacock',
    plans: [
      { id: 'premium', label: 'Premium (with ads)', adFree: false, providerIds: [386] },
      { id: 'premium-plus', label: 'Premium Plus', adFree: true, providerIds: [386, 387] },
    ],
  },
  {
    id: 'paramount',
    name: 'Paramount+',
    plans: [
      { id: 'essential', label: 'Essential (with ads)', adFree: false, providerIds: [2616] },
      { id: 'premium', label: 'Premium', adFree: true, providerIds: [2616, 2303] },
    ],
  },
];

/** Which plan (by PlanDef.id) the household has for each service; missing or null = not subscribed. */
export type PlanSelection = Partial<Record<ServiceId, string | null>>;

/** The service ids a household subscribes to under `plans`, sorted. */
export function subscribedServices(plans: PlanSelection): ServiceId[] {
  return SERVICES.filter((s) => {
    const p = plans[s.id];
    return p != null && s.plans.some((d) => d.id === p);
  })
    .map((s) => s.id)
    .sort();
}

/** Every provider id the catalog build should record (all plans above, so plans stay editable). */
export const ALL_PROVIDER_IDS: number[] = [...new Set(SERVICES.flatMap((s) => s.plans.flatMap((p) => p.providerIds)))];

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Normalised genre slugs (TMDB movie + TV genres folded together). */
export const GENRES = {
  action: 'Action',
  adventure: 'Adventure',
  animation: 'Animation',
  comedy: 'Comedy',
  crime: 'Crime',
  documentary: 'Documentary',
  drama: 'Drama',
  family: 'Family',
  fantasy: 'Fantasy',
  history: 'History',
  horror: 'Horror',
  kids: 'Kids',
  music: 'Music',
  mystery: 'Mystery',
  reality: 'Reality',
  romance: 'Romance',
  scifi: 'Sci-Fi',
  soap: 'Soap',
  talk: 'Talk',
  thriller: 'Thriller',
  war: 'War',
  western: 'Western',
} as const;
export type GenreId = keyof typeof GENRES;

export const MOODS = [
  { id: 'laugh', label: 'Want to laugh' },
  { id: 'cozy', label: 'Cozy, comfort' },
  { id: 'brainoff', label: 'Tired, brain off' },
  { id: 'gripped', label: 'Want to be gripped' },
  { id: 'feelgood', label: 'Feel-good, uplifting' },
  { id: 'think', label: 'Want to think or learn' },
  { id: 'romantic', label: 'Romantic' },
  { id: 'scared', label: 'Scared, spooky' },
  { id: 'cry', label: 'Sad, want a good cry' },
  { id: 'hyped', label: 'Hyped, action' },
] as const;
export type MoodId = (typeof MOODS)[number]['id'];

/**
 * How much attention a title needs.
 *  low    — easy to follow while looking away (sitcoms, baking, reality). Eligible for every viewing type.
 *  medium — follows fine with normal attention; not for Background / While eating.
 *  high   — complicated or subtitled; Focused only.
 */
export type Attention = 'low' | 'medium' | 'high';

// ---------------------------------------------------------------------------
// Catalog items
// ---------------------------------------------------------------------------

export type TitleKind = 'movie' | 'tv';

export interface StandoutEpisode {
  season: number;
  episode: number;
  name: string;
  /** Minutes, when known; otherwise the show's `runtime` applies. */
  runtime?: number;
}

/** Fields shared by catalog items and taste references. */
export interface TitleCore {
  /** `${kind}-${tmdbId}`, e.g. 'tv-1399'. The id used everywhere (seen, never, history...). */
  id: string;
  tmdbId: number;
  kind: TitleKind;
  title: string;
  year: number;
  genres: GenreId[];
  /** Lower-cased TMDB keywords, most relevant first, capped (about 12). */
  keywords: string[];
  /** Ids (same `${kind}-${tmdbId}` format) TMDB recommends alongside this title. May point outside the catalog. */
  related: string[];
}

export interface CatalogItem extends TitleCore {
  /** TMDB poster path such as '/abc123.jpg' (prefix with TMDB_IMAGE_BASE), or null. */
  poster: string | null;
  backdrop: string | null;
  overview: string;
  /** Minutes: a movie's runtime, or a show's typical episode length. Always > 0. */
  runtime: number;
  /** TV only. */
  seasons?: number;
  /** TV only: the most recent season that has started airing, with its first air date (YYYY-MM-DD). */
  latestSeason?: { number: number; airDate: string };
  /**
   * Ids of the titles this one is a spinoff of (or a direct continuation / sequel series of).
   * Parents may be outside the catalog. Omitted when none are known.
   */
  spinoffOf?: string[];
  /** US certification when known, e.g. 'TV-MA', 'PG-13'. */
  certification?: string;
  /** Original language as an ISO 639-1 code, e.g. 'en', 'ko'. Used by the "nothing subtitled" choice. */
  lang: string;
  /** TMDB vote average 0-10, vote count, and popularity. */
  rating: number;
  votes: number;
  popularity: number;
  /** TMDB provider ids (subset of ALL_PROVIDER_IDS) where this is included with a subscription (flatrate/ads only). Never empty. */
  providers: number[];
  attention: Attention;
  /** Mood fit 0..1 for the moods that apply; missing = 0. */
  moods: Partial<Record<MoodId, number>>;
  /** TV only: episodes stand alone, so "put on any episode" works (sitcoms, reality, baking, sketch, procedurals). */
  dropIn: boolean;
  /** TV only: episodes that stand out AND work on their own, best first. Usually 0-3. */
  standout: StandoutEpisode[];
  /** Hard content flags used by dealbreakers. `scary` = frightening/disturbing tone even if not tagged horror. */
  flags: { horror: boolean; trueCrime: boolean; scary: boolean };
}

export interface Catalog {
  schema: 1;
  /** ISO timestamp of the build. */
  builtAt: string;
  items: CatalogItem[];
}

/**
 * public/data/manifest.json — the list of per-service catalog files.
 * Each file is a `Catalog` holding every title available on ANY plan of that service
 * (a title on several services appears in several files, identical each time; merge by id).
 */
export interface CatalogManifest {
  schema: 1;
  builtAt: string;
  services: Record<ServiceId, { /** Path relative to the site base, e.g. 'data/catalog/netflix.json'. */ file: string; titles: number; bytes: number }>;
}

export interface NewArrival {
  itemId: string;
  /** 'title' = newly on our services; 'season' = a new season of a show already there. */
  type: 'title' | 'season';
  season?: number;
  /** Provider ids it arrived on (for 'season', the providers carrying the show). */
  providers: number[];
  /** ISO date (YYYY-MM-DD) the build first noticed it. */
  date: string;
}

/** public/data/new.json — a rolling window (about 30 days) of arrivals, newest first. */
export interface NewArrivals {
  schema: 1;
  builtAt: string;
  entries: NewArrival[];
}

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/';
/** Poster URL helper. Sizes TMDB supports include w185, w342, w500, w780. */
export function posterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' | 'w780' = 'w500'): string | null {
  return path ? `${TMDB_IMAGE_BASE}${size}${path}` : null;
}

/**
 * public/data/titles.json — a broad name lookup used ONLY when importing a
 * watch history or adding a watched title by hand. It covers every catalog
 * item plus many well-known titles that are NOT on our services (so an
 * imported history still matches). Loaded on demand, never at startup.
 */
export interface TitleIndexEntry {
  id: string;
  kind: TitleKind;
  title: string;
  year: number;
  genres: GenreId[];
  /** A few lower-cased keywords when cheaply known; may be empty. */
  keywords: string[];
  /** Other names the title is listed under (original title, common alternates). Omitted when none. */
  aka?: string[];
  /** TMDB poster path when known. */
  poster?: string | null;
  /** Relative popularity, for breaking ties between same-named titles. */
  popularity: number;
}

export interface TitleIndex {
  schema: 1;
  builtAt: string;
  titles: TitleIndexEntry[];
}

/** Catalog file locations, relative to the site base. */
export const CATALOG_MANIFEST_PATH = 'data/manifest.json';
export const NEW_ARRIVALS_PATH = 'data/new.json';
export const TITLE_INDEX_PATH = 'data/titles.json';

