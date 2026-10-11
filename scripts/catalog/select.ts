/** Choosing which titles make the catalog: quality floor, per-service balance, size cap. Pure. */
import type { CatalogItem, ServiceId } from '../../src/contracts/catalog';
import { DEFAULT_PLANS, SERVICES } from '../../src/contracts/catalog';

/** Every provider id of each service across all its plans. */
export const SERVICE_PROVIDERS: Record<ServiceId, Set<number>> = Object.fromEntries(
  SERVICES.map((s) => [s.id, new Set(s.plans.flatMap((p) => p.providerIds))]),
) as Record<ServiceId, Set<number>>;

/** Provider ids of each service's default plan (the household's actual plans). */
export const DEFAULT_PROVIDERS: Record<ServiceId, Set<number>> = Object.fromEntries(
  SERVICES.map((s) => {
    const plan = s.plans.find((p) => p.id === DEFAULT_PLANS[s.id]);
    return [s.id, new Set(plan?.providerIds ?? [])];
  }),
) as Record<ServiceId, Set<number>>;

export function servicesOf(providers: number[], map: Record<ServiceId, Set<number>> = SERVICE_PROVIDERS): ServiceId[] {
  return (Object.keys(map) as ServiceId[]).filter((s) => providers.some((p) => map[s].has(p)));
}

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
  const minVotes = ageDays < 75 ? 5 : ageDays < 540 ? 30 : x.kind === 'movie' ? 150 : reality ? 12 : 80;
  const minRating = reality ? 5.5 : 6.0;
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
  const onDefault = servicesOf(i.providers, DEFAULT_PROVIDERS).length > 0;
  return qualityScore(i) / 10 * 0.5 + popularityScore(i) / 5 * 0.5 + (onDefault ? 0.1 : 0);
}

export interface SelectOptions {
  /** Per service, how many titles to take (alternating popular / high quality). */
  perService: number;
  /** Maximum total titles. */
  cap: number;
  /** Don't trim a service below this many titles when applying the cap. */
  minPerService: number;
  /** Ids that must stay (seed favourites on our services). */
  mustKeep: Set<string>;
}

export function selectItems(pool: CatalogItem[], o: SelectOptions): CatalogItem[] {
  const chosen = new Map<string, CatalogItem>();
  for (const sid of Object.keys(SERVICE_PROVIDERS) as ServiceId[]) {
    const members = pool.filter((i) => i.providers.some((p) => SERVICE_PROVIDERS[sid].has(p)));
    const byPop = [...members].sort((a, b) => popularityScore(b) - popularityScore(a));
    const byQual = [...members].sort((a, b) => qualityScore(b) - qualityScore(a));
    const taken = new Set<string>();
    let a = 0;
    let b = 0;
    while (taken.size < Math.min(o.perService, members.length)) {
      // popular list first, then best-rated list, alternating
      while (a < byPop.length && taken.has(byPop[a].id)) a++;
      if (a < byPop.length) taken.add(byPop[a].id);
      if (taken.size >= o.perService) break;
      while (b < byQual.length && taken.has(byQual[b].id)) b++;
      if (b < byQual.length) taken.add(byQual[b].id);
      if (a >= byPop.length && b >= byQual.length) break;
    }
    for (const id of taken) chosen.set(id, pool.find((i) => i.id === id)!);
  }
  // Genre reserves so reality / documentary / romance aren't crowded out by action and fantasy.
  for (const [genre, kind, n] of [['reality', 'tv', 160], ['talk', 'tv', 25], ['documentary', 'tv', 90], ['documentary', 'movie', 70], ['romance', 'movie', 150], ['romance', 'tv', 70], ['comedy', 'tv', 150]] as const) {
    const g = pool.filter((i) => i.kind === kind && i.genres.includes(genre)).sort((a, b) => priority(b) - priority(a));
    for (const i of g.slice(0, n)) chosen.set(i.id, i);
  }
  for (const i of pool) if (o.mustKeep.has(i.id)) chosen.set(i.id, i);
  return trimTo([...chosen.values()], o.cap, o.minPerService, o.mustKeep);
}

/** Drops the lowest-priority titles until `cap` is met, never starving any service below `min`. */
export function trimTo(items: CatalogItem[], cap: number, min: number, mustKeep: Set<string> = new Set()): CatalogItem[] {
  if (items.length <= cap) return items;
  const counts = new Map<ServiceId, number>();
  for (const i of items) for (const s of servicesOf(i.providers)) counts.set(s, (counts.get(s) ?? 0) + 1);
  const order = [...items].sort((a, b) => priority(a) - priority(b));
  const drop = new Set<string>();
  let remaining = items.length;
  for (const i of order) {
    if (remaining <= cap) break;
    if (mustKeep.has(i.id)) continue;
    const svcs = servicesOf(i.providers);
    if (svcs.some((s) => (counts.get(s) ?? 0) <= min)) continue;
    for (const s of svcs) counts.set(s, (counts.get(s) ?? 0) - 1);
    drop.add(i.id);
    remaining--;
  }
  return items.filter((i) => !drop.has(i.id));
}
