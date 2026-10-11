/** Turns a raw TMDB detail response into a normalised, tagged title. Pure; no network. */
import type { CatalogItem, GenreId, TitleCore, TitleKind } from '../../src/contracts/catalog';
import { ALL_PROVIDER_IDS } from '../../src/contracts/catalog';
import { mapGenres, pickRuntime, tagTitle, countKw, type TagInput } from './tagging';
import { truncate, round2 } from './util';

export const DETAIL_APPEND_MOVIE = 'keywords,watch/providers,recommendations,release_dates';
export const DETAIL_APPEND_TV = 'keywords,watch/providers,recommendations,content_ratings';

export interface Parsed {
  tmdbId: number;
  kind: TitleKind;
  title: string;
  year: number;
  genres: GenreId[];
  /** All keywords, lower-cased, uncapped. */
  allKeywords: string[];
  originalLanguage: string;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  runtime: number;
  seasons?: number;
  certification?: string;
  rating: number;
  votes: number;
  popularity: number;
  /** Subscription (flatrate + ads) US providers, restricted to ALL_PROVIDER_IDS. */
  providers: number[];
  related: string[];
  adult: boolean;
  /** TV: TMDB had no episode_run_time, so `runtime` is a guess (last episode / genre default). */
  runtimeGuess: boolean;
  /** Movie release date, or TV first air date (YYYY-MM-DD) when known. */
  releaseDate?: string;
  /** TV: premiere date of each season (>0). */
  seasonPremieres: { season: number; airDate: string }[];
}

const ALL = new Set(ALL_PROVIDER_IDS);

export function usProviders(d: any): number[] {
  const us = d?.['watch/providers']?.results?.US;
  if (!us) return [];
  const ids = new Set<number>();
  for (const list of [us.flatrate, us.ads]) for (const p of list ?? []) if (ALL.has(p.provider_id)) ids.add(p.provider_id);
  return [...ids].sort((a, b) => a - b);
}

function certification(kind: TitleKind, d: any): string | undefined {
  if (kind === 'tv') {
    const us = d?.content_ratings?.results?.find((r: any) => r.iso_3166_1 === 'US');
    return us?.rating || undefined;
  }
  const us = d?.release_dates?.results?.find((r: any) => r.iso_3166_1 === 'US');
  const dates: any[] = us?.release_dates ?? [];
  for (const type of [3, 4, 2, 1, 5, 6]) {
    const hit = dates.find((x) => x.type === type && x.certification);
    if (hit) return hit.certification;
  }
  return dates.find((x) => x.certification)?.certification || undefined;
}

export function parseDetail(kind: TitleKind, d: any): Parsed | null {
  if (!d || typeof d.id !== 'number') return null;
  const date: string | undefined = (kind === 'movie' ? d.release_date : d.first_air_date) || undefined;
  const year = date ? Number(date.slice(0, 4)) : NaN;
  const title: string = (kind === 'movie' ? d.title : d.name) || '';
  if (!title || !Number.isFinite(year)) return null;
  const genres = mapGenres((d.genres ?? []).map((g: any) => g.id));
  const kwList: any[] = (kind === 'movie' ? d.keywords?.keywords : d.keywords?.results) ?? [];
  const allKeywords = [...new Set(kwList.map((k) => String(k.name).toLowerCase()))];
  const related = (d.recommendations?.results ?? [])
    .filter((r: any) => typeof r.id === 'number')
    .map((r: any) => `${kind}-${r.id}`);
  const seasonPremieres = ((d.seasons ?? []) as any[])
    .filter((s) => s.season_number > 0 && s.air_date)
    .map((s) => ({ season: s.season_number as number, airDate: s.air_date as string }));
  return {
    tmdbId: d.id,
    kind,
    title,
    year,
    genres,
    allKeywords,
    originalLanguage: d.original_language ?? '',
    overview: d.overview ?? '',
    poster: d.poster_path ?? null,
    backdrop: d.backdrop_path ?? null,
    runtime: pickRuntime(
      kind,
      { runtime: d.runtime, episode_run_time: d.episode_run_time, last: d.last_episode_to_air?.runtime, next: d.next_episode_to_air?.runtime },
      genres,
    ),
    ...(kind === 'tv' ? { seasons: Math.max(1, d.number_of_seasons ?? seasonPremieres.length ?? 1) } : {}),
    certification: certification(kind, d),
    rating: round2(d.vote_average ?? 0),
    votes: d.vote_count ?? 0,
    popularity: round2(d.popularity ?? 0),
    providers: usProviders(d),
    related: [...new Set<string>(related)],
    adult: !!d.adult,
    runtimeGuess: kind === 'tv' && (!(d.episode_run_time ?? []).some((x: number) => x > 0) || (genres.includes('comedy') && !genres.includes('drama') && (d.episode_run_time ?? []).some((x: number) => x >= 26 && x <= 32))),
    releaseDate: date,
    seasonPremieres,
  };
}

/** Keywords that the scoring engine can use come first in the capped list. */
const USEFUL = [
  'sitcom', 'anthology', 'true crime', 'baking', 'cooking', 'competition', 'dating', 'wholesome', 'friendship', 'family',
  'based on novel', 'based on true story', 'based on comic', 'superhero', 'time travel', 'dystopia', 'conspiracy', 'serial killer',
  'murder', 'romantic comedy', 'coming of age', 'workplace', 'hospital', 'high school', 'police', 'lawyer', 'political',
  'adult animation', 'satire', 'dark comedy', 'survival', 'espionage', 'war', 'heist', 'sports', 'musical', 'supernatural',
];
export function capKeywords(all: string[], max = 10): string[] {
  const score = (k: string) => (countKw([k], USEFUL) > 0 ? 0 : 1);
  return [...all].map((k, i) => ({ k: k.trim(), i })).sort((a, b) => score(a.k) - score(b.k) || a.i - b.i).slice(0, max).map((x) => x.k);
}

export function toTagInput(p: Parsed): TagInput {
  return {
    kind: p.kind,
    tmdbId: p.tmdbId,
    title: p.title,
    year: p.year,
    genres: p.genres,
    keywords: p.allKeywords,
    originalLanguage: p.originalLanguage,
    runtime: p.runtime,
    rating: p.rating,
    votes: p.votes,
    seasons: p.seasons,
    certification: p.certification,
  };
}

export function toCore(p: Parsed, maxRelated = 8): TitleCore {
  return {
    id: `${p.kind}-${p.tmdbId}`,
    tmdbId: p.tmdbId,
    kind: p.kind,
    title: p.title,
    year: p.year,
    genres: p.genres,
    keywords: capKeywords(p.allKeywords),
    related: p.related.slice(0, maxRelated),
  };
}

export function toCatalogItem(p: Parsed): CatalogItem {
  const tags = tagTitle(toTagInput(p));
  return {
    ...toCore(p),
    poster: p.poster,
    backdrop: p.backdrop,
    overview: truncate(p.overview, 170),
    runtime: p.runtime,
    ...(p.kind === 'tv' ? { seasons: p.seasons } : {}),
    ...(p.certification ? { certification: p.certification } : {}),
    rating: p.rating,
    votes: p.votes,
    popularity: p.popularity,
    providers: p.providers,
    attention: tags.attention,
    moods: tags.moods,
    dropIn: tags.dropIn,
    standout: [],
    flags: tags.flags,
  };
}
