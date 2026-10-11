/**
 * THE HARD RULES. Everything in this file is a yes/no gate; nothing here is
 * about taste. A title that fails any gate can never appear in a deck, no
 * matter how well it scores. The numbered rules match SPEC.md and the
 * `describe` blocks in rules.test.ts.
 *
 *  1. Only titles included in the household's selected plans.
 *  2. A watcher's dealbreakers (horror / true crime / scary) exclude a title;
 *     the "scared" mood only exists for audiences with no horror/scary dealbreaker.
 *  3. Background and While eating: only low-attention titles.
 *  4. Nothing longer than the time available.
 *  5. New = nobody watching has seen it. Rewatch = somebody watching has.
 *  6. When several of our services carry a title, an ad-free one is chosen.
 *  7. Never: hidden for the person who tapped it and for Together; hidden
 *     everywhere once both have tapped it.
 *  +  "Not tonight" hides a title for that person (and Together) on that date only.
 *  +  Picked: a title sitting on the Matches tab is left out for the people it was picked for.
 */
import {
  MOODS,
  SERVICES,
  TIME_LIMIT_MINUTES,
  watchers,
  type CatalogItem,
  type Dealbreakers,
  type EngineContext,
  type MoodId,
  type PersonId,
  type PlanSelection,
  type ServiceChoice,
  type StandoutEpisode,
  type SuggestRequest,
  type WatchPick,
  type Who,
} from '../contracts';
import { hash01, SmallCache } from './util';

// ---------------------------------------------------------------------------
// Rules 1 and 6: plans and service choice
// ---------------------------------------------------------------------------

interface ActivePlan {
  choice: ServiceChoice;
  providerIds: number[];
}

const planCache = new SmallCache<ActivePlan[]>(8);

/**
 * The household's plans, ad-free ones first, otherwise in the fixed order of
 * SERVICES. Because the list is ordered this way, "the first plan that carries
 * the title" is always an ad-free one when any ad-free option exists, and the
 * choice among equals is always the same.
 */
function activePlans(plans: PlanSelection): ActivePlan[] {
  const key = SERVICES.map((s) => plans?.[s.id] ?? '').join('|');
  return planCache.get(key, () => {
    const out: ActivePlan[] = [];
    for (const svc of SERVICES) {
      const planId = plans?.[svc.id];
      if (!planId) continue; // not subscribed: contributes nothing
      const plan = svc.plans.find((p) => p.id === planId);
      if (!plan) continue; // unknown plan id: treat as not subscribed (safe side)
      out.push({ choice: { serviceId: svc.id, planId: plan.id, adFree: plan.adFree }, providerIds: plan.providerIds });
    }
    // Stable sort: ad-free first, SERVICES order preserved within each group.
    return out.sort((a, b) => Number(b.choice.adFree) - Number(a.choice.adFree));
  });
}

export function chooseService(item: CatalogItem, plans: PlanSelection): ServiceChoice | null {
  const providers = item.providers ?? [];
  for (const p of activePlans(plans)) {
    for (const id of p.providerIds) {
      if (providers.includes(id)) return { ...p.choice };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rule 2: dealbreakers and the scared mood
// ---------------------------------------------------------------------------

const BG_DEFAULT: Dealbreakers = { horror: true, trueCrime: true, scary: true };
const NONE: Dealbreakers = { horror: false, trueCrime: false, scary: false };

/** A person's dealbreakers. If BG's profile is somehow missing, assume the strict defaults. */
export function dealbreakersOf(person: PersonId, ctx: EngineContext): Dealbreakers {
  return ctx.state.profiles?.[person]?.dealbreakers ?? (person === 'BG' ? BG_DEFAULT : NONE);
}

export function hitsDealbreaker(item: CatalogItem, who: Who, ctx: EngineContext): boolean {
  const f = item.flags ?? NONE;
  for (const p of watchers(who)) {
    const d = dealbreakersOf(p, ctx);
    if ((d.horror && f.horror) || (d.trueCrime && f.trueCrime) || (d.scary && f.scary)) return true;
  }
  return false;
}

/** The scared mood is offered only when nobody watching has a horror or scary dealbreaker. */
export function scaredOffered(who: Who, ctx: EngineContext): boolean {
  return watchers(who).every((p) => {
    const d = dealbreakersOf(p, ctx);
    return !d.horror && !d.scary;
  });
}

export function availableMoods(who: Who, ctx: EngineContext): MoodId[] {
  const scared = scaredOffered(who, ctx);
  return MOODS.map((m) => m.id).filter((m) => m !== 'scared' || scared);
}

// ---------------------------------------------------------------------------
// Rule 5 (seen), Rule 7 (never), and "not tonight"
// ---------------------------------------------------------------------------

/** Favourites count as seen. Presence in the watched list is what counts; the entry's contents don't matter here. */
export function hasSeen(person: PersonId, itemId: string, ctx: EngineContext): boolean {
  const seen = ctx.state.seen?.[person];
  if (seen && Object.prototype.hasOwnProperty.call(seen, itemId)) return true;
  return ctx.state.profiles?.[person]?.favorites?.includes(itemId) ?? false;
}

/** Timestamps before this (1 Jan 2000) are placeholders, not real dates. */
const REAL_DATE_FROM = 946684800000;

/**
 * When the person last watched the title (ms), or null when it is not on their
 * watched list or the entry carries no real date. Tolerates the pre-v2 shape,
 * where the stored value was the bare timestamp.
 */
export function watchedAt(person: PersonId, itemId: string, ctx: EngineContext): number | null {
  const seen = ctx.state.seen?.[person];
  if (!seen || !Object.prototype.hasOwnProperty.call(seen, itemId)) return null;
  const entry = seen[itemId] as unknown;
  const at = typeof entry === 'number' ? entry : (entry as { at?: unknown } | null)?.at;
  return typeof at === 'number' && Number.isFinite(at) && at >= REAL_DATE_FROM ? at : null;
}

// ---------------------------------------------------------------------------
// Picked (the Matches tab)
// ---------------------------------------------------------------------------

/**
 * Item ids that are sitting on the Matches tab for this audience: a pick whose
 * own audience shares at least one person with `who`. So HG's solo pick hides
 * the title from HG and from Together (he is in both) but not from BG alone,
 * and a Together match hides it from everyone.
 *
 * A pick stops counting once someone it was picked for has marked the title
 * watched at or after the moment it was picked: it has been watched, so it is
 * an ordinary seen title again (the contract's "until the pick is removed or
 * the title is marked watched").
 */
export function pickedIds(who: Who, ctx: EngineContext): Set<string> {
  const out = new Set<string>();
  const picks = ctx.state.picks;
  if (!Array.isArray(picks) || !picks.length) return out;
  const audience = watchers(who);
  for (const pick of picks) {
    if (!pick || typeof pick.itemId !== 'string') continue;
    const forWhom = watchers(pick.who === 'HG' || pick.who === 'BG' ? pick.who : 'Together');
    if (!forWhom.some((p) => audience.includes(p))) continue;
    const pickedAt = typeof pick.at === 'number' ? pick.at : 0;
    if (forWhom.some((p) => (watchedAt(p, pick.itemId, ctx) ?? -1) >= pickedAt)) continue; // watched since
    out.add(pick.itemId);
  }
  return out;
}

export function isPicked(itemId: string, who: Who, ctx: EngineContext): boolean {
  if (!ctx.state.picks?.length) return false;
  return pickedIds(who, ctx).has(itemId);
}

function tappedNever(person: PersonId, itemId: string, ctx: EngineContext): boolean {
  const never = ctx.state.never?.[person];
  return !!never && Object.prototype.hasOwnProperty.call(never, itemId);
}

export function isNeverHidden(itemId: string, who: Who, ctx: EngineContext): boolean {
  const hg = tappedNever('HG', itemId, ctx);
  const bg = tappedNever('BG', itemId, ctx);
  if (hg && bg) return true; // gone everywhere, for good
  if (who === 'Together') return hg || bg;
  return who === 'HG' ? hg : bg;
}

/** Hidden only on the date it was swiped; it comes back another day. */
export function isNotTonight(itemId: string, who: Who, ctx: EngineContext): boolean {
  for (const p of watchers(who)) {
    const map = ctx.state.notTonight?.[p];
    if (map && Object.prototype.hasOwnProperty.call(map, itemId) && map[itemId] === ctx.today) return true;
  }
  return false;
}

export function seenByAny(itemId: string, who: Who, ctx: EngineContext): boolean {
  return watchers(who).some((p) => hasSeen(p, itemId, ctx));
}
export function seenByAll(itemId: string, who: Who, ctx: EngineContext): boolean {
  return watchers(who).every((p) => hasSeen(p, itemId, ctx));
}

// ---------------------------------------------------------------------------
// Rule 4 and "exactly what to watch"
// ---------------------------------------------------------------------------

export interface PickResult {
  pick: WatchPick;
  minutes: number;
}

const isAnthology = (item: CatalogItem) => (item.keywords ?? []).some((k) => k === 'anthology' || k === 'anthology series');

/**
 * What exactly to watch, within `limit` minutes. Policy:
 *
 *  - Movie: the movie, if its runtime fits.
 *  - Drop-in or anthology show (sitcoms, baking, sketch...): any episode works,
 *    so if the show has a standout episode that fits the time we name it — a
 *    specific "watch this one" beats a vague "put on any episode". Otherwise
 *    "any episode".
 *  - Serialized show nobody watching has finished with: "start the series".
 *    We never drop a newcomer into the middle of a story, even for a famous episode.
 *  - Serialized show EVERYONE watching has already seen: a standout episode is
 *    a great rewatch suggestion; otherwise "start the series" again.
 *
 * A standout episode is only named if its own length fits (its `runtime` when
 * given, else the show's). A non-zero seed rotates between the episodes that
 * fit (and, for drop-in shows, plain "any episode") so repeat requests aren't
 * always the same; seed 0 always names the first (best) one.
 * `allowStandout: false` (used for "new season" cards) skips the episode logic.
 */
export function pickFor(
  item: CatalogItem,
  limit: number,
  everyoneHasSeen: boolean,
  seed = 0,
  allowStandout = true,
): PickResult | null {
  const runtime = item.runtime;
  if (item.kind === 'movie') return runtime <= limit ? { pick: { type: 'movie' }, minutes: runtime } : null;

  const oneOffContext = item.dropIn || isAnthology(item) || everyoneHasSeen;
  if (allowStandout && oneOffContext && item.standout?.length) {
    const fitting: StandoutEpisode[] = item.standout.filter((e) => (e.runtime ?? runtime) <= limit);
    if (fitting.length) {
      // With a seed, a drop-in show sometimes just gets "any episode" instead, so
      // a show with one famous episode isn't pinned to it on every request.
      const options = seed !== 0 && item.dropIn && runtime <= limit ? fitting.length + 1 : fitting.length;
      const k = seed === 0 ? 0 : Math.floor(hash01(seed, `pick:${item.id}`) * options) % options;
      if (k >= fitting.length) return { pick: { type: 'any-episode' }, minutes: runtime };
      const e = fitting[k];
      return { pick: { type: 'episode', season: e.season, episode: e.episode, name: e.name }, minutes: e.runtime ?? runtime };
    }
  }
  if (runtime > limit) return null;
  return { pick: item.dropIn ? { type: 'any-episode' } : { type: 'series-start' }, minutes: runtime };
}

export function choosePick(item: CatalogItem, req: SuggestRequest, ctx: EngineContext, seed = 0): PickResult | null {
  const limit = TIME_LIMIT_MINUTES[req.time] ?? 0;
  return pickFor(item, limit, seenByAll(item.id, req.who, ctx), seed);
}

// ---------------------------------------------------------------------------
// All gates together
// ---------------------------------------------------------------------------

/** Rule 3: Background and While eating are identical — low attention only. */
export const attentionOk = (item: CatalogItem, req: SuggestRequest): boolean =>
  req.viewing === 'focused' || item.attention === 'low';

/** Rule 5. ('either' is not a gate: it only shapes the mix, see rank.ts.) */
export function noveltyOk(itemId: string, req: SuggestRequest, ctx: EngineContext): boolean {
  if (req.novelty === 'either') return true;
  const seen = seenByAny(itemId, req.who, ctx);
  return req.novelty === 'new' ? !seen : seen;
}

export function isEligible(item: CatalogItem, req: SuggestRequest, ctx: EngineContext): boolean {
  if (!chooseService(item, ctx.state.settings?.plans)) return false; // rule 1
  if (req.mood === 'scared' && !scaredOffered(req.who, ctx)) return false; // rule 2
  if (hitsDealbreaker(item, req.who, ctx)) return false; // rule 2
  if (!attentionOk(item, req)) return false; // rule 3
  if (!noveltyOk(item.id, req, ctx)) return false; // rule 5
  if (isNeverHidden(item.id, req.who, ctx)) return false; // rule 7
  if (isNotTonight(item.id, req.who, ctx)) return false;
  if (isPicked(item.id, req.who, ctx)) return false; // already on the Matches tab
  return choosePick(item, req, ctx) !== null; // rule 4
}
