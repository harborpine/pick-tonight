/** Standout episodes: top-rated single episodes that stand alone. Pure selection; the fetch lives in build.ts. */
import type { StandoutEpisode } from '../../src/contracts/catalog';
import { median } from './util';

export interface RawEpisode {
  season_number: number;
  episode_number: number;
  name: string;
  vote_average: number;
  vote_count: number;
  runtime?: number | null;
}

const PART_RE = /\b(part|pt\.?)\s*(\d+|one|two|three|four|i{1,3}|iv)\b|\(\s*(part|\d)|two[- ]parter|\bto be continued\b/i;
const PLACEHOLDER_RE = /^(episode\s*\d+|untitled|tba|tbd)\b/i;

export function pickStandouts(episodes: RawEpisode[], max = 3): StandoutEpisode[] {
  const real = episodes.filter(
    (e) => e.season_number > 0 && e.episode_number > 0 && e.name && !PLACEHOLDER_RE.test(e.name) && (e.vote_count ?? 0) > 0,
  );
  if (real.length < 4) return [];
  const votesMed = median(real.map((e) => e.vote_count));
  const ratingMed = median(real.map((e) => e.vote_average));
  const minVotes = Math.max(6, votesMed);
  const minRating = Math.max(8.0, ratingMed + 0.6);
  const picks = real
    .filter((e) => e.vote_count >= minVotes && e.vote_average >= minRating)
    .filter((e) => !(e.season_number === 1 && e.episode_number === 1)) // pilots
    .filter((e) => !PART_RE.test(e.name)) // two-parters need their other half
    .sort((a, b) => b.vote_average - a.vote_average || b.vote_count - a.vote_count)
    .slice(0, max);
  return picks.map((e) => ({
    season: e.season_number,
    episode: e.episode_number,
    name: e.name,
    ...(e.runtime && e.runtime > 0 ? { runtime: e.runtime } : {}),
  }));
}

/** Which season numbers to fetch: all if few, otherwise an even sample (always including season 1 and the latest). */
export function seasonsToFetch(total: number, maxSeasons = 16): number[] {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  if (total <= maxSeasons) return all;
  const out = new Set<number>([1, total]);
  for (let i = 0; out.size < maxSeasons; i++) out.add(1 + Math.round((i * (total - 1)) / (maxSeasons - 1)));
  return [...out].sort((a, b) => a - b);
}
