/**
 * PLACEHOLDER engine from the lead so the app runs from day one.
 * It only sorts by popularity and applies none of the taste logic and only a
 * rough version of the rules. The engine teammate replaces this whole file.
 */
import {
  MOODS,
  SERVICES,
  TIME_LIMIT_MINUTES,
  watchers,
  type CatalogItem,
  type DeckCard,
  type Engine,
  type EngineContext,
  type PersonId,
  type Profile,
  type SuggestRequest,
  type Who,
} from '../contracts';

export function createEngine(): Engine {
  const chooseService: Engine['chooseService'] = (item, plans) => {
    let best: ReturnType<Engine['chooseService']> = null;
    for (const svc of SERVICES) {
      const plan = svc.plans.find((p) => p.id === plans[svc.id]);
      if (!plan || !plan.providerIds.some((id) => item.providers.includes(id))) continue;
      if (!best || (plan.adFree && !best.adFree)) best = { serviceId: svc.id, planId: plan.id, adFree: plan.adFree };
    }
    return best;
  };
  const hasSeen = (person: PersonId, itemId: string, ctx: EngineContext) =>
    itemId in ctx.state.seen[person] || ctx.state.profiles[person].favorites.includes(itemId);
  const isNeverHidden = (itemId: string, who: Who, ctx: EngineContext) => {
    const hg = itemId in ctx.state.never.HG;
    const bg = itemId in ctx.state.never.BG;
    if (hg && bg) return true;
    return who === 'Together' ? hg || bg : who === 'HG' ? hg : bg;
  };
  const choosePick: Engine['choosePick'] = (item, req) => {
    if (item.runtime > TIME_LIMIT_MINUTES[req.time]) return null;
    if (item.kind === 'movie') return { pick: { type: 'movie' }, minutes: item.runtime };
    return { pick: item.dropIn ? { type: 'any-episode' } : { type: 'series-start' }, minutes: item.runtime };
  };
  const isEligible = (item: CatalogItem, req: SuggestRequest, ctx: EngineContext) => {
    if (!chooseService(item, ctx.state.settings.plans)) return false;
    if (!choosePick(item, req, ctx)) return false;
    if (isNeverHidden(item.id, req.who, ctx)) return false;
    if (req.viewing !== 'focused' && item.attention !== 'low') return false;
    for (const p of watchers(req.who)) {
      const d = ctx.state.profiles[p].dealbreakers;
      if ((d.horror && item.flags.horror) || (d.trueCrime && item.flags.trueCrime) || (d.scary && item.flags.scary)) return false;
    }
    return true;
  };
  const card = (item: CatalogItem, req: SuggestRequest, ctx: EngineContext): DeckCard => {
    const p = choosePick(item, req, ctx)!;
    return { itemId: item.id, pick: p.pick, minutes: p.minutes, service: chooseService(item, ctx.state.settings.plans)!, score: item.popularity, reasons: [] };
  };

  return {
    availableMoods: (who, ctx) =>
      MOODS.map((m) => m.id).filter(
        (m) => m !== 'scared' || watchers(who).every((p) => !ctx.state.profiles[p].dealbreakers.scary && !ctx.state.profiles[p].dealbreakers.horror),
      ),
    chooseService,
    hasSeen,
    isNeverHidden,
    choosePick,
    isEligible,
    buildDeck: (req, ctx, opts = {}) =>
      ctx.catalog.items
        .filter((i) => !opts.exclude?.includes(i.id) && isEligible(i, req, ctx))
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, opts.limit ?? 30)
        .map((i) => card(i, req, ctx)),
    rankNewArrivals: (arrivals, who, ctx) => {
      const req: SuggestRequest = { who, viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either', genre: null };
      const byId = new Map(ctx.catalog.items.map((i) => [i.id, i]));
      return arrivals.entries.flatMap((arrival) => {
        const item = byId.get(arrival.itemId);
        return item && isEligible(item, req, ctx) ? [{ ...card(item, req, ctx), arrival }] : [];
      });
    },
    defaultProfile: (person, catalog): Profile => ({
      id: person,
      favorites: catalog.seedFavorites[person],
      dealbreakers: person === 'BG' ? { horror: true, trueCrime: true, scary: true } : { horror: false, trueCrime: false, scary: false },
      taste: { genres: {}, keywords: {}, traits: {}, corrections: {} },
      onboarded: false,
    }),
    learnFromSwipe: (profile) => profile,
    describeTaste: () => [],
    correctTaste: (profile) => profile,
    onboardingTitles: (catalog, plans, count) =>
      catalog.items
        .filter((i) => chooseService(i, plans))
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, count),
  };
}
