/**
 * The first-run "tick what you've seen" grid: widely-known titles on the
 * selected plans, spread across kinds and genres. Nothing is left out for
 * taste or dealbreakers — it's only asking "have you seen this?".
 *
 * Chosen greedily: the best-known title first, then each next pick is the
 * best-known remaining one after marking down kinds/genres already well
 * represented, so the grid isn't forty superhero films.
 */
import type { Catalog, CatalogItem, PlanSelection } from '../contracts';
import { getIndex } from './catalogIndex';
import { chooseService } from './rules';

export function onboardingTitles(catalog: Catalog, plans: PlanSelection, count: number): CatalogItem[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const index = getIndex(catalog);
  const pool = index.infos
    .filter((info) => chooseService(info.item, plans) !== null)
    .map((info) => ({
      info,
      // "Widely known": lots of votes, popular right now, and well liked.
      fame: 0.55 * Math.min(1, Math.log10(1 + Math.max(0, info.item.votes)) / 4.3) + 0.3 * info.pop + 0.15 * info.quality,
    }))
    .sort((a, b) => b.fame - a.fame || (a.info.item.id < b.info.item.id ? -1 : 1))
    .slice(0, Math.max(n * 6, 200));

  const out: CatalogItem[] = [];
  const perGenre = new Map<string, number>();
  const perKind = new Map<string, number>();
  while (out.length < n && pool.length) {
    let bestK = 0;
    let best = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < pool.length; k++) {
      const { info, fame } = pool[k];
      const g = info.item.genres[0] ?? 'none';
      const crowd = (perGenre.get(g) ?? 0) * 0.035 + (perKind.get(info.item.kind) ?? 0) * 0.006;
      const v = fame - crowd;
      if (v > best) {
        best = v;
        bestK = k;
      }
    }
    const [chosen] = pool.splice(bestK, 1);
    const item = chosen.info.item;
    const g = item.genres[0] ?? 'none';
    perGenre.set(g, (perGenre.get(g) ?? 0) + 1);
    perKind.set(item.kind, (perKind.get(item.kind) ?? 0) + 1);
    out.push(item);
  }
  return out;
}
