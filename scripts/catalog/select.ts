/** Choosing which titles each service's file holds: quality floor, per-service quota, genre reserves, size trim. Pure. */
import type { CatalogItem, ServiceId } from '../../src/contracts/catalog';
import { quotaFor, SERVICE_PROVIDERS, servicesOf } from './services';

export { servicesOf, SERVICE_PROVIDERS };

// ---------------------------------------------------------------------------
// Quality floor (applied to TMDB discover rows before fetching details, and again to details)
// ---------------------------------------------------------------------------

export interface FloorInput {
  kind: 'movie' | 'tv';
  votes: number;
  rating: number;
  /** TMDB genre ids (raw). */
  genreIds: number[];
  /** Release / first-air date, if known. */
  date?: string;
  today: string;
}

export function passesFloor(x: FloorInput): boolean {
  const ageDays = x.date ? (Date.parse(x.today) - Date.parse(x.date)) / 86_400_000 : 9999;
  const reality = x.genreIds.some((g) => g === 10764 || g === 10767);
  // brand-new releases have hardly any votes yet; let them in so the New feed has something to show
  const minVotes = ageDays < 75 ? 5 : ageDays < 540 ? 30 : x.kind === 'movie' ? 150 : reality ? 25 : 80;
  const minRating = reality ? 6.3 : 6.0;
  if (x.votes < minVotes) return false;
  if (x.rating < minRating) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Scoring and selection
// ---------------------------------------------------------------------------

/** Vote-count-weighted rating (0..10): few votes pull towards the 6.5 prior. */
export function bayes(rating: number, votes: number, m = 300): number {
  return (votes / (votes + m)) * rating + (m / (votes + m)) * 6.5;
}

export function qualityScore(i: CatalogItem): number {
  return bayes(i.rating, i.votes);
}

export function popularityScore(i: CatalogItem): number {
  return Math.log10(1 + i.popularity) * 0.5 + Math.log10(1 + i.votes) * 0.5;
}

/** Overall keep-priority: well-known and good both count. */
export function priority(i: CatalogItem): number {
  return (qualityScore(i) / 10) * 0.5 + (popularityScore(i) / 5) * 0.5;
}

/** Genre reserves, as a share of the service's quota, so reality / documentary / romance aren't crowded out by action. */
export const GENRE_RESERVES = [
  ['reality', 'tv', 0.06],
  ['talk', 'tv', 0.015],
  ['documentary', 'tv', 0.04],
  ['documentary', 'movie', 0.03],
  ['romance', 'movie', 0.06],
  ['romance', 'tv', 0.03],
  ['comedy', 'tv', 0.06],
] as const;

export interface Selection {
  items: CatalogItem[];
  /** Ids picked by the genre reserves for reality / talk / documentary; trimming leaves them alone. */
  reserved: Set<string>;
}

/** Members of one service (any plan), best-first per the popularity / quality alternation, plus the genre reserves. */
export function selectForService(pool: CatalogItem[], service: ServiceId, quota = quotaFor(service), map = SERVICE_PROVIDERS): Selection {
  const ids = map[service];
  const members = pool.filter((i) => i.providers.some((p) => ids.has(p)));
  const chosen = new Map<string, CatalogItem>();
  const reserved = new Set<string>();
  const byPop = [...members].sort((a, b) => popularityScore(b) - popularityScore(a));
  const byQual = [...members].sort((a, b) => qualityScore(b) - qualityScore(a));
  const take = Math.min(quota, members.length);
  let a = 0;
  let b = 0;
  while (chosen.size < take) {
    // popular list first, then best-rated list, alternating
    while (a < byPop.length && chosen.has(byPop[a].id)) a++;
    if (a < byPop.length) chosen.set(byPop[a].id, byPop[a]);
    if (chosen.size >= take) break;
    while (b < byQual.length && chosen.has(byQual[b].id)) b++;
    if (b < byQual.length) chosen.set(byQual[b].id, byQual[b]);
    if (a >= byPop.length && b >= byQual.length) break;
  }
  for (const [genre, kind, share] of GENRE_RESERVES) {
    const n = Math.round(quota * share);
    const g = members.filter((i) => i.kind === kind && i.genres.includes(genre)).sort((x, y) => priority(y) - priority(x));
    for (const i of g.slice(0, n)) {
      chosen.set(i.id, i);
      if (genre === 'reality' || genre === 'talk' || genre === 'documentary') reserved.add(i.id);
    }
  }
  return { items: trimTo([...chosen.values()], quota, reserved), reserved };
}

/** Drops the lowest-priority titles until `cap` is met, never dropping `keep` ids. */
export function trimTo(items: CatalogItem[], cap: number, keep: Set<string> = new Set()): CatalogItem[] {
  if (items.length <= cap) return items;
  const order = [...items].sort((a, b) => priority(a) - priority(b));
  const drop = new Set<string>();
  let remaining = items.length;
  for (const i of order) {
    if (remaining <= cap) break;
    if (keep.has(i.id)) continue;
    drop.add(i.id);
    remaining--;
  }
  return items.filter((i) => !drop.has(i.id));
}

/** Selects every service from the same pool. Items are shared objects, so a title on several services is identical in each. */
export function selectAll(pool: CatalogItem[], services: ServiceId[], map = SERVICE_PROVIDERS): Map<ServiceId, Selection> {
  const out = new Map<ServiceId, Selection>();
  for (const s of services) out.set(s, selectForService(pool, s, quotaFor(s), map));
  return out;
}
