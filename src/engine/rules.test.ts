/**
 * THE SEVEN RULES (SPEC.md "Rules that must hold"), one `describe` per rule.
 *
 * Each rule is tested two ways:
 *  - named examples from the sample catalog, and
 *  - a sweep over EVERY combination of who x viewing x mood x time x novelty
 *    (1,080 requests) under several household setups, checking every card of
 *    every deck with an independent checker written here from the spec — it
 *    does not call the engine's own eligibility code.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANS,
  MOODS,
  SERVICES,
  TIME_LIMIT_MINUTES,
  watchers,
  type CatalogItem,
  type DeckCard,
  type EngineContext,
  type GenreId,
  type Novelty,
  type PersonId,
  type PlanSelection,
  type SuggestRequest,
  type TimeBudget,
  type ViewingType,
  type Who,
} from '../contracts';
import { FIXTURE_CATALOG, FIXTURE_NEW_ARRIVALS } from '../contracts/fixtures/catalog';
import { createEngine } from './index';
import { itemsById, makeCtx, req, TODAY } from './testkit';

const engine = createEngine();
const byId = itemsById(FIXTURE_CATALOG);
const ids = (deck: DeckCard[]) => deck.map((c) => c.itemId);
const item = (id: string): CatalogItem => {
  const i = byId.get(id);
  if (!i) throw new Error(`no fixture item ${id}`);
  return i;
};

// Sample-catalog titles used below.
const HIMYM = 'tv-1100'; // Hulu (ads) + Netflix (ad-free)
const SOUTH_PARK = 'tv-2190'; // Paramount+ (ads) + HBO Max (ads)
const POKER_FACE = 'tv-120998'; // Peacock Premium Plus only
const YELLOWJACKETS = 'tv-117488'; // Paramount+ Premium only
const GLASS_ONION = 'movie-661374'; // Netflix ad-free + Netflix with ads
const COMMUNITY = 'tv-18347'; // Netflix + Hulu + Peacock
const ABBOTT = 'tv-125935'; // Hulu + HBO Max
const GOT = 'tv-1399'; // high attention, 57 min
const SUCCESSION = 'tv-76331'; // high attention, 60 min
const BLACK_MIRROR = 'tv-42009'; // 60 min, standout episode of 61 min
const SCRUBS = 'tv-4556'; // HG favourite, standout episode
const FRIENDS = 'tv-1668'; // BG favourite
const OFFICE = 'tv-2316'; // nobody's favourite
const PARKS = 'tv-8592';
const GET_OUT = 'movie-419430'; // horror + scary
const HILL_HOUSE = 'tv-72844'; // horror + scary
const STRANGER = 'tv-66732'; // scary, not horror
const DARK = 'tv-70523'; // scary, not horror
const MAKING_A_MURDERER = 'tv-64439'; // true crime
const DATELINE = 'tv-4601'; // true crime, low attention
const FAMILY_GUY = 'tv-1434'; // favourite of both
const PADDINGTON = 'movie-346648';

// ---------------------------------------------------------------------------
// The independent checker and the sweep
// ---------------------------------------------------------------------------

const WHO: Who[] = ['HG', 'BG', 'Together'];
const VIEWING: ViewingType[] = ['focused', 'background', 'eating'];
const TIMES: TimeBudget[] = [20, 45, 60, 120];
const NOVELTY: Novelty[] = ['new', 'rewatch', 'either'];
const ALL_MOODS = MOODS.map((m) => m.id);

function everyRequest(genre: GenreId | null = null): SuggestRequest[] {
  const out: SuggestRequest[] = [];
  for (const who of WHO) for (const viewing of VIEWING) for (const mood of ALL_MOODS) for (const time of TIMES) for (const novelty of NOVELTY) out.push({ who, viewing, mood, time, novelty, genre });
  return out;
}

/** The household's plan for each service, straight from the settings. */
function householdPlans(plans: PlanSelection) {
  return SERVICES.flatMap((s) => {
    const p = s.plans.find((x) => x.id === plans[s.id]);
    return p ? [{ serviceId: s.id, plan: p }] : [];
  });
}
const carriedBy = (i: CatalogItem, plans: PlanSelection) => householdPlans(plans).filter((h) => h.plan.providerIds.some((id) => i.providers.includes(id)));
const seenBy = (p: PersonId, id: string, ctx: EngineContext) => id in ctx.state.seen[p] || ctx.state.profiles[p].favorites.includes(id);

type Rule = 'rule1' | 'rule2' | 'rule3' | 'rule4' | 'rule5' | 'rule6' | 'rule7' | 'notTonight';

/** Every rule a card breaks, checked from first principles. */
function violations(card: DeckCard, r: SuggestRequest, ctx: EngineContext): Rule[] {
  const out: Rule[] = [];
  const i = ctx.catalog.items.find((x) => x.id === card.itemId);
  if (!i) return ['rule1'];
  const people = watchers(r.who);
  const plans = ctx.state.settings.plans;

  // 1. on a selected plan, and the service shown really is one of ours carrying it
  const carriers = carriedBy(i, plans);
  const shown = carriers.find((c) => c.serviceId === card.service.serviceId && c.plan.id === card.service.planId);
  if (!carriers.length || !shown) out.push('rule1');

  // 2. dealbreakers; scared only for audiences with no horror/scary dealbreaker
  for (const p of people) {
    const d = ctx.state.profiles[p].dealbreakers;
    if ((d.horror && i.flags.horror) || (d.trueCrime && i.flags.trueCrime) || (d.scary && i.flags.scary)) out.push('rule2');
    if (r.mood === 'scared' && (d.horror || d.scary)) out.push('rule2');
  }

  // 3. background / eating: low attention only
  if (r.viewing !== 'focused' && i.attention !== 'low') out.push('rule3');

  // 4. fits the time
  const limit = TIME_LIMIT_MINUTES[r.time];
  if (card.minutes > limit) out.push('rule4');
  if (card.pick.type === 'episode') {
    const pick = card.pick;
    const ep = i.standout.find((e) => e.season === pick.season && e.episode === pick.episode && e.name === pick.name);
    if (!ep || (ep.runtime ?? i.runtime) > limit || card.minutes !== (ep.runtime ?? i.runtime)) out.push('rule4');
  } else {
    if (i.runtime > limit || card.minutes !== i.runtime) out.push('rule4');
    if ((card.pick.type === 'movie') !== (i.kind === 'movie')) out.push('rule4');
  }

  // 5. new / rewatch
  const anySeen = people.some((p) => seenBy(p, i.id, ctx));
  if (r.novelty === 'new' && anySeen) out.push('rule5');
  if (r.novelty === 'rewatch' && !anySeen) out.push('rule5');

  // 6. ad-free wins
  if (shown && carriers.some((c) => c.plan.adFree) && !(shown.plan.adFree && card.service.adFree)) out.push('rule6');
  if (shown && card.service.adFree !== shown.plan.adFree) out.push('rule6');

  // 7. never
  const nHG = i.id in ctx.state.never.HG;
  const nBG = i.id in ctx.state.never.BG;
  if ((nHG && nBG) || (r.who === 'Together' && (nHG || nBG)) || (r.who === 'HG' && nHG) || (r.who === 'BG' && nBG)) out.push('rule7');

  // not tonight
  if (people.some((p) => ctx.state.notTonight[p][i.id] === ctx.today)) out.push('notTonight');
  return out;
}

/** Household setups the sweep runs under. */
function setups(): { name: string; ctx: EngineContext }[] {
  const fresh = makeCtx();

  const livedIn = makeCtx({
    seen: { HG: [OFFICE, 'movie-27205', PADDINGTON, STRANGER, 'tv-68595'], BG: [OFFICE, PARKS, 'tv-91239', 'movie-11036', 'tv-82728'] },
    never: { HG: ['tv-32726', 'tv-61662', SUCCESSION], BG: ['tv-61662', 'tv-48891', 'movie-8363'] },
    notTonight: { HG: { [ABBOTT]: TODAY, 'movie-546554': '2026-10-09' }, BG: { 'tv-4586': TODAY, 'movie-455207': '2026-10-01' } },
  });

  const otherPlans = makeCtx({
    plans: { netflix: 'ads', disney: null, hulu: 'noads', hbo: 'adfree', peacock: 'premium-plus', paramount: 'premium' },
    seen: { HG: [POKER_FACE], BG: [YELLOWJACKETS] },
  });

  // The rule is about each person's dealbreakers, not their names: swap them round.
  const swapped = makeCtx({ seen: { HG: [GET_OUT], BG: [HILL_HOUSE, DATELINE] } });
  swapped.state.profiles.HG.dealbreakers = { horror: true, trueCrime: false, scary: true };
  swapped.state.profiles.BG.dealbreakers = { horror: false, trueCrime: false, scary: false };

  const fewServices = makeCtx({ plans: { netflix: null, disney: null, hulu: null, hbo: 'ads', peacock: null, paramount: 'essential' } });

  return [
    { name: 'fresh household', ctx: fresh },
    { name: 'lived-in household (seen, never, not tonight)', ctx: livedIn },
    { name: 'different plans', ctx: otherPlans },
    { name: 'dealbreakers swapped', ctx: swapped },
    { name: 'only two services', ctx: fewServices },
  ];
}

/** Runs the whole sweep once and remembers what broke, so each rule's test can report its own part. */
const sweep = (() => {
  let cache: { cards: number; decks: number; broken: Map<Rule, string[]> } | null = null;
  return () => {
    if (cache) return cache;
    const broken = new Map<Rule, string[]>();
    let cards = 0;
    let decks = 0;
    for (const { name, ctx } of setups()) {
      const variants: { genre: GenreId | null; seed: number }[] = [
        { genre: null, seed: 0 },
        { genre: null, seed: 7 },
        { genre: 'comedy', seed: 0 },
        { genre: 'reality', seed: 3 },
      ];
      for (const v of variants) {
        for (const r of everyRequest(v.genre)) {
          const deck = engine.buildDeck(r, ctx, { seed: v.seed, limit: 100 });
          decks++;
          for (const card of deck) {
            cards++;
            for (const rule of violations(card, r, ctx)) {
              const list = broken.get(rule) ?? [];
              if (list.length < 5) list.push(`${name}: ${card.itemId} in ${JSON.stringify(r)}`);
              broken.set(rule, list);
            }
            // isEligible must agree with what buildDeck returns.
            const i = ctx.catalog.items.find((x) => x.id === card.itemId)!;
            if (!engine.isEligible(i, r, ctx)) {
              const list = broken.get('rule1') ?? [];
              list.push(`${name}: buildDeck returned ${card.itemId} that isEligible rejects for ${JSON.stringify(r)}`);
              broken.set('rule1', list);
            }
          }
        }
      }
    }
    cache = { cards, decks, broken };
    return cache;
  };
})();

const sweepFinds = (rule: Rule) => sweep().broken.get(rule) ?? [];

describe('the sweep itself', () => {
  it('covers every request combination under every setup, and actually deals cards', () => {
    const s = sweep();
    expect(s.decks).toBe(5 * 4 * 1080);
    expect(s.cards).toBeGreaterThan(50_000);
  }, 120_000);

  it('the independent checker really catches each kind of violation (so a clean sweep means something)', () => {
    const ctx = makeCtx({ never: { HG: [OFFICE] }, seen: { HG: [PARKS] }, notTonight: { HG: { [ABBOTT]: TODAY } } });
    const card = (id: string, over: Partial<DeckCard> = {}): DeckCard => ({
      itemId: id,
      pick: { type: item(id).kind === 'movie' ? 'movie' : 'any-episode' },
      service: engine.chooseService(item(id), DEFAULT_PLANS) ?? { serviceId: 'netflix', planId: 'standard', adFree: true },
      minutes: item(id).runtime,
      score: 1,
      reasons: [],
      ...over,
    });
    expect(violations(card(POKER_FACE), req(), ctx)).toContain('rule1');
    expect(violations(card(GET_OUT), req({ who: 'BG' }), ctx)).toContain('rule2');
    expect(violations(card(FRIENDS), req({ who: 'Together', mood: 'scared' }), ctx)).toContain('rule2');
    expect(violations(card(GOT), req({ viewing: 'background' }), ctx)).toContain('rule3');
    expect(violations(card(GOT), req({ time: 20 }), ctx)).toContain('rule4');
    expect(violations(card(SCRUBS), req({ novelty: 'new' }), ctx)).toContain('rule5');
    expect(violations(card(FRIENDS), req({ novelty: 'rewatch' }), ctx)).toContain('rule5');
    expect(violations(card(HIMYM, { service: { serviceId: 'hulu', planId: 'ads', adFree: false } }), req(), ctx)).toContain('rule6');
    expect(violations(card(OFFICE), req(), ctx)).toContain('rule7');
    expect(violations(card(ABBOTT), req(), ctx)).toContain('notTonight');
    expect(violations(card(FRIENDS), req(), ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Rule 1: nothing is suggested that is not included in our plans', () => {
  it('titles only on a higher tier (Peacock Premium Plus, Paramount+ Premium) have no service and are not eligible', () => {
    const ctx = makeCtx();
    expect(engine.chooseService(item(POKER_FACE), DEFAULT_PLANS)).toBeNull();
    expect(engine.chooseService(item(YELLOWJACKETS), DEFAULT_PLANS)).toBeNull();
    for (const r of everyRequest()) {
      expect(engine.isEligible(item(POKER_FACE), r, ctx)).toBe(false);
      expect(engine.isEligible(item(YELLOWJACKETS), r, ctx)).toBe(false);
    }
  });

  it('they never appear in any deck with our plans', () => {
    const ctx = makeCtx();
    for (const r of everyRequest()) {
      const deck = ids(engine.buildDeck(r, ctx, { limit: 100 }));
      expect(deck).not.toContain(POKER_FACE);
      expect(deck).not.toContain(YELLOWJACKETS);
    }
  });

  it('changing the plan in settings changes what is included', () => {
    const upgraded = makeCtx({ plans: { ...DEFAULT_PLANS, peacock: 'premium-plus' } });
    expect(engine.chooseService(item(POKER_FACE), upgraded.state.settings.plans)).toEqual({ serviceId: 'peacock', planId: 'premium-plus', adFree: true });
    expect(ids(engine.buildDeck(req({ mood: 'gripped' }), upgraded, { limit: 100 }))).toContain(POKER_FACE);
  });

  it('a service we are not subscribed to contributes nothing', () => {
    const noNetflix = makeCtx({ plans: { ...DEFAULT_PLANS, netflix: null } });
    const netflixOnly = FIXTURE_CATALOG.items.filter((i) => i.providers.every((p) => p === 8 || p === 1796));
    expect(netflixOnly.length).toBeGreaterThan(5);
    for (const i of netflixOnly) expect(engine.chooseService(i, noNetflix.state.settings.plans)).toBeNull();
    for (const r of everyRequest()) {
      for (const c of engine.buildDeck(r, noNetflix, { limit: 100 })) {
        expect(c.service.serviceId).not.toBe('netflix');
        expect(netflixOnly.map((i) => i.id)).not.toContain(c.itemId);
      }
    }
    // HIMYM is still reachable through Hulu.
    expect(engine.chooseService(item(HIMYM), noNetflix.state.settings.plans)?.serviceId).toBe('hulu');
  });

  it('no subscriptions at all means an empty deck; an unknown plan id counts as not subscribed', () => {
    const none = makeCtx({ plans: { netflix: null, disney: null, hulu: null, hbo: null, peacock: null, paramount: null } });
    expect(engine.buildDeck(req(), none)).toEqual([]);
    const bogus = { ...DEFAULT_PLANS, netflix: 'no-such-plan' };
    expect(engine.chooseService(item(PADDINGTON), bogus)).toBeNull();
  });

  it('the New feed and the first-run grid also leave out titles that are not on our plans', () => {
    const ctx = makeCtx();
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'HG', ctx).map((c) => c.itemId)).not.toContain(POKER_FACE);
    const grid = engine.onboardingTitles(FIXTURE_CATALOG, DEFAULT_PLANS, 100).map((i) => i.id);
    expect(grid).not.toContain(POKER_FACE);
    expect(grid).not.toContain(YELLOWJACKETS);
  });

  it('SWEEP: every card in every deck is on a selected plan and shows one of our services', () => {
    expect(sweepFinds('rule1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Rule 2: BG alone or Together — no horror, no true crime, nothing scary', () => {
  const flagged = [GET_OUT, HILL_HOUSE, STRANGER, DARK, MAKING_A_MURDERER, DATELINE];

  it('BG and Together never get horror, true-crime or scary titles, whatever they ask for', () => {
    const ctx = makeCtx();
    for (const r of everyRequest()) {
      if (r.who === 'HG') continue;
      const deck = ids(engine.buildDeck(r, ctx, { limit: 100 }));
      for (const id of flagged) expect(deck).not.toContain(id);
      for (const id of flagged) expect(engine.isEligible(item(id), r, ctx)).toBe(false);
    }
  });

  it('HG alone can get them', () => {
    const ctx = makeCtx();
    const deck = ids(engine.buildDeck(req({ who: 'HG', mood: 'gripped' }), ctx, { limit: 100 }));
    expect(deck).toContain(STRANGER);
    expect(deck).toContain(MAKING_A_MURDERER);
    expect(deck).toContain(GET_OUT);
  });

  it('a thriller that is not scary stays available to BG (Killing Eve)', () => {
    const ctx = makeCtx();
    expect(engine.isEligible(item('tv-72750'), req({ who: 'BG', mood: 'gripped', novelty: 'either' }), ctx)).toBe(true);
  });

  it('the Scared mood is only offered when HG is watching alone', () => {
    const ctx = makeCtx();
    expect(engine.availableMoods('HG', ctx)).toContain('scared');
    expect(engine.availableMoods('BG', ctx)).not.toContain('scared');
    expect(engine.availableMoods('Together', ctx)).not.toContain('scared');
    expect(engine.availableMoods('BG', ctx)).toHaveLength(MOODS.length - 1);
    expect(engine.availableMoods('HG', ctx)).toEqual(MOODS.map((m) => m.id));
  });

  it('a Scared request from BG or Together returns an empty deck rather than leaking anything', () => {
    const ctx = makeCtx();
    for (const who of ['BG', 'Together'] as const) {
      for (const viewing of VIEWING) for (const time of TIMES) for (const novelty of NOVELTY) {
        const r = req({ who, mood: 'scared', viewing, time, novelty });
        expect(engine.buildDeck(r, ctx, { limit: 100 })).toEqual([]);
        for (const i of FIXTURE_CATALOG.items) expect(engine.isEligible(i, r, ctx)).toBe(false);
      }
    }
  });

  it("HG's Scared deck contains only scary titles", () => {
    const deck = engine.buildDeck(req({ who: 'HG', mood: 'scared' }), makeCtx(), { limit: 100 });
    expect(deck.length).toBeGreaterThan(0);
    for (const c of deck) expect(item(c.itemId).moods.scared ?? 0).toBeGreaterThan(0);
    expect(ids(deck)).toContain(HILL_HOUSE);
    expect(ids(deck)).toContain(GET_OUT);
  });

  it('the rule follows the dealbreakers on the profile: each one works on its own', () => {
    const ctx = makeCtx();
    ctx.state.profiles.BG.dealbreakers = { horror: false, trueCrime: true, scary: false };
    const r = req({ who: 'BG', mood: 'gripped', novelty: 'either' });
    expect(engine.isEligible(item(MAKING_A_MURDERER), r, ctx)).toBe(false); // true crime still out
    expect(engine.isEligible(item(STRANGER), r, ctx)).toBe(true); // scary now allowed
    expect(engine.availableMoods('BG', ctx)).toContain('scared');
    ctx.state.profiles.HG.dealbreakers = { horror: true, trueCrime: false, scary: false };
    expect(engine.availableMoods('HG', ctx)).not.toContain('scared');
    expect(engine.isEligible(item(GET_OUT), req({ who: 'HG', mood: 'gripped' }), ctx)).toBe(false);
    expect(engine.isEligible(item(GET_OUT), req({ who: 'Together', mood: 'gripped' }), ctx)).toBe(false);
  });

  it('the New feed hides them from BG and Together too', () => {
    const ctx = makeCtx();
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'HG', ctx).map((c) => c.itemId)).toContain(GET_OUT);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'BG', ctx).map((c) => c.itemId)).not.toContain(GET_OUT);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'Together', ctx).map((c) => c.itemId)).not.toContain(GET_OUT);
  });

  it('SWEEP: no card ever breaks a watcher’s dealbreaker, and no Scared deck is dealt to an audience not offered it', () => {
    expect(sweepFinds('rule2')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Rule 3: Background and While eating never return medium- or high-attention titles', () => {
  it('only low-attention titles are eligible for Background and While eating', () => {
    const ctx = makeCtx();
    for (const viewing of ['background', 'eating'] as const) {
      for (const i of FIXTURE_CATALOG.items) {
        if (i.attention !== 'low') expect(engine.isEligible(i, req({ viewing, mood: 'gripped', novelty: 'either' }), ctx)).toBe(false);
      }
      for (const mood of ALL_MOODS) {
        for (const c of engine.buildDeck(req({ viewing, mood }), ctx, { limit: 100 })) expect(item(c.itemId).attention).toBe('low');
      }
    }
  });

  it('Game of Thrones (complicated) is Focused only; Family Guy (easy) is fine for every viewing type', () => {
    const ctx = makeCtx();
    expect(engine.isEligible(item(GOT), req({ viewing: 'focused', mood: 'gripped' }), ctx)).toBe(true);
    expect(engine.isEligible(item(GOT), req({ viewing: 'background', mood: 'gripped' }), ctx)).toBe(false);
    expect(engine.isEligible(item(GOT), req({ viewing: 'eating', mood: 'gripped' }), ctx)).toBe(false);
    for (const viewing of VIEWING) expect(engine.isEligible(item(FAMILY_GUY), req({ viewing }), ctx)).toBe(true);
  });

  it('low-attention titles are eligible for every viewing type (and do appear in Focused decks)', () => {
    const ctx = makeCtx();
    const low = FIXTURE_CATALOG.items.filter((i) => i.attention === 'low' && engine.chooseService(i, DEFAULT_PLANS) && !i.flags.trueCrime);
    for (const i of low) for (const viewing of VIEWING) expect(engine.isEligible(i, req({ viewing, time: 120 }), ctx)).toBe(true);
    const focused = engine.buildDeck(req({ viewing: 'focused', mood: 'laugh' }), ctx, { limit: 100 });
    expect(focused.some((c) => item(c.itemId).attention === 'low')).toBe(true);
  });

  it('While eating behaves exactly like Background', () => {
    for (const { ctx } of setups()) {
      for (const r of everyRequest()) {
        if (r.viewing !== 'background') continue;
        expect(engine.buildDeck({ ...r, viewing: 'eating' }, ctx, { limit: 100 })).toEqual(engine.buildDeck(r, ctx, { limit: 100 }));
      }
    }
  });

  it('SWEEP: every Background / While eating card is low attention', () => {
    expect(sweepFinds('rule3')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Rule 4: nothing longer than the time available', () => {
  it('uses episode length for shows and runtime for films', () => {
    const ctx = makeCtx();
    // 22-minute sitcom: fine for "about 20 min" (limit 25). 57-minute drama: needs "1 hr".
    expect(engine.isEligible(item(OFFICE), req({ time: 20 }), ctx)).toBe(true);
    expect(engine.isEligible(item(GOT), req({ time: 20, mood: 'gripped' }), ctx)).toBe(false);
    expect(engine.isEligible(item(GOT), req({ time: 45, mood: 'gripped' }), ctx)).toBe(false);
    expect(engine.isEligible(item(GOT), req({ time: 60, mood: 'gripped' }), ctx)).toBe(true);
    // A 104-minute film only fits "2+ hrs".
    for (const time of [20, 45, 60] as const) expect(engine.isEligible(item(PADDINGTON), req({ time, mood: 'feelgood' }), ctx)).toBe(false);
    expect(engine.isEligible(item(PADDINGTON), req({ time: 120, mood: 'feelgood' }), ctx)).toBe(true);
    // The 30-minute Wallace & Gromit film fits 45 minutes but not 20.
    expect(engine.isEligible(item('movie-531'), req({ time: 45 }), ctx)).toBe(true);
    expect(engine.isEligible(item('movie-531'), req({ time: 20 }), ctx)).toBe(false);
  });

  it('choosePick returns null when nothing about the title fits, and reports the minutes when it does', () => {
    const ctx = makeCtx();
    expect(engine.choosePick(item(GOT), req({ time: 45 }), ctx)).toBeNull();
    expect(engine.choosePick(item(GOT), req({ time: 60 }), ctx)).toEqual({ pick: { type: 'series-start' }, minutes: 57 });
    expect(engine.choosePick(item(PADDINGTON), req({ time: 120 }), ctx)).toEqual({ pick: { type: 'movie' }, minutes: 104 });
    expect(engine.choosePick(item(PADDINGTON), req({ time: 60 }), ctx)).toBeNull();
  });

  it('every deck respects the limit for every time budget', () => {
    const ctx = makeCtx();
    for (const time of TIMES) for (const mood of ALL_MOODS) {
      for (const c of engine.buildDeck(req({ time, mood }), ctx, { limit: 100 })) {
        expect(c.minutes).toBeLessThanOrEqual(TIME_LIMIT_MINUTES[time]);
      }
    }
  });

  it("a standout episode is only named when its own length fits", () => {
    // Black Mirror: 60-minute show whose standout episode runs 61 minutes.
    const ctx = makeCtx();
    expect(engine.choosePick(item(BLACK_MIRROR), req({ time: 60 }), ctx)).toEqual({
      pick: { type: 'episode', season: 3, episode: 4, name: 'San Junipero' },
      minutes: 61,
    });
    expect(engine.choosePick(item(BLACK_MIRROR), req({ time: 45 }), ctx)).toBeNull();

    // A 22-minute sitcom whose standout is a 44-minute special: with 20 minutes, fall back to "any episode".
    const special: CatalogItem = { ...item(OFFICE), id: 'tv-900001', tmdbId: 900001, standout: [{ season: 1, episode: 1, name: 'Hour Special', runtime: 44 }] };
    const ctx2 = makeCtx({ catalog: { ...FIXTURE_CATALOG, items: [...FIXTURE_CATALOG.items, special] } });
    expect(engine.choosePick(special, req({ time: 20 }), ctx2)).toEqual({ pick: { type: 'any-episode' }, minutes: 22 });
    expect(engine.choosePick(special, req({ time: 45 }), ctx2)).toEqual({ pick: { type: 'episode', season: 1, episode: 1, name: 'Hour Special' }, minutes: 44 });

    // An hour-long drop-in show with one short standout: with 20 minutes only that episode fits.
    const shortOne: CatalogItem = { ...item('tv-87012'), id: 'tv-900002', tmdbId: 900002, standout: [{ season: 2, episode: 3, name: 'Mini', runtime: 20 }] };
    const ctx3 = makeCtx({ catalog: { ...FIXTURE_CATALOG, items: [...FIXTURE_CATALOG.items, shortOne] } });
    expect(engine.choosePick(shortOne, req({ time: 20 }), ctx3)).toEqual({ pick: { type: 'episode', season: 2, episode: 3, name: 'Mini' }, minutes: 20 });
    const deck = engine.buildDeck(req({ time: 20, mood: 'cozy' }), ctx3, { limit: 100 });
    expect(deck.find((c) => c.itemId === 'tv-900002')?.minutes).toBe(20);
  });

  it('SWEEP: every card fits the time, and its minutes are the real length of what it tells you to watch', () => {
    expect(sweepFinds('rule4')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Rule 5: New excludes anything a watcher has seen; Rewatch only includes seen titles', () => {
  it('favourites count as seen', () => {
    const ctx = makeCtx();
    expect(engine.hasSeen('HG', SCRUBS, ctx)).toBe(true);
    expect(engine.hasSeen('BG', SCRUBS, ctx)).toBe(false);
    expect(engine.hasSeen('BG', FRIENDS, ctx)).toBe(true);
    expect(engine.hasSeen('HG', OFFICE, ctx)).toBe(false);
    expect(engine.hasSeen('HG', OFFICE, makeCtx({ seen: { HG: [OFFICE] } }))).toBe(true);
  });

  it('New: a solo watcher never gets something they have seen (marked seen or a favourite)', () => {
    const ctx = makeCtx({ seen: { HG: [OFFICE] } });
    const deck = ids(engine.buildDeck(req({ who: 'HG', novelty: 'new' }), ctx, { limit: 100 }));
    expect(deck).not.toContain(OFFICE);
    expect(deck).not.toContain(SCRUBS);
    expect(deck).toContain(FRIENDS); // BG's favourite, but HG hasn't seen it
    expect(deck).toContain(PARKS);
  });

  it('New, Together: excluded if EITHER of them has seen it', () => {
    const ctx = makeCtx({ seen: { HG: [OFFICE], BG: [PARKS] } });
    const deck = ids(engine.buildDeck(req({ who: 'Together', novelty: 'new' }), ctx, { limit: 100 }));
    for (const id of [OFFICE, PARKS, SCRUBS, FRIENDS, FAMILY_GUY]) expect(deck).not.toContain(id);
    expect(deck).toContain('tv-48891'); // Brooklyn Nine-Nine: neither has seen it
  });

  it('Rewatch: only titles the watcher has seen', () => {
    const ctx = makeCtx({ seen: { HG: [OFFICE] } });
    const deck = ids(engine.buildDeck(req({ who: 'HG', novelty: 'rewatch' }), ctx, { limit: 100 }));
    expect(deck).toContain(OFFICE);
    expect(deck).toContain(SCRUBS);
    expect(deck).not.toContain(FRIENDS);
    expect(deck).not.toContain(PARKS);
    for (const id of deck) expect(engine.hasSeen('HG', id, ctx)).toBe(true);
  });

  it('Rewatch, Together: included if AT LEAST ONE of them has seen it', () => {
    const ctx = makeCtx({ seen: { BG: [PARKS] } });
    const deck = ids(engine.buildDeck(req({ who: 'Together', novelty: 'rewatch' }), ctx, { limit: 100 }));
    expect(deck).toContain(PARKS); // only BG has seen it
    expect(deck).toContain(SCRUBS); // only HG (favourite)
    expect(deck).toContain(FAMILY_GUY); // both
    expect(deck).not.toContain(OFFICE); // neither
  });

  it('Either: both seen and unseen titles are allowed', () => {
    const deck = ids(engine.buildDeck(req({ who: 'HG', novelty: 'either' }), makeCtx(), { limit: 100 }));
    expect(deck).toContain(SCRUBS);
    expect(deck).toContain(OFFICE);
  });

  it('SWEEP: no New card has been seen by a watcher; every Rewatch card has', () => {
    expect(sweepFinds('rule5')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Rule 6: when a title is on several of our services, an ad-free one is chosen', () => {
  it('How I Met Your Mother is on Hulu (ads) and Netflix (ad-free): we send them to Netflix', () => {
    expect(engine.chooseService(item(HIMYM), DEFAULT_PLANS)).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
    const card = engine.buildDeck(req({ who: 'HG' }), makeCtx(), { limit: 100 }).find((c) => c.itemId === HIMYM);
    expect(card?.service).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
  });

  it('Community is on Netflix, Hulu and Peacock: Netflix (the only ad-free one) wins', () => {
    expect(engine.chooseService(item(COMMUNITY), DEFAULT_PLANS)).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
  });

  it('when every option has ads the choice is still deterministic (fixed service order)', () => {
    // South Park: HBO Max and Paramount+, both with ads. Abbott Elementary: Hulu and HBO Max, both with ads.
    for (let k = 0; k < 5; k++) {
      expect(engine.chooseService(item(SOUTH_PARK), DEFAULT_PLANS)).toEqual({ serviceId: 'hbo', planId: 'ads', adFree: false });
      expect(engine.chooseService(item(ABBOTT), DEFAULT_PLANS)).toEqual({ serviceId: 'hulu', planId: 'ads', adFree: false });
    }
    // Provider order in the catalog must not matter.
    const reversed = { ...item(SOUTH_PARK), providers: [...item(SOUTH_PARK).providers].reverse() };
    expect(engine.chooseService(reversed, DEFAULT_PLANS)).toEqual({ serviceId: 'hbo', planId: 'ads', adFree: false });
  });

  it('follows the plans in settings: upgrading one service to ad-free makes it the choice', () => {
    expect(engine.chooseService(item(SOUTH_PARK), { ...DEFAULT_PLANS, paramount: 'premium' })).toEqual({ serviceId: 'paramount', planId: 'premium', adFree: true });
    expect(engine.chooseService(item(ABBOTT), { ...DEFAULT_PLANS, hbo: 'adfree' })).toEqual({ serviceId: 'hbo', planId: 'adfree', adFree: true });
    // Downgrading Netflix to the ad plan: HIMYM is now ads everywhere, and Netflix-with-ads carries Glass Onion.
    const adsNetflix = { ...DEFAULT_PLANS, netflix: 'ads' };
    expect(engine.chooseService(item(HIMYM), adsNetflix)).toEqual({ serviceId: 'hulu', planId: 'ads', adFree: false });
    expect(engine.chooseService(item(GLASS_ONION), adsNetflix)).toEqual({ serviceId: 'netflix', planId: 'ads', adFree: false });
    expect(engine.chooseService(item(GLASS_ONION), DEFAULT_PLANS)).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
  });

  it('SWEEP: every card shows an ad-free service whenever one of ours carries the title', () => {
    expect(sweepFinds('rule6')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Rule 7: Never', () => {
  it("hides the title for the person who tapped it, and from Together — but not from the other person's solo decks", () => {
    const ctx = makeCtx({ never: { HG: [OFFICE] } });
    expect(engine.isNeverHidden(OFFICE, 'HG', ctx)).toBe(true);
    expect(engine.isNeverHidden(OFFICE, 'Together', ctx)).toBe(true);
    expect(engine.isNeverHidden(OFFICE, 'BG', ctx)).toBe(false);
    expect(ids(engine.buildDeck(req({ who: 'HG' }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: 'Together' }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: 'BG' }), ctx, { limit: 100 }))).toContain(OFFICE);
  });

  it('works the same way round for BG', () => {
    const ctx = makeCtx({ never: { BG: [PARKS] } });
    expect(ids(engine.buildDeck(req({ who: 'BG' }), ctx, { limit: 100 }))).not.toContain(PARKS);
    expect(ids(engine.buildDeck(req({ who: 'Together' }), ctx, { limit: 100 }))).not.toContain(PARKS);
    expect(ids(engine.buildDeck(req({ who: 'HG' }), ctx, { limit: 100 }))).toContain(PARKS);
  });

  it('once both have tapped Never it is gone everywhere', () => {
    const ctx = makeCtx({ never: { HG: [OFFICE], BG: [OFFICE] } });
    for (const who of WHO) {
      expect(engine.isNeverHidden(OFFICE, who, ctx)).toBe(true);
      for (const r of everyRequest()) {
        if (r.who !== who) continue;
        expect(engine.isEligible(item(OFFICE), r, ctx)).toBe(false);
      }
      expect(ids(engine.buildDeck(req({ who }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    }
  });

  it('applies to the New feed as well', () => {
    const one = makeCtx({ never: { HG: [PADDINGTON] } });
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'HG', one).map((c) => c.itemId)).not.toContain(PADDINGTON);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'Together', one).map((c) => c.itemId)).not.toContain(PADDINGTON);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'BG', one).map((c) => c.itemId)).toContain(PADDINGTON);
    const both = makeCtx({ never: { HG: [PADDINGTON], BG: [PADDINGTON] } });
    for (const who of WHO) expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, who, both).map((c) => c.itemId)).not.toContain(PADDINGTON);
  });

  it('a title nobody tapped is not hidden', () => {
    const ctx = makeCtx({ never: { HG: [OFFICE] } });
    for (const who of WHO) expect(engine.isNeverHidden(PARKS, who, ctx)).toBe(false);
  });

  it('SWEEP: no card was ever one its audience had tapped Never on', () => {
    expect(sweepFinds('rule7')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Also: "not tonight" and already-dealt cards', () => {
  it('"not tonight" hides the title from that person today, and from Together', () => {
    const ctx = makeCtx({ notTonight: { HG: { [OFFICE]: TODAY } } });
    expect(ids(engine.buildDeck(req({ who: 'HG' }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: 'Together' }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: 'BG' }), ctx, { limit: 100 }))).toContain(OFFICE);
    expect(engine.isEligible(item(OFFICE), req({ who: 'HG' }), ctx)).toBe(false);
  });

  it('it comes back another day', () => {
    const tomorrow = makeCtx({ notTonight: { HG: { [OFFICE]: TODAY } }, today: '2026-10-11' });
    expect(ids(engine.buildDeck(req({ who: 'HG' }), tomorrow, { limit: 100 }))).toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: 'Together' }), tomorrow, { limit: 100 }))).toContain(OFFICE);
    const swipedYesterday = makeCtx({ notTonight: { BG: { [OFFICE]: '2026-10-09' } } });
    expect(ids(engine.buildDeck(req({ who: 'BG' }), swipedYesterday, { limit: 100 }))).toContain(OFFICE);
  });

  it('SWEEP: no card was swiped "not tonight" today by someone watching', () => {
    expect(sweepFinds('notTonight')).toEqual([]);
  });

  it('ids passed in `exclude` are never returned', () => {
    const ctx = makeCtx();
    const first = engine.buildDeck(req({ who: 'Together' }), ctx, { limit: 5 });
    const more = engine.buildDeck(req({ who: 'Together' }), ctx, { limit: 100, exclude: ids(first) });
    for (const id of ids(first)) expect(ids(more)).not.toContain(id);
    expect(more.length).toBeGreaterThan(0);
  });

  it('a deck never contains the same title twice', () => {
    for (const { ctx } of setups()) {
      for (const r of everyRequest().filter((_, k) => k % 7 === 0)) {
        const deck = ids(engine.buildDeck(r, ctx, { limit: 100, seed: 5 }));
        expect(new Set(deck).size).toBe(deck.length);
      }
    }
  });
});
