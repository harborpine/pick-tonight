/**
 * THE HARD RULES. Everything in this file is a yes/no gate; nothing here is
 * about taste. A title that fails any gate can never appear in a deck, no
 * matter how well it scores. The numbered rules match SPEC.md and the
 * `describe` blocks in rules.test.ts.
 *
 *  1. Only titles included in the household's selected plans.
 *  2. Any watcher's "never show me" choices (horror / true crime / scary / whole
 *     genres / anything not originally in English) exclude a title for the whole
 *     audience; the "scared" mood only exists for audiences where nobody has a
 *     horror or scary choice.
 *  3. Background and While eating: only low-attention titles.
 *  4. Nothing longer than the time available.
 *  5. New = nobody watching has seen it. Rewatch = at least one watcher has.
 *  6. When several of our services carry a title, an ad-free one is chosen.
 *  7. Never: hidden for any audience containing someone who tapped it; hidden
 *     everywhere once every member of the household has tapped it.
 *  8. Picked: a title sitting on the Matches tab is left out for any audience
 *     that shares a member with the people it was picked for.
 *  +  "Not tonight" hides a title on that date for any audience containing the
 *     person who swiped it.
 *
 * Nothing here knows how many people are in the household or what they are
 * called: an audience (`Who`) is a list of member ids, and every per-person
 * check simply runs over that list.
 */
import {
  MOODS,
  NO_DEALBREAKERS,
  SERVICES,
  TIME_LIMIT_MINUTES,
  watchers,
  type CatalogItem,
  type Dealbreakers,
  type EngineContext,
  type GenreId,
  type MemberId,
  type MoodId,
  type PlanSelection,
  type ServiceChoice,
  type StandoutEpisode,
  type SuggestRequest,
  type WatchPick,
  type Who,
} from '../contracts';
import { hash01, SmallCache } from './util';

const own = (map: object | undefined | null, key: string): boolean => !!map && Object.prototype.hasOwnProperty.call(map, key);

// ---------------------------------------------------------------------------
// Rules 1 and 6: plans and service choice
// ---------------------------------------------------------------------------

interface Ranked {
  rank: number;
  choice: ServiceChoice;
}

const planCache = new SmallCache<Map<number, Ranked>>(8);

/**
 * The household's plans ranked: ad-free ones first, otherwise in the order of
 * SERVICES (whatever services that list holds — it is data, and `plans` may
 * name any subset of it). Each provider id maps to the best-ranked plan that
 * includes it, so "the best-ranked plan carrying the title" is always an
 * ad-free one when any ad-free option exists, and the choice among equals is
 * always the same, whatever order the catalog lists a title's providers in.
 */
function planLookup(plans: PlanSelection | undefined): Map<number, Ranked> {
  let key = '';
  for (const s of SERVICES) {
    const p = plans?.[s.id];
    if (p) key += `${s.id}=${p}|`;
  }
  return planCache.get(key, () => {
    const active: { choice: ServiceChoice; providerIds: number[] }[] = [];
    for (const svc of SERVICES) {
      const planId = plans?.[svc.id];
      if (!planId) continue; // missing or null: not subscribed, contributes nothing
      const plan = svc.plans.find((p) => p.id === planId);
      if (!plan) continue; // unknown plan id: treat as not subscribed (safe side)
      active.push({ choice: { serviceId: svc.id, planId: plan.id, adFree: plan.adFree }, providerIds: plan.providerIds });
    }
    // Stable sort: ad-free first, SERVICES order preserved within each group.
    active.sort((a, b) => Number(b.choice.adFree) - Number(a.choice.adFree));
    const byProvider = new Map<number, Ranked>();
    active.forEach((p, rank) => {
      for (const id of p.providerIds) if (!byProvider.has(id)) byProvider.set(id, { rank, choice: p.choice });
    });
    return byProvider;
  });
}

export function chooseService(item: CatalogItem, plans: PlanSelection): ServiceChoice | null {
  const byProvider = planLookup(plans);
  if (!byProvider.size) return null;
  let best: Ranked | null = null;
  for (const id of item.providers ?? []) {
    const hit = byProvider.get(id);
    if (hit && (!best || hit.rank < best.rank)) best = hit;
  }
  return best ? { ...best.choice } : null;
}

// ---------------------------------------------------------------------------
// Rule 2: "never show me" choices and the scared mood
// ---------------------------------------------------------------------------

/** A person's "never show me" choices. Someone with no profile yet has none. */
export function dealbreakersOf(person: MemberId, ctx: EngineContext): Dealbreakers {
  return ctx.state.profiles?.[person]?.dealbreakers ?? NO_DEALBREAKERS;
}

/** Excluding the horror GENRE is a horror choice like the dedicated switch (it also takes the Scared mood away). */
const noHorror = (d: Dealbreakers): boolean => !!d.horror || (Array.isArray(d.genres) && d.genres.includes('horror'));

/** Everything the audience between them never want to see: one watcher's choice counts for all. */
export interface AudienceDealbreakers {
  horror: boolean;
  trueCrime: boolean;
  scary: boolean;
  /** null when nobody has excluded a genre. */
  genres: Set<GenreId> | null;
  subtitled: boolean;
}

export function audienceDealbreakers(who: Who, ctx: EngineContext): AudienceDealbreakers {
  const out: AudienceDealbreakers = { horror: false, trueCrime: false, scary: false, genres: null, subtitled: false };
  for (const p of watchers(who)) {
    const d = dealbreakersOf(p, ctx);
    if (noHorror(d)) out.horror = true;
    if (d.trueCrime) out.trueCrime = true;
    if (d.scary) out.scary = true;
    if (d.subtitled) out.subtitled = true;
    // (A profile saved without a genre list has none.)
    for (const g of Array.isArray(d.genres) ? d.genres : []) (out.genres ??= new Set()).add(g);
  }
  return out;
}

/**
 * "Not originally in English": the catalog gives every title its original
 * language, and anything other than English counts. Only a KNOWN other
 * language excludes: a title whose language the catalog failed to record is
 * not thrown out on a guess.
 */
export function isSubtitled(item: CatalogItem): boolean {
  const lang = typeof item.lang === 'string' ? item.lang.trim().toLowerCase() : '';
  return lang !== '' && lang !== 'en' && !lang.startsWith('en-');
}

export function breaksAny(item: CatalogItem, d: AudienceDealbreakers): boolean {
  const f = item.flags;
  if (f && ((d.horror && f.horror) || (d.trueCrime && f.trueCrime) || (d.scary && f.scary))) return true;
  if (d.subtitled && isSubtitled(item)) return true;
  if (d.genres) for (const g of item.genres ?? []) if (d.genres.has(g)) return true;
  return false;
}

export function hitsDealbreaker(item: CatalogItem, who: Who, ctx: EngineContext): boolean {
  return breaksAny(item, audienceDealbreakers(who, ctx));
}

/** The scared mood is offered only when nobody watching has a horror or scary choice. */
export function scaredOffered(who: Who, ctx: EngineContext): boolean {
  return watchers(who).every((p) => {
    const d = dealbreakersOf(p, ctx);
    return !noHorror(d) && !d.scary;
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
export function hasSeen(person: MemberId, itemId: string, ctx: EngineContext): boolean {
  if (own(ctx.state.seen?.[person], itemId)) return true;
  return ctx.state.profiles?.[person]?.favorites?.some((f) => f?.id === itemId) ?? false;
}

/** The same answer as hasSeen, for many titles in a row (one pass over the favourites instead of one per title). */
export function seenChecker(person: MemberId, ctx: EngineContext): (itemId: string) => boolean {
  const seen = ctx.state.seen?.[person];
  const favs = new Set<string>();
  for (const f of ctx.state.profiles?.[person]?.favorites ?? []) if (f && typeof f.id === 'string') favs.add(f.id);
  return (itemId) => own(seen, itemId) || favs.has(itemId);
}

/** Timestamps before this (1 Jan 2000) are placeholders, not real dates. */
const REAL_DATE_FROM = 946684800000;

/**
 * When the person last watched the title (ms), or null when it is not on their
 * watched list or the entry carries no real date. Tolerates a bare timestamp
 * in place of the entry object.
 */
export function watchedAt(person: MemberId, itemId: string, ctx: EngineContext): number | null {
  const seen = ctx.state.seen?.[person];
  if (!own(seen, itemId)) return null;
  const entry = seen[itemId] as unknown;
  const at = typeof entry === 'number' ? entry : (entry as { at?: unknown } | null)?.at;
  return typeof at === 'number' && Number.isFinite(at) && at >= REAL_DATE_FROM ? at : null;
}

// ---------------------------------------------------------------------------
// Rule 8: picked (the Matches tab)
// ---------------------------------------------------------------------------

/**
 * Item ids that are sitting on the Matches tab for this audience: a pick whose
 * own audience shares at least one person with `who`. So one person's solo
 * pick hides the title from them and from every group they watch in, but not
 * from the others watching without them; a match hides it from every audience
 * containing anyone who was in that session.
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
    const forWhom: MemberId[] = Array.isArray(pick.who) ? pick.who : typeof pick.who === 'string' ? [pick.who] : [];
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

function tappedNever(person: MemberId, itemId: string, ctx: EngineContext): boolean {
  return own(ctx.state.never?.[person], itemId);
}

/** The whole household's member ids (the people Rule 7's "everyone" means). */
function household(ctx: EngineContext): MemberId[] {
  return Object.keys(ctx.state.members ?? {});
}

/**
 * Rule 7. Hidden for any audience containing someone who tapped Never, and
 * hidden for EVERY audience once every member of the household has tapped it
 * (so in a household of one, that person's Never hides it everywhere).
 */
export function isNeverHidden(itemId: string, who: Who, ctx: EngineContext): boolean {
  for (const p of watchers(who)) if (tappedNever(p, itemId, ctx)) return true;
  const all = household(ctx);
  return all.length > 0 && all.every((p) => tappedNever(p, itemId, ctx));
}

/** The same rule for many titles in a row. */
export function neverChecker(who: Who, ctx: EngineContext): (itemId: string) => boolean {
  const lists = watchers(who)
    .map((p) => ctx.state.never?.[p])
    .filter((m): m is Record<string, number> => !!m && Object.keys(m).length > 0);
  // Titles every member of the household has tapped: found by walking the shortest list.
  const everyone = new Set<string>();
  const all = household(ctx).map((p) => ctx.state.never?.[p]);
  if (all.length && all.every((m) => !!m)) {
    const maps = all as Record<string, number>[];
    const shortest = maps.reduce((a, b) => (Object.keys(b).length < Object.keys(a).length ? b : a));
    for (const id of Object.keys(shortest)) if (maps.every((m) => own(m, id))) everyone.add(id);
  }
  if (!lists.length && !everyone.size) return () => false;
  return (itemId) => everyone.has(itemId) || lists.some((m) => own(m, itemId));
}

/** Hidden only on the date it was swiped; it comes back another day. */
export function isNotTonight(itemId: string, who: Who, ctx: EngineContext): boolean {
  for (const p of watchers(who)) {
    const map = ctx.state.notTonight?.[p];
    if (own(map, itemId) && map[itemId] === ctx.today) return true;
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
  if (!watchers(req.who).length) return false; // nobody watching: nothing to suggest
  if (!chooseService(item, ctx.state.settings?.plans)) return false; // rule 1
  if (req.mood === 'scared' && !scaredOffered(req.who, ctx)) return false; // rule 2
  if (hitsDealbreaker(item, req.who, ctx)) return false; // rule 2
  if (!attentionOk(item, req)) return false; // rule 3
  if (!noveltyOk(item.id, req, ctx)) return false; // rule 5
  if (isNeverHidden(item.id, req.who, ctx)) return false; // rule 7
  if (isNotTonight(item.id, req.who, ctx)) return false;
  if (isPicked(item.id, req.who, ctx)) return false; // rule 8
  return choosePick(item, req, ctx) !== null; // rule 4
}
