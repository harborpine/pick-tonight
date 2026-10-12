/**
 * THE RULES (SPEC.md "Rules that must hold"), one `describe` per rule, numbered
 * as in the spec: 1-8. (Rule 9 — a Together match needs a yes from everyone and
 * is recorded once — belongs to the sync layer and is tested there.)
 *
 * Each rule is tested two ways:
 *  - named examples from the sample catalog, for households of one, two, three
 *    and four people; and
 *  - a SWEEP: for households of 1, 2, 3 and 4, EVERY non-empty audience that can
 *    be drawn from the household, crossed with viewing x mood x time x novelty
 *    (450 requests per audience, including the "any" time), under several
 *    household setups. Every card of every deck is checked by an independent
 *    checker written here from the spec — it does not call the engine's own
 *    eligibility code. The household of two runs the whole grid for every setup;
 *    the others run a rotating sample of it (a different slice per audience,
 *    setup and variant, so between them the whole grid is covered).
 *    The sweep also counts, per rule and household size, how many times the
 *    rule actually had something to forbid — so "nothing broke" cannot mean
 *    "nothing was tested".
 *
 * The test people (see testkit.ts): alex and sam have long favourites lists,
 * sam never wants horror / true crime / anything scary; kit is brand new;
 * dee has three favourites, never wants reality TV or anything not in English.
 */
import { describe, expect, it } from 'vitest';
import {
  MOODS,
  SERVICES,
  TIME_LIMIT_MINUTES,
  watchers,
  type CatalogItem,
  type DeckCard,
  type EngineContext,
  type GenreId,
  type MemberId,
  type Novelty,
  type PlanSelection,
  type SuggestRequest,
  type TimeBudget,
  type ViewingType,
  type Who,
} from '../contracts';
import { FIXTURE_CATALOG, FIXTURE_NEW_ARRIVALS } from '../contracts/fixtures/catalog';
import { createEngine } from './index';
import { ALEX, audiencesOf, BOTH, dayMs, DEE, HOUSE_OF_FOUR, itemsById, KIT, makeCtx, makePick, PLANS, req, SAM, TODAY, type CtxSetup } from './testkit';

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
const SCRUBS = 'tv-4556'; // alex's favourite, standout episode
const FRIENDS = 'tv-1668'; // sam's favourite
const OFFICE = 'tv-2316'; // nobody's favourite
const PARKS = 'tv-8592';
const BROOKLYN = 'tv-48891';
const GET_OUT = 'movie-419430'; // horror + scary
const HILL_HOUSE = 'tv-72844'; // horror + scary
const STRANGER = 'tv-66732'; // scary, not horror
const DARK = 'tv-70523'; // scary, not horror; German
const SQUID_GAME = 'tv-93405'; // Korean; sam's favourite
const MAKING_A_MURDERER = 'tv-64439'; // true crime
const DATELINE = 'tv-4601'; // true crime, low attention
const FAMILY_GUY = 'tv-1434'; // favourite of alex and sam
const PADDINGTON = 'movie-346648';
const BAKE_OFF = 'tv-87012'; // reality
const SCHITTS = 'tv-61662';

// The households the tests run in: one person alone (a brand-new one, and one with
// never-show-me choices), a pair, three, and a full house of four.
const SOLO_NEW: MemberId[] = ['kit'];
const SOLO_SAM: MemberId[] = ['sam'];
const PAIR: MemberId[] = ['alex', 'sam'];
const THREE: MemberId[] = ['alex', 'sam', 'kit'];
const FOUR: MemberId[] = HOUSE_OF_FOUR;
const HOUSEHOLDS: MemberId[][] = [SOLO_NEW, SOLO_SAM, PAIR, THREE, FOUR];

// ---------------------------------------------------------------------------
// The independent checker and the sweep
// ---------------------------------------------------------------------------

const VIEWING: ViewingType[] = ['focused', 'background', 'eating'];
const TIMES: TimeBudget[] = [20, 45, 60, 120, 'any'];
const NOVELTY: Novelty[] = ['new', 'rewatch', 'either'];
const ALL_MOODS = MOODS.map((m) => m.id);

/** All 450 combinations of viewing x mood x time x novelty for one audience. */
function requestsFor(who: Who, genre: GenreId | null = null): SuggestRequest[] {
  const out: SuggestRequest[] = [];
  for (const viewing of VIEWING) for (const mood of ALL_MOODS) for (const time of TIMES) for (const novelty of NOVELTY) out.push({ who, viewing, mood, time, novelty, genre });
  return out;
}
/** Every request for every audience of a household. */
function everyRequest(members: MemberId[] = PAIR, genre: GenreId | null = null): SuggestRequest[] {
  return audiencesOf(members).flatMap((who) => requestsFor(who, genre));
}

/** The household's plan for each service, straight from the settings. */
function householdPlans(plans: PlanSelection) {
  return SERVICES.flatMap((s) => {
    const p = s.plans.find((x) => x.id === plans[s.id]);
    return p ? [{ serviceId: s.id, plan: p }] : [];
  });
}
const carriedBy = (i: CatalogItem, plans: PlanSelection) => householdPlans(plans).filter((h) => h.plan.providerIds.some((id) => i.providers.includes(id)));
const seenBy = (p: MemberId, id: string, ctx: EngineContext) => id in ctx.state.seen[p] || ctx.state.profiles[p].favorites.some((f) => f.id === id);

type Rule = 'rule1' | 'rule2' | 'rule3' | 'rule4' | 'rule5' | 'rule6' | 'rule7' | 'rule8' | 'notTonight';
const RULES: Rule[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6', 'rule7', 'rule8', 'notTonight'];

/**
 * The rules a TITLE breaks for a request, whatever card it might be dealt on — checked from first principles.
 * (Rule 4 here: nothing about the title can fit the time. Rule 6 is about the card, see `violations`.)
 */
function titleViolations(i: CatalogItem, r: SuggestRequest, ctx: EngineContext): Rule[] {
  const out: Rule[] = [];
  const people = watchers(r.who);
  const plans = ctx.state.settings.plans;

  // 1. on one of the household's selected plans
  if (!carriedBy(i, plans).length) out.push('rule1');

  // 2. any watcher's never-show-me choice; scared only for audiences where nobody has a horror / scary choice
  for (const p of people) {
    const d = ctx.state.profiles[p].dealbreakers;
    const noHorror = d.horror || d.genres.includes('horror');
    if ((noHorror && i.flags.horror) || (d.trueCrime && i.flags.trueCrime) || (d.scary && i.flags.scary)) out.push('rule2');
    if (d.genres.some((g) => i.genres.includes(g))) out.push('rule2');
    if (d.subtitled && i.lang !== 'en') out.push('rule2');
    if (r.mood === 'scared' && (noHorror || d.scary)) out.push('rule2');
  }

  // 3. background / eating: low attention only
  if (r.viewing !== 'focused' && i.attention !== 'low') out.push('rule3');

  // 4. something about it fits the time
  const limit = TIME_LIMIT_MINUTES[r.time];
  if (i.runtime > limit && !i.standout.some((e) => (e.runtime ?? i.runtime) <= limit)) out.push('rule4');

  // 5. new: nobody watching has seen it; rewatch: at least one watcher has
  const anySeen = people.some((p) => seenBy(p, i.id, ctx));
  if (r.novelty === 'new' && anySeen) out.push('rule5');
  if (r.novelty === 'rewatch' && !anySeen) out.push('rule5');

  // 7. never: a watcher tapped it, or every member of the household has
  const household = Object.keys(ctx.state.members);
  if (people.some((p) => i.id in ctx.state.never[p]) || household.every((p) => i.id in ctx.state.never[p])) out.push('rule7');

  // 8. already on the Matches tab for an audience that overlaps this one
  if (ctx.state.picks.some((p) => p.itemId === i.id && p.who.some((x) => people.includes(x)))) out.push('rule8');

  // not tonight
  if (people.some((p) => ctx.state.notTonight[p][i.id] === ctx.today)) out.push('notTonight');
  return out;
}

/** Every rule a dealt CARD breaks. */
function violations(card: DeckCard, r: SuggestRequest, ctx: EngineContext): Rule[] {
  const i = ctx.catalog.items.find((x) => x.id === card.itemId);
  if (!i) return ['rule1'];
  const out = titleViolations(i, r, ctx);
  const plans = ctx.state.settings.plans;

  // 1. the service shown really is one of ours carrying it
  const carriers = carriedBy(i, plans);
  const shown = carriers.find((c) => c.serviceId === card.service.serviceId && c.plan.id === card.service.planId);
  if (!shown && !out.includes('rule1')) out.push('rule1');

  // 4. the minutes are the real length of what it says to watch, and that fits
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

  // 6. ad-free wins
  if (shown && carriers.some((c) => c.plan.adFree) && !(shown.plan.adFree && card.service.adFree)) out.push('rule6');
  if (shown && card.service.adFree !== shown.plan.adFree) out.push('rule6');
  return out;
}

/**
 * Household setups the sweep runs under. Written for "the first member, the
 * second member…" so the same setups work for a household of any size.
 */
function setups(members: MemberId[]): { name: string; ctx: EngineContext }[] {
  const [m0, m1, m2, m3] = members;
  const per = <T,>(values: T[]): Partial<Record<MemberId, T>> => Object.fromEntries(members.map((m, k) => [m, values[k]]).filter(([, v]) => v !== undefined));
  const base: CtxSetup = { members };

  const fresh = makeCtx(base);

  const livedIn = makeCtx({
    ...base,
    seen: per<string[]>([
      [OFFICE, 'movie-27205', PADDINGTON, STRANGER, 'tv-68595'],
      [OFFICE, PARKS, 'tv-91239', 'movie-11036', 'tv-82728'],
      [PARKS, BROOKLYN, 'movie-13', 'tv-73586'],
      ['tv-4586', 'movie-354912', OFFICE],
    ]),
    // Schitt's Creek: tapped by EVERY member (so gone everywhere, whatever the household size).
    never: per<string[]>([
      ['tv-32726', SCHITTS, SUCCESSION],
      [SCHITTS, BROOKLYN, 'movie-8363'],
      [SCHITTS, 'tv-1437', 'tv-32726'],
      [SCHITTS, 'movie-505600'],
    ]),
    notTonight: per<Record<string, string>>([
      { [ABBOTT]: TODAY, 'movie-546554': '2026-10-09' },
      { 'tv-4586': TODAY, 'movie-455207': '2026-10-01' },
      { [FRIENDS]: TODAY, 'movie-531': '2026-10-08' },
      { [PADDINGTON]: TODAY },
    ]),
    picks: [
      { itemId: FRIENDS, who: [m0] }, // the first member's solo pick
      ...(m1 ? [{ itemId: COMMUNITY, who: [m1] }, { itemId: 'movie-324857', who: [m0, m1] }] : []), // a solo pick and a match for two
      ...(m2 ? [{ itemId: BAKE_OFF, who: [m1, m2] }, { itemId: 'tv-456', who: [m2] }] : []),
      ...(m3 ? [{ itemId: 'movie-76341', who: [m0, m1, m2, m3] }, { itemId: 'tv-2190', who: [m3] }] : []),
    ],
  });

  const otherPlans = makeCtx({
    ...base,
    plans: { netflix: 'ads', disney: null, hulu: 'noads', hbo: 'adfree', peacock: 'premium-plus', paramount: 'premium' },
    seen: per<string[]>([[POKER_FACE], [YELLOWJACKETS], [GLASS_ONION], [HIMYM]]),
  });

  // The rule is about each person's choices, not their names: pass everyone's choices one place along.
  const fromSample = makeCtx(base);
  const rotated = makeCtx({
    ...base,
    seen: per<string[]>([[GET_OUT], [HILL_HOUSE, DATELINE], [DARK], [BAKE_OFF]]),
    dealbreakers: Object.fromEntries(members.map((m, k) => [m, fromSample.state.profiles[members[(k + 1) % members.length]].dealbreakers])),
  });
  // (With one member, "one place along" is themselves: give that person the strict set instead of theirs, or none.)
  if (members.length === 1) {
    const d = rotated.state.profiles[m0].dealbreakers;
    rotated.state.profiles[m0].dealbreakers = d.horror ? { horror: false, trueCrime: false, scary: false, genres: [], subtitled: false } : { horror: true, trueCrime: true, scary: true, genres: [], subtitled: false };
  }

  // Only two services, and the settings simply leave the others out (a partial selection).
  const fewServices = makeCtx({ ...base, plans: { hbo: 'ads', paramount: 'essential' } });

  // Whole genres and "nothing subtitled", on the first two members.
  const genreChoices = makeCtx({
    ...base,
    dealbreakers: per([
      { horror: false, trueCrime: false, scary: false, genres: ['animation', 'horror'] as GenreId[], subtitled: true },
      { horror: false, trueCrime: true, scary: false, genres: ['reality', 'documentary', 'romance'] as GenreId[], subtitled: false },
    ]),
    seen: per<string[]>([[SQUID_GAME, FAMILY_GUY], [BAKE_OFF]]),
  });

  return [
    { name: 'fresh household', ctx: fresh },
    { name: 'lived-in household (seen, never, not tonight, picks)', ctx: livedIn },
    { name: 'different plans', ctx: otherPlans },
    { name: 'never-show-me choices passed along', ctx: rotated },
    { name: 'only two services', ctx: fewServices },
    { name: 'whole genres and nothing subtitled', ctx: genreChoices },
  ];
}

const VARIANTS: { genre: GenreId | null; seed: number }[] = [
  { genre: null, seed: 0 },
  { genre: null, seed: 7 },
  { genre: 'comedy', seed: 0 },
  { genre: 'reality', seed: 3 },
];
/** How much of the 450-request grid each (audience, setup, variant) runs: all of it for the pair, a rotating slice otherwise. */
const STRIDE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 3 };

interface Tally {
  decks: number;
  cards: number;
}
interface SweepResult {
  decks: number;
  cards: number;
  broken: Map<Rule, string[]>;
  /** `${household size}:${audience size}` -> what was dealt. */
  dealt: Map<string, Tally>;
  /** `${rule}:${household size}` -> how many (request, title) pairs the rule forbade (for rule 6: cards with a choice of services). */
  forbade: Map<string, number>;
  /** Grid positions (0..449) run at least once per household size. */
  gridCovered: Map<number, Set<number>>;
  pairDecks: number;
}

/** Runs the whole sweep once and remembers what broke, so each rule's test can report its own part. */
const sweep = (() => {
  let cache: SweepResult | null = null;
  return (): SweepResult => {
    if (cache) return cache;
    const res: SweepResult = { decks: 0, cards: 0, broken: new Map(), dealt: new Map(), forbade: new Map(), gridCovered: new Map(), pairDecks: 0 };
    const bump = (key: string, by = 1) => res.forbade.set(key, (res.forbade.get(key) ?? 0) + by);
    const fail = (rule: Rule, text: string) => {
      const list = res.broken.get(rule) ?? [];
      if (list.length < 5) list.push(text);
      res.broken.set(rule, list);
    };
    let turn = 0;
    for (const members of HOUSEHOLDS) {
      const size = members.length;
      const stride = STRIDE[size];
      const covered = res.gridCovered.get(size) ?? new Set<number>();
      res.gridCovered.set(size, covered);
      for (const { name, ctx } of setups(members)) {
        for (const who of audiencesOf(members)) {
          const key = `${size}:${who.length}`;
          const tally = res.dealt.get(key) ?? { decks: 0, cards: 0 };
          res.dealt.set(key, tally);
          for (const v of VARIANTS) {
            const offset = turn++ % stride;
            requestsFor(who, v.genre).forEach((r, at) => {
              if (at % stride !== offset) return;
              covered.add(at);
              const deck = engine.buildDeck(r, ctx, { seed: v.seed, limit: 100 });
              res.decks++;
              tally.decks++;
              if (size === 2) res.pairDecks++;
              const where = `${name} [household ${members.join('+')}]`;
              for (const card of deck) {
                res.cards++;
                tally.cards++;
                for (const rule of violations(card, r, ctx)) fail(rule, `${where}: ${card.itemId} in ${JSON.stringify(r)}`);
                // isEligible must agree with what buildDeck returns.
                const i = ctx.catalog.items.find((x) => x.id === card.itemId)!;
                if (!engine.isEligible(i, r, ctx)) fail('rule1', `${where}: buildDeck returned ${card.itemId} that isEligible rejects for ${JSON.stringify(r)}`);
                if (carriedBy(i, ctx.state.settings.plans).length > 1) bump(`rule6:${size}`);
              }
              // How much did each rule have to forbid here? And isEligible must never accept what the spec forbids.
              if (v.seed === 0 && v.genre === null) {
                for (const i of ctx.catalog.items) {
                  const why = titleViolations(i, r, ctx);
                  for (const rule of new Set(why)) bump(`${rule}:${size}`);
                  if (why.length && engine.isEligible(i, r, ctx)) fail(why[0], `${where}: isEligible accepts ${i.id} for ${JSON.stringify(r)}`);
                }
              }
            });
          }
        }
      }
    }
    cache = res;
    return cache;
  };
})();

const sweepFinds = (rule: Rule) => sweep().broken.get(rule) ?? [];
/** The rule had something to forbid in a household of every size. */
function expectExercised(rule: Rule) {
  for (const size of [1, 2, 3, 4]) expect(sweep().forbade.get(`${rule}:${size}`) ?? 0, `${rule} was never put to the test in a household of ${size}`).toBeGreaterThan(0);
}

describe('the sweep itself', () => {
  it('covers households of 1, 2, 3 and 4 and every audience size within each, and actually deals cards', () => {
    const s = sweep();
    // The pair runs the complete grid: 6 setups x 3 audiences x 4 variants x 450 requests.
    expect(s.pairDecks).toBe(6 * 3 * 4 * 450);
    expect(s.cards).toBeGreaterThan(100_000);
    const combos = ['1:1', '2:1', '2:2', '3:1', '3:2', '3:3', '4:1', '4:2', '4:3', '4:4'];
    expect([...s.dealt.keys()].sort()).toEqual(combos);
    for (const key of combos) {
      expect(s.dealt.get(key)!.decks, key).toBeGreaterThan(500);
      expect(s.dealt.get(key)!.cards, key).toBeGreaterThan(2000);
    }
    // Including: alone in a household of one, a pair inside a household of four, and all four together.
    expect(s.dealt.get('1:1')!.cards).toBeGreaterThan(0);
    expect(s.dealt.get('4:2')!.cards).toBeGreaterThan(0);
    expect(s.dealt.get('4:4')!.cards).toBeGreaterThan(0);
    // The sampled households still reach every one of the 450 request combinations.
    for (const size of [1, 2, 3, 4]) expect(s.gridCovered.get(size)!.size, `household of ${size}`).toBe(450);
  }, 300_000);

  it('every audience of a household is swept: 1, 3, 7 and 15 of them', () => {
    expect(audiencesOf(SOLO_NEW)).toEqual([['kit']]);
    expect(audiencesOf(PAIR)).toEqual([['alex'], ['sam'], ['alex', 'sam']]);
    expect(audiencesOf(THREE)).toHaveLength(7);
    expect(audiencesOf(FOUR)).toHaveLength(15);
    expect(audiencesOf(FOUR)).toContainEqual(['alex', 'dee', 'kit', 'sam']);
    expect(audiencesOf(FOUR)).toContainEqual(['dee', 'kit']);
    expect(new Set(audiencesOf(FOUR).map((w) => w.join('+'))).size).toBe(15);
  });

  it('the independent checker really catches each kind of violation (so a clean sweep means something)', () => {
    const ctx = makeCtx({ never: { alex: [OFFICE] }, seen: { alex: [PARKS] }, notTonight: { alex: { [ABBOTT]: TODAY } }, picks: [{ itemId: BROOKLYN, who: SAM }] });
    const card = (id: string, over: Partial<DeckCard> = {}): DeckCard => ({
      itemId: id,
      pick: { type: item(id).kind === 'movie' ? 'movie' : 'any-episode' },
      service: engine.chooseService(item(id), PLANS) ?? { serviceId: 'netflix', planId: 'standard', adFree: true },
      minutes: item(id).runtime,
      score: 1,
      reasons: [],
      ...over,
    });
    expect(violations(card(POKER_FACE), req(), ctx)).toContain('rule1');
    expect(violations(card(GET_OUT), req({ who: SAM }), ctx)).toContain('rule2');
    expect(violations(card(FRIENDS), req({ who: BOTH, mood: 'scared' }), ctx)).toContain('rule2');
    expect(violations(card(GOT), req({ viewing: 'background' }), ctx)).toContain('rule3');
    expect(violations(card(GOT), req({ time: 20 }), ctx)).toContain('rule4');
    expect(violations(card(SCRUBS), req({ novelty: 'new' }), ctx)).toContain('rule5');
    expect(violations(card(FRIENDS), req({ novelty: 'rewatch' }), ctx)).toContain('rule5');
    expect(violations(card(HIMYM, { service: { serviceId: 'hulu', planId: 'ads', adFree: false } }), req(), ctx)).toContain('rule6');
    expect(violations(card(OFFICE), req(), ctx)).toContain('rule7');
    expect(violations(card(ABBOTT), req(), ctx)).toContain('notTonight');
    expect(violations(card(BROOKLYN), req({ who: BOTH }), ctx)).toContain('rule8');
    expect(violations(card(BROOKLYN), req({ who: ALEX }), ctx)).toEqual([]);
    expect(violations(card(GOT), req({ time: 'any', mood: 'gripped' }), ctx)).toEqual([]);
    expect(violations(card(FRIENDS), req(), ctx)).toEqual([]);

    // ...and in a household of four: whole genres, subtitles, and Never by everyone.
    const four = makeCtx({ members: FOUR, never: { alex: [OFFICE], sam: [OFFICE], kit: [OFFICE], dee: [OFFICE, PARKS] }, picks: [{ itemId: BROOKLYN, who: ['kit', 'sam'] }] });
    expect(violations(card(BAKE_OFF), req({ who: ['alex', 'dee'], mood: 'cozy' }), four)).toContain('rule2'); // dee: no reality TV
    expect(violations(card(SQUID_GAME), req({ who: ['dee', 'kit'], mood: 'gripped' }), four)).toContain('rule2'); // dee: nothing subtitled
    expect(violations(card(BAKE_OFF), req({ who: ['alex', 'kit'], mood: 'cozy' }), four)).toEqual([]);
    expect(violations(card(OFFICE), req({ who: KIT }), four)).toContain('rule7');
    expect(violations(card(PARKS), req({ who: ['alex', 'kit'] }), four)).toEqual([]); // only dee tapped it, and dee isn't watching
    expect(violations(card(PARKS), req({ who: ['alex', 'dee'] }), four)).toContain('rule7');
    expect(violations(card(BROOKLYN), req({ who: ['alex', 'kit'] }), four)).toContain('rule8');
    expect(violations(card(BROOKLYN), req({ who: ['alex', 'dee'] }), four)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('Rule 1: nothing is suggested that is not included in the household\'s plans', () => {
  it('titles only on a higher tier (Peacock Premium Plus, Paramount+ Premium) have no service and are not eligible', () => {
    const ctx = makeCtx();
    expect(engine.chooseService(item(POKER_FACE), PLANS)).toBeNull();
    expect(engine.chooseService(item(YELLOWJACKETS), PLANS)).toBeNull();
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

  it('the same in a household of one and for every audience of a household of four', () => {
    for (const members of [SOLO_NEW, FOUR]) {
      const ctx = makeCtx({ members });
      for (const who of audiencesOf(members)) {
        for (const mood of ['gripped', 'laugh', 'cozy'] as const) for (const novelty of NOVELTY) {
          const r = req({ who, mood, novelty });
          const deck = ids(engine.buildDeck(r, ctx, { limit: 100 }));
          expect(deck).not.toContain(POKER_FACE);
          expect(deck).not.toContain(YELLOWJACKETS);
          expect(engine.isEligible(item(POKER_FACE), r, ctx)).toBe(false);
        }
      }
    }
  });

  it('changing the plan in settings changes what is included', () => {
    const upgraded = makeCtx({ plans: { ...PLANS, peacock: 'premium-plus' } });
    expect(engine.chooseService(item(POKER_FACE), upgraded.state.settings.plans)).toEqual({ serviceId: 'peacock', planId: 'premium-plus', adFree: true });
    expect(ids(engine.buildDeck(req({ mood: 'gripped' }), upgraded, { limit: 100 }))).toContain(POKER_FACE);
  });

  it('a service we are not subscribed to contributes nothing', () => {
    const noNetflix = makeCtx({ plans: { ...PLANS, netflix: null } });
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
    const bogus = { ...PLANS, netflix: 'no-such-plan' };
    expect(engine.chooseService(item(PADDINGTON), bogus)).toBeNull();
  });

  it('services are data: a selection that simply leaves services out, or names one we have never heard of, works', () => {
    // Nothing selected at all (the settings object is empty): nothing is included.
    expect(engine.buildDeck(req(), makeCtx({ plans: {} }))).toEqual([]);
    for (const i of FIXTURE_CATALOG.items) expect(engine.chooseService(i, {})).toBeNull();
    // One service only; the other keys are absent rather than null.
    const one = makeCtx({ plans: { peacock: 'premium' } });
    const deck = engine.buildDeck(req({ mood: 'laugh' }), one, { limit: 100 });
    expect(deck.length).toBeGreaterThan(3);
    for (const c of deck) {
      expect(c.service).toEqual({ serviceId: 'peacock', planId: 'premium', adFree: false });
      expect(item(c.itemId).providers).toContain(386);
    }
    // A service id that is not in the list of services is ignored, not an error.
    const odd: PlanSelection = { peacock: 'premium', 'not-a-real-service': 'gold' };
    expect(ids(engine.buildDeck(req({ mood: 'laugh' }), makeCtx({ plans: odd }), { limit: 100 }))).toEqual(ids(deck));
    // Every service in the list can be the household's only one.
    for (const svc of SERVICES) {
      for (const plan of svc.plans) {
        for (const i of FIXTURE_CATALOG.items) {
          const choice = engine.chooseService(i, { [svc.id]: plan.id });
          const included = plan.providerIds.some((p) => i.providers.includes(p));
          expect(choice).toEqual(included ? { serviceId: svc.id, planId: plan.id, adFree: plan.adFree } : null);
        }
      }
    }
  });

  it('the New feed and the first-run grid also leave out titles that are not on our plans', () => {
    const ctx = makeCtx();
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, ALEX, ctx).map((c) => c.itemId)).not.toContain(POKER_FACE);
    const grid = engine.onboardingTitles(FIXTURE_CATALOG, PLANS, 100).map((i) => i.id);
    expect(grid).not.toContain(POKER_FACE);
    expect(grid).not.toContain(YELLOWJACKETS);
  });

  it('SWEEP: every card in every deck is on a selected plan and shows one of our services', () => {
    expect(sweepFinds('rule1')).toEqual([]);
    expectExercised('rule1');
  }, 300_000);
});

// ---------------------------------------------------------------------------
describe('Rule 2: any watcher\'s "never show me" choices exclude a title for the whole audience', () => {
  const flagged = [GET_OUT, HILL_HOUSE, STRANGER, DARK, MAKING_A_MURDERER, DATELINE];

  it('sam (no horror, true crime or anything scary) never gets them, alone or with alex, whatever they ask for', () => {
    const ctx = makeCtx();
    for (const r of everyRequest()) {
      if (!r.who.includes('sam')) continue;
      const deck = ids(engine.buildDeck(r, ctx, { limit: 100 }));
      for (const id of flagged) expect(deck).not.toContain(id);
      for (const id of flagged) expect(engine.isEligible(item(id), r, ctx)).toBe(false);
    }
  });

  it('alex alone (no such choices) can get them', () => {
    const ctx = makeCtx();
    const deck = ids(engine.buildDeck(req({ who: ALEX, mood: 'gripped' }), ctx, { limit: 100 }));
    expect(deck).toContain(STRANGER);
    expect(deck).toContain(MAKING_A_MURDERER);
    expect(deck).toContain(GET_OUT);
  });

  it('a thriller that is not scary stays available to sam (Killing Eve)', () => {
    const ctx = makeCtx();
    expect(engine.isEligible(item('tv-72750'), req({ who: SAM, mood: 'gripped', novelty: 'either' }), ctx)).toBe(true);
  });

  it('ONE watcher\'s choice is enough, in an audience of any size', () => {
    const ctx = makeCtx({ members: FOUR });
    for (const who of audiencesOf(FOUR)) {
      const r = req({ who, mood: 'gripped', novelty: 'either' });
      const deck = ids(engine.buildDeck(r, ctx, { limit: 100 }));
      const withSam = who.includes('sam');
      const withDee = who.includes('dee');
      // sam: nothing flagged horror / true crime / scary.
      for (const id of [GET_OUT, HILL_HOUSE, STRANGER, MAKING_A_MURDERER]) {
        expect(engine.isEligible(item(id), r, ctx), `${id} for ${who.join('+')}`).toBe(!withSam);
        if (withSam) expect(deck).not.toContain(id);
      }
      // dee: no reality TV at all, and nothing not originally in English.
      for (const id of deck) {
        if (withDee) {
          expect(item(id).genres, `${id} for ${who.join('+')}`).not.toContain('reality');
          expect(item(id).lang).toBe('en');
        }
      }
      expect(engine.isEligible(item('tv-205715'), r, ctx)).toBe(!withDee); // The Traitors (reality)
      expect(engine.isEligible(item(SQUID_GAME), r, ctx)).toBe(!withDee); // Korean
    }
    // The people without those choices still get them when watching without sam and dee.
    const free = ids(engine.buildDeck(req({ who: ['alex', 'kit'], mood: 'gripped', novelty: 'new' }), ctx, { limit: 100 }));
    expect(free).toContain(STRANGER);
    expect(free).toContain('tv-205715');
    expect(free).toContain(SQUID_GAME);
  });

  it('WHOLE GENRES: a genre someone never wants is gone for any audience they are in — every title carrying it', () => {
    const ctx = makeCtx({ members: THREE, dealbreakers: { kit: { genres: ['animation', 'documentary'] } } });
    const banned = FIXTURE_CATALOG.items.filter((i) => i.genres.includes('animation') || i.genres.includes('documentary'));
    expect(banned.length).toBeGreaterThan(8);
    for (const who of audiencesOf(THREE)) {
      for (const mood of ['laugh', 'cozy', 'think', 'hyped'] as const) for (const novelty of NOVELTY) for (const viewing of ['focused', 'background'] as const) {
        const r = req({ who, mood, novelty, viewing });
        const deck = engine.buildDeck(r, ctx, { limit: 100 });
        for (const i of banned) expect(engine.isEligible(i, r, ctx) && who.includes('kit')).toBe(false);
        if (who.includes('kit')) for (const c of deck) expect(item(c.itemId).genres.some((g) => g === 'animation' || g === 'documentary'), `${c.itemId} for ${who.join('+')}`).toBe(false);
      }
    }
    // It is that person's choice only: alex alone still gets his animated favourites, even as a craving.
    const alex = ids(engine.buildDeck(req({ who: ALEX, mood: 'laugh', novelty: 'rewatch' }), ctx, { limit: 100 }));
    expect(alex).toContain(FAMILY_GUY);
    // A craving for a genre someone watching never wants gives nothing of that genre.
    const craving = engine.buildDeck(req({ who: ['alex', 'kit'], mood: 'laugh', genre: 'animation' }), ctx, { limit: 100 });
    for (const c of craving) expect(item(c.itemId).genres).not.toContain('animation');
    // Their own favourite in a genre they later excluded is excluded too (the choice is a hard rule).
    const own = makeCtx({ dealbreakers: { alex: { genres: ['animation'] } } });
    for (const novelty of NOVELTY) expect(ids(engine.buildDeck(req({ who: ALEX, novelty }), own, { limit: 100 }))).not.toContain(FAMILY_GUY);
  });

  it('NOTHING SUBTITLED: titles not originally in English are gone for any audience containing that person', () => {
    const foreign = FIXTURE_CATALOG.items.filter((i) => i.lang !== 'en').map((i) => i.id);
    expect(foreign.sort()).toEqual([DARK, SQUID_GAME].sort());
    const ctx = makeCtx({ dealbreakers: { alex: { subtitled: true } } });
    for (const novelty of NOVELTY) for (const mood of ['gripped', 'think', 'hyped'] as const) {
      for (const who of [ALEX, BOTH]) {
        const r = req({ who, mood, novelty });
        for (const id of foreign) expect(engine.isEligible(item(id), r, ctx)).toBe(false);
        for (const c of engine.buildDeck(r, ctx, { limit: 100 })) expect(item(c.itemId).lang).toBe('en');
      }
    }
    // sam alone: Squid Game is her favourite and still hers to rewatch.
    expect(ids(engine.buildDeck(req({ who: SAM, mood: 'gripped', novelty: 'rewatch' }), ctx, { limit: 100 }))).toContain(SQUID_GAME);
    // Without the choice, alex gets both.
    const open = ids(engine.buildDeck(req({ who: ALEX, mood: 'gripped', novelty: 'new' }), makeCtx(), { limit: 100 }));
    expect(open).toContain(SQUID_GAME);
    expect(open).toContain(DARK);
    // English-language titles are untouched, and a British or American variant code still counts as English.
    expect(engine.isEligible(item(GOT), req({ who: ALEX, mood: 'gripped' }), ctx)).toBe(true);
    const variant: CatalogItem = { ...item(OFFICE), id: 'tv-900020', tmdbId: 900020, lang: 'en-GB' };
    const french: CatalogItem = { ...item(OFFICE), id: 'tv-900021', tmdbId: 900021, lang: 'fr' };
    const cat = makeCtx({ catalog: { ...FIXTURE_CATALOG, items: [...FIXTURE_CATALOG.items, variant, french] }, dealbreakers: { alex: { subtitled: true } } });
    expect(engine.isEligible(variant, req({ who: ALEX }), cat)).toBe(true);
    expect(engine.isEligible(french, req({ who: ALEX }), cat)).toBe(false);
    expect(engine.isEligible(french, req({ who: SAM }), cat)).toBe(true);
  });

  it('the Scared mood is offered only when NO watcher has a horror or scary choice', () => {
    const ctx = makeCtx();
    expect(engine.availableMoods(ALEX, ctx)).toContain('scared');
    expect(engine.availableMoods(SAM, ctx)).not.toContain('scared');
    expect(engine.availableMoods(BOTH, ctx)).not.toContain('scared');
    expect(engine.availableMoods(SAM, ctx)).toHaveLength(MOODS.length - 1);
    expect(engine.availableMoods(ALEX, ctx)).toEqual(MOODS.map((m) => m.id));
    // Any audience, any household size: offered exactly when sam (the only one with such a choice) is not watching.
    for (const members of [SOLO_NEW, SOLO_SAM, THREE, FOUR]) {
      const c = makeCtx({ members });
      for (const who of audiencesOf(members)) expect(engine.availableMoods(who, c).includes('scared'), who.join('+')).toBe(!who.includes('sam'));
    }
    // Excluding the horror GENRE counts as a horror choice.
    const genre = makeCtx({ members: THREE, dealbreakers: { kit: { genres: ['horror'] } } });
    expect(engine.availableMoods(KIT, genre)).not.toContain('scared');
    expect(engine.availableMoods(['alex', 'kit'], genre)).not.toContain('scared');
    expect(engine.availableMoods(ALEX, genre)).toContain('scared');
    expect(engine.isEligible(item(GET_OUT), req({ who: KIT, mood: 'gripped' }), genre)).toBe(false);
    // Other choices (true crime, a genre, subtitles) do not take the mood away.
    expect(engine.availableMoods(DEE, makeCtx({ members: FOUR }))).toContain('scared');
    expect(engine.availableMoods(ALEX, makeCtx({ dealbreakers: { alex: { trueCrime: true } } }))).toContain('scared');
  });

  it('a Scared request from an audience that is not offered it returns an empty deck rather than leaking anything', () => {
    const ctx = makeCtx({ members: FOUR });
    for (const who of [SAM, BOTH, ['kit', 'sam'], ['alex', 'kit', 'sam'], FOUR.slice().sort()]) {
      for (const viewing of VIEWING) for (const time of TIMES) for (const novelty of NOVELTY) {
        const r = req({ who, mood: 'scared', viewing, time, novelty });
        expect(engine.buildDeck(r, ctx, { limit: 100 })).toEqual([]);
        for (const i of FIXTURE_CATALOG.items) expect(engine.isEligible(i, r, ctx)).toBe(false);
      }
    }
  });

  it("a Scared deck (for an audience that is offered it) contains only scary titles", () => {
    for (const [who, members] of [[ALEX, PAIR], [KIT, SOLO_NEW], [['alex', 'kit'], THREE]] as [Who, MemberId[]][]) {
      const deck = engine.buildDeck(req({ who, mood: 'scared' }), makeCtx({ members }), { limit: 100 });
      expect(deck.length).toBeGreaterThan(0);
      for (const c of deck) expect(item(c.itemId).moods.scared ?? 0).toBeGreaterThan(0);
      expect(ids(deck)).toContain(HILL_HOUSE);
      expect(ids(deck)).toContain(GET_OUT);
    }
  });

  it('the rule follows the choices on the profile: each one works on its own', () => {
    const ctx = makeCtx();
    ctx.state.profiles.sam.dealbreakers = { horror: false, trueCrime: true, scary: false, genres: [], subtitled: false };
    const r = req({ who: SAM, mood: 'gripped', novelty: 'either' });
    expect(engine.isEligible(item(MAKING_A_MURDERER), r, ctx)).toBe(false); // true crime still out
    expect(engine.isEligible(item(STRANGER), r, ctx)).toBe(true); // scary now allowed
    expect(engine.availableMoods(SAM, ctx)).toContain('scared');
    ctx.state.profiles.alex.dealbreakers = { horror: true, trueCrime: false, scary: false, genres: [], subtitled: false };
    expect(engine.availableMoods(ALEX, ctx)).not.toContain('scared');
    expect(engine.isEligible(item(GET_OUT), req({ who: ALEX, mood: 'gripped' }), ctx)).toBe(false);
    expect(engine.isEligible(item(GET_OUT), req({ who: BOTH, mood: 'gripped' }), ctx)).toBe(false);
  });

  it('a brand-new person has no choices: nothing is excluded for them, and nobody is assumed to have any', () => {
    const ctx = makeCtx({ members: SOLO_NEW });
    expect(ctx.state.profiles.kit.dealbreakers).toEqual({ horror: false, trueCrime: false, scary: false, genres: [], subtitled: false });
    const deck = ids(engine.buildDeck(req({ who: KIT, mood: 'gripped', novelty: 'new' }), ctx, { limit: 100 }));
    for (const id of [GET_OUT, STRANGER, MAKING_A_MURDERER, SQUID_GAME]) expect(deck).toContain(id);
    // Someone whose profile has not arrived yet is treated the same way (no hidden defaults).
    const missing = makeCtx({ members: THREE });
    delete (missing.state.profiles as Record<string, unknown>).kit;
    expect(engine.availableMoods(KIT, missing)).toContain('scared');
    expect(engine.isEligible(item(GET_OUT), req({ who: KIT, mood: 'gripped' }), missing)).toBe(true);
  });

  it('the New feed and the follow-ups hide them too', () => {
    const ctx = makeCtx();
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, ALEX, ctx).map((c) => c.itemId)).toContain(GET_OUT);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, SAM, ctx).map((c) => c.itemId)).not.toContain(GET_OUT);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, BOTH, ctx).map((c) => c.itemId)).not.toContain(GET_OUT);
    // dee never wants reality TV: The Traitors' new season is news for sam, but not for sam and dee together.
    const four = makeCtx({ members: FOUR });
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, SAM, four).map((c) => c.itemId)).toContain('tv-205715');
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, ['dee', 'sam'], four).map((c) => c.itemId)).not.toContain('tv-205715');
    expect(engine.followUps(SAM, four).map((f) => f.itemId)).toContain('tv-205715');
    expect(engine.followUps(['dee', 'sam'], four).map((f) => f.itemId)).not.toContain('tv-205715');
  });

  it('SWEEP: no card ever breaks a watcher’s choice, and no Scared deck is dealt to an audience not offered it', () => {
    expect(sweepFinds('rule2')).toEqual([]);
    expectExercised('rule2');
  }, 300_000);
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
    const low = FIXTURE_CATALOG.items.filter((i) => i.attention === 'low' && engine.chooseService(i, PLANS) && !i.flags.trueCrime);
    for (const i of low) for (const viewing of VIEWING) expect(engine.isEligible(i, req({ viewing, time: 120 }), ctx)).toBe(true);
    const focused = engine.buildDeck(req({ viewing: 'focused', mood: 'laugh' }), ctx, { limit: 100 });
    expect(focused.some((c) => item(c.itemId).attention === 'low')).toBe(true);
  });

  it('it is about attention, not about who is watching: the same for one person alone and for all four', () => {
    for (const members of [SOLO_NEW, FOUR]) {
      const ctx = makeCtx({ members });
      for (const who of audiencesOf(members)) {
        for (const viewing of ['background', 'eating'] as const) for (const mood of ['laugh', 'gripped', 'think'] as const) {
          const r = req({ who, viewing, mood });
          for (const c of engine.buildDeck(r, ctx, { limit: 100 })) expect(item(c.itemId).attention, `${c.itemId} for ${who.join('+')}`).toBe('low');
          expect(engine.isEligible(item(GOT), r, ctx)).toBe(false);
        }
      }
    }
    // A brand-new person still gets a full choice of easy things to have on.
    expect(engine.buildDeck(req({ who: KIT, viewing: 'background', mood: 'laugh' }), makeCtx({ members: SOLO_NEW }), { limit: 100 }).length).toBeGreaterThan(8);
  });

  it('While eating behaves exactly like Background', () => {
    for (const members of [PAIR, FOUR]) {
      for (const { ctx } of setups(members)) {
        for (const r of everyRequest(members).filter((_, k) => members.length === 2 || k % 4 === 0)) {
          if (r.viewing !== 'background') continue;
          expect(engine.buildDeck({ ...r, viewing: 'eating' }, ctx, { limit: 100 })).toEqual(engine.buildDeck(r, ctx, { limit: 100 }));
        }
      }
    }
  });

  it('SWEEP: every Background / While eating card is low attention', () => {
    expect(sweepFinds('rule3')).toEqual([]);
    expectExercised('rule3');
  }, 300_000);
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

  it('...for one person alone, a pair inside a household of four, and all four together', () => {
    const cases: [MemberId[], Who][] = [[SOLO_NEW, KIT], [FOUR, ['alex', 'dee']], [FOUR, ['kit', 'sam']], [FOUR, FOUR.slice().sort()]];
    for (const [members, who] of cases) {
      const ctx = makeCtx({ members });
      let cards = 0;
      for (const time of TIMES) for (const mood of ['laugh', 'cozy', 'gripped', 'feelgood'] as const) for (const novelty of NOVELTY) {
        for (const c of engine.buildDeck(req({ who, time, mood, novelty }), ctx, { limit: 100 })) {
          cards++;
          expect(c.minutes, `${c.itemId} for ${who.join('+')}`).toBeLessThanOrEqual(TIME_LIMIT_MINUTES[time]);
        }
      }
      expect(cards).toBeGreaterThan(50);
      expect(engine.isEligible(item(PADDINGTON), req({ who, time: 60, mood: 'feelgood' }), ctx)).toBe(false);
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
    const shortOne: CatalogItem = { ...item(BAKE_OFF), id: 'tv-900002', tmdbId: 900002, standout: [{ season: 2, episode: 3, name: 'Mini', runtime: 20 }] };
    const ctx3 = makeCtx({ catalog: { ...FIXTURE_CATALOG, items: [...FIXTURE_CATALOG.items, shortOne] } });
    expect(engine.choosePick(shortOne, req({ time: 20 }), ctx3)).toEqual({ pick: { type: 'episode', season: 2, episode: 3, name: 'Mini' }, minutes: 20 });
    const deck = engine.buildDeck(req({ time: 20, mood: 'cozy' }), ctx3, { limit: 100 });
    expect(deck.find((c) => c.itemId === 'tv-900002')?.minutes).toBe(20);
  });

  it('SWEEP: every card fits the time, and its minutes are the real length of what it tells you to watch', () => {
    expect(sweepFinds('rule4')).toEqual([]);
    expectExercised('rule4');
  }, 300_000);
});

// ---------------------------------------------------------------------------
describe('Rule 5: New excludes anything any watcher has seen; Rewatch needs at least one watcher to have seen it', () => {
  it('favourites count as seen', () => {
    const ctx = makeCtx();
    expect(engine.hasSeen('alex', SCRUBS, ctx)).toBe(true);
    expect(engine.hasSeen('sam', SCRUBS, ctx)).toBe(false);
    expect(engine.hasSeen('sam', FRIENDS, ctx)).toBe(true);
    expect(engine.hasSeen('alex', OFFICE, ctx)).toBe(false);
    expect(engine.hasSeen('alex', OFFICE, makeCtx({ seen: { alex: [OFFICE] } }))).toBe(true);
    // A favourite that is not in the catalog counts as seen as well (The Devil's Plan).
    expect(engine.hasSeen('alex', 'tv-222317', ctx)).toBe(true);
    // A brand-new person has seen nothing.
    const solo = makeCtx({ members: SOLO_NEW });
    for (const i of FIXTURE_CATALOG.items) expect(engine.hasSeen('kit', i.id, solo)).toBe(false);
  });

  it('New: a solo watcher never gets something they have seen (marked seen or a favourite)', () => {
    const ctx = makeCtx({ seen: { alex: [OFFICE] } });
    const deck = ids(engine.buildDeck(req({ who: ALEX, novelty: 'new' }), ctx, { limit: 100 }));
    expect(deck).not.toContain(OFFICE);
    expect(deck).not.toContain(SCRUBS);
    expect(deck).toContain(FRIENDS); // sam's favourite, but alex hasn't seen it
    expect(deck).toContain(PARKS);
  });

  it('New, two watching: excluded if EITHER of them has seen it', () => {
    const ctx = makeCtx({ seen: { alex: [OFFICE], sam: [PARKS] } });
    const deck = ids(engine.buildDeck(req({ who: BOTH, novelty: 'new' }), ctx, { limit: 100 }));
    for (const id of [OFFICE, PARKS, SCRUBS, FRIENDS, FAMILY_GUY]) expect(deck).not.toContain(id);
    expect(deck).toContain(BROOKLYN); // neither has seen it
  });

  it('New, three or four watching: excluded if ANY one of them has seen it', () => {
    const ctx = makeCtx({ members: FOUR, seen: { kit: [OFFICE], dee: [PARKS] } });
    const all = FOUR.slice().sort();
    const deck = ids(engine.buildDeck(req({ who: all, novelty: 'new' }), ctx, { limit: 100 }));
    // Office: only kit. Parks: only dee. Scrubs: alex's favourite. Friends: sam's. Succession: dee's.
    for (const id of [OFFICE, PARKS, SCRUBS, FRIENDS, SUCCESSION]) {
      expect(deck).not.toContain(id);
      expect(engine.isEligible(item(id), req({ who: all, novelty: 'new' }), ctx)).toBe(false);
    }
    expect(deck).toContain(BROOKLYN); // none of the four has seen it
    // Leave out the one person who has seen it and it is new again for the rest.
    expect(ids(engine.buildDeck(req({ who: ['alex', 'dee', 'sam'], novelty: 'new' }), ctx, { limit: 100 }))).toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: ['alex', 'kit', 'sam'], novelty: 'new' }), ctx, { limit: 100 }))).toContain(PARKS);
    expect(ids(engine.buildDeck(req({ who: ['alex', 'kit', 'sam'], novelty: 'new' }), ctx, { limit: 100 }))).not.toContain(OFFICE);
  });

  it('Rewatch: only titles the watcher has seen', () => {
    const ctx = makeCtx({ seen: { alex: [OFFICE] } });
    const deck = ids(engine.buildDeck(req({ who: ALEX, novelty: 'rewatch' }), ctx, { limit: 100 }));
    expect(deck).toContain(OFFICE);
    expect(deck).toContain(SCRUBS);
    expect(deck).not.toContain(FRIENDS);
    expect(deck).not.toContain(PARKS);
    for (const id of deck) expect(engine.hasSeen('alex', id, ctx)).toBe(true);
  });

  it('Rewatch, two watching: included if AT LEAST ONE of them has seen it', () => {
    const ctx = makeCtx({ seen: { sam: [PARKS] } });
    const deck = ids(engine.buildDeck(req({ who: BOTH, novelty: 'rewatch' }), ctx, { limit: 100 }));
    expect(deck).toContain(PARKS); // only sam has seen it
    expect(deck).toContain(SCRUBS); // only alex (favourite)
    expect(deck).toContain(FAMILY_GUY); // both
    expect(deck).not.toContain(OFFICE); // neither
  });

  it('Rewatch, three or four watching: one watcher having seen it is enough; nobody having seen it is not', () => {
    const ctx = makeCtx({ members: FOUR, seen: { kit: [OFFICE] } });
    const all = FOUR.slice().sort();
    const deck = ids(engine.buildDeck(req({ who: all, novelty: 'rewatch' }), ctx, { limit: 100 }));
    expect(deck).toContain(OFFICE); // only kit, the newcomer, has seen it
    expect(deck).toContain(SCRUBS); // only alex
    expect(deck).not.toContain(PARKS); // none of them
    for (const id of deck) expect(all.some((p) => engine.hasSeen(p, id, ctx)), id).toBe(true);
    // Without kit, The Office is no longer anyone's rewatch.
    expect(ids(engine.buildDeck(req({ who: ['alex', 'dee', 'sam'], novelty: 'rewatch' }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    // Alone in a household of one, having seen nothing: there is nothing to rewatch.
    const solo = makeCtx({ members: SOLO_NEW });
    expect(engine.buildDeck(req({ who: KIT, novelty: 'rewatch' }), solo, { limit: 100 })).toEqual([]);
    expect(ids(engine.buildDeck(req({ who: KIT, novelty: 'rewatch' }), makeCtx({ members: SOLO_NEW, seen: { kit: [OFFICE] } }), { limit: 100 }))).toEqual([OFFICE]);
  });

  // 'either' leans new (about one card in ten is a rewatch), so a particular favourite is not guaranteed a place.
  it('Either: both seen and unseen titles are allowed (it is not a gate), mostly unseen', () => {
    const ctx = makeCtx();
    for (const i of [item(SCRUBS), item(OFFICE)]) expect(engine.isEligible(i, req({ who: ALEX, novelty: 'either' }), ctx)).toBe(true);
    const deck = ids(engine.buildDeck(req({ who: ALEX, novelty: 'either' }), ctx, { limit: 100 }));
    const seen = deck.filter((id) => engine.hasSeen('alex', id, ctx));
    expect(deck).toContain(OFFICE);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.length).toBeLessThan(deck.length / 4);
  });

  it('Either leans new for a group too: a title seen by ANY watcher counts as the rewatch, and they stay a small share', () => {
    const ctx = makeCtx({ members: FOUR, seen: { kit: [OFFICE, PARKS] } });
    const all = FOUR.slice().sort();
    const deck = ids(engine.buildDeck(req({ who: all, novelty: 'either' }), ctx, { limit: 100 }));
    const seen = deck.filter((id) => all.some((p) => engine.hasSeen(p, id, ctx)));
    expect(seen.length).toBeLessThan(deck.length / 4);
    expect(engine.hasSeen('alex', deck[0], ctx) || engine.hasSeen('sam', deck[0], ctx) || engine.hasSeen('kit', deck[0], ctx) || engine.hasSeen('dee', deck[0], ctx)).toBe(false);
  });

  it('SWEEP: no New card has been seen by a watcher; every Rewatch card has been seen by at least one', () => {
    expect(sweepFinds('rule5')).toEqual([]);
    expectExercised('rule5');
  }, 300_000);
});

// ---------------------------------------------------------------------------
describe('Rule 6: when a title is on several of the household\'s services, an ad-free one is shown', () => {
  it('How I Met Your Mother is on Hulu (ads) and Netflix (ad-free): we send them to Netflix', () => {
    expect(engine.chooseService(item(HIMYM), PLANS)).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
    // Asks for a rewatch (it is alex's favourite), since an 'either' deck does not deal every seen title.
    const card = engine.buildDeck(req({ who: ALEX, novelty: 'rewatch' }), makeCtx(), { limit: 100 }).find((c) => c.itemId === HIMYM);
    expect(card?.service).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
  });

  it('Community is on Netflix, Hulu and Peacock: Netflix (the only ad-free one) wins', () => {
    expect(engine.chooseService(item(COMMUNITY), PLANS)).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
  });

  it('when every option has ads the choice is still deterministic (fixed service order)', () => {
    // South Park: HBO Max and Paramount+, both with ads. Abbott Elementary: Hulu and HBO Max, both with ads.
    for (let k = 0; k < 5; k++) {
      expect(engine.chooseService(item(SOUTH_PARK), PLANS)).toEqual({ serviceId: 'hbo', planId: 'ads', adFree: false });
      expect(engine.chooseService(item(ABBOTT), PLANS)).toEqual({ serviceId: 'hulu', planId: 'ads', adFree: false });
    }
    // Provider order in the catalog must not matter.
    const reversed = { ...item(SOUTH_PARK), providers: [...item(SOUTH_PARK).providers].reverse() };
    expect(engine.chooseService(reversed, PLANS)).toEqual({ serviceId: 'hbo', planId: 'ads', adFree: false });
    // Nor the order the settings happen to list the services in.
    const shuffled: PlanSelection = Object.fromEntries(Object.entries(PLANS).reverse());
    expect(engine.chooseService(item(SOUTH_PARK), shuffled)).toEqual({ serviceId: 'hbo', planId: 'ads', adFree: false });
    expect(engine.chooseService(item(ABBOTT), shuffled)).toEqual({ serviceId: 'hulu', planId: 'ads', adFree: false });
  });

  it('when several ad-free services carry it the choice is deterministic too', () => {
    const allAdFree: PlanSelection = { netflix: 'standard', hulu: 'noads', peacock: 'premium-plus' };
    for (let k = 0; k < 3; k++) expect(engine.chooseService(item(COMMUNITY), allAdFree)).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
    const reversed = { ...item(COMMUNITY), providers: [...item(COMMUNITY).providers].reverse() };
    expect(engine.chooseService(reversed, allAdFree)).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
    expect(engine.chooseService(item(COMMUNITY), { hulu: 'noads', peacock: 'premium-plus' })).toEqual({ serviceId: 'hulu', planId: 'noads', adFree: true });
  });

  it('follows the plans in settings: upgrading one service to ad-free makes it the choice', () => {
    expect(engine.chooseService(item(SOUTH_PARK), { ...PLANS, paramount: 'premium' })).toEqual({ serviceId: 'paramount', planId: 'premium', adFree: true });
    expect(engine.chooseService(item(ABBOTT), { ...PLANS, hbo: 'adfree' })).toEqual({ serviceId: 'hbo', planId: 'adfree', adFree: true });
    // Downgrading Netflix to the ad plan: HIMYM is now ads everywhere, and Netflix-with-ads carries Glass Onion.
    const adsNetflix = { ...PLANS, netflix: 'ads' };
    expect(engine.chooseService(item(HIMYM), adsNetflix)).toEqual({ serviceId: 'hulu', planId: 'ads', adFree: false });
    expect(engine.chooseService(item(GLASS_ONION), adsNetflix)).toEqual({ serviceId: 'netflix', planId: 'ads', adFree: false });
    expect(engine.chooseService(item(GLASS_ONION), PLANS)).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
  });

  it('every audience of every household is sent to the same, ad-free, service for the same title', () => {
    for (const members of [SOLO_SAM, THREE, FOUR]) {
      const ctx = makeCtx({ members });
      for (const who of audiencesOf(members)) {
        for (const novelty of NOVELTY) {
          for (const c of engine.buildDeck(req({ who, novelty, mood: 'laugh' }), ctx, { limit: 100 })) {
            expect(c.service, `${c.itemId} for ${who.join('+')}`).toEqual(engine.chooseService(item(c.itemId), PLANS));
            if (c.itemId === HIMYM || c.itemId === COMMUNITY) expect(c.service).toEqual({ serviceId: 'netflix', planId: 'standard', adFree: true });
          }
        }
      }
    }
  });

  it('SWEEP: every card shows an ad-free service whenever one of ours carries the title', () => {
    expect(sweepFinds('rule6')).toEqual([]);
    expectExercised('rule6');
  }, 300_000);
});

// ---------------------------------------------------------------------------
describe('Rule 7: Never', () => {
  it("hides the title for the person who tapped it, and from any group they are in — but not from the other person's solo decks", () => {
    const ctx = makeCtx({ never: { alex: [OFFICE] } });
    expect(engine.isNeverHidden(OFFICE, ALEX, ctx)).toBe(true);
    expect(engine.isNeverHidden(OFFICE, BOTH, ctx)).toBe(true);
    expect(engine.isNeverHidden(OFFICE, SAM, ctx)).toBe(false);
    expect(ids(engine.buildDeck(req({ who: ALEX }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: BOTH }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: SAM }), ctx, { limit: 100 }))).toContain(OFFICE);
  });

  it('works the same way round for the other person', () => {
    const ctx = makeCtx({ never: { sam: [PARKS] } });
    expect(ids(engine.buildDeck(req({ who: SAM }), ctx, { limit: 100 }))).not.toContain(PARKS);
    expect(ids(engine.buildDeck(req({ who: BOTH }), ctx, { limit: 100 }))).not.toContain(PARKS);
    expect(ids(engine.buildDeck(req({ who: ALEX }), ctx, { limit: 100 }))).toContain(PARKS);
  });

  it('household of two: once both have tapped Never it is gone everywhere', () => {
    const ctx = makeCtx({ never: { alex: [OFFICE], sam: [OFFICE] } });
    for (const who of audiencesOf(PAIR)) {
      expect(engine.isNeverHidden(OFFICE, who, ctx)).toBe(true);
      for (const r of requestsFor(who)) expect(engine.isEligible(item(OFFICE), r, ctx)).toBe(false);
      expect(ids(engine.buildDeck(req({ who }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    }
  });

  it('household of ONE: that person\'s Never hides it everywhere', () => {
    const ctx = makeCtx({ members: SOLO_NEW, never: { kit: [OFFICE] } });
    expect(engine.isNeverHidden(OFFICE, KIT, ctx)).toBe(true);
    // "Everywhere" means for any audience at all, even one that does not name them.
    expect(engine.isNeverHidden(OFFICE, [], ctx)).toBe(true);
    expect(engine.isNeverHidden(OFFICE, ['someone-else'], ctx)).toBe(true);
    for (const r of requestsFor(KIT)) {
      expect(engine.isEligible(item(OFFICE), r, ctx)).toBe(false);
      if (r.viewing === 'focused' && r.time === 120) expect(ids(engine.buildDeck(r, ctx, { limit: 100 }))).not.toContain(OFFICE);
    }
    expect(engine.isNeverHidden(PARKS, KIT, ctx)).toBe(false);
    expect(ids(engine.buildDeck(req({ who: KIT }), ctx, { limit: 100 }))).toContain(PARKS);
  });

  it('household of three or four: hidden for every audience CONTAINING someone who tapped it, and for no other', () => {
    for (const members of [THREE, FOUR]) {
      const ctx = makeCtx({ members, never: { alex: [OFFICE], kit: [PARKS] } });
      for (const who of audiencesOf(members)) {
        const label = `${who.join('+')} of ${members.length}`;
        expect(engine.isNeverHidden(OFFICE, who, ctx), label).toBe(who.includes('alex'));
        expect(engine.isNeverHidden(PARKS, who, ctx), label).toBe(who.includes('kit'));
        const deck = ids(engine.buildDeck(req({ who, novelty: 'new' }), ctx, { limit: 100 }));
        expect(deck.includes(OFFICE), label).toBe(!who.includes('alex'));
        expect(deck.includes(PARKS), label).toBe(!who.includes('kit'));
        expect(engine.isEligible(item(OFFICE), req({ who }), ctx), label).toBe(!who.includes('alex'));
      }
    }
  });

  it('household of three or four: gone everywhere only once EVERY member has tapped it', () => {
    for (const members of [THREE, FOUR]) {
      // Everyone but the last member has tapped it: it is still there for that last member alone.
      const last = members[members.length - 1];
      const most = makeCtx({ members, never: Object.fromEntries(members.slice(0, -1).map((m) => [m, [OFFICE]])) });
      for (const who of audiencesOf(members)) {
        const onlyLast = who.length === 1 && who[0] === last;
        expect(engine.isNeverHidden(OFFICE, who, most), who.join('+')).toBe(!onlyLast);
      }
      expect(ids(engine.buildDeck(req({ who: [last], novelty: 'new' }), most, { limit: 100 }))).toContain(OFFICE);
      // The last one taps it too: gone for every audience.
      const all = makeCtx({ members, never: Object.fromEntries(members.map((m) => [m, [OFFICE]])) });
      for (const who of audiencesOf(members)) {
        expect(engine.isNeverHidden(OFFICE, who, all)).toBe(true);
        for (const novelty of NOVELTY) expect(engine.isEligible(item(OFFICE), req({ who, novelty }), all)).toBe(false);
        expect(ids(engine.buildDeck(req({ who }), all, { limit: 100 }))).not.toContain(OFFICE);
      }
      expect(engine.isNeverHidden(OFFICE, [], all)).toBe(true);
    }
  });

  it('"every member" means the household as it is now: someone who has left does not count, a newcomer does', () => {
    // alex and sam both tapped it when they were the whole household; then kit joined.
    const grown = makeCtx({ members: THREE, never: { alex: [OFFICE], sam: [OFFICE] } });
    expect(engine.isNeverHidden(OFFICE, KIT, grown)).toBe(false);
    expect(ids(engine.buildDeck(req({ who: KIT, novelty: 'new' }), grown, { limit: 100 }))).toContain(OFFICE);
    // A leftover Never list from someone no longer in the household neither hides anything nor is needed.
    const left = makeCtx({ never: { alex: [OFFICE], sam: [OFFICE] } });
    (left.state.never as Record<string, Record<string, number>>).gone = {};
    expect(engine.isNeverHidden(OFFICE, ALEX, left)).toBe(true);
    const leftover = makeCtx({ never: { alex: [PARKS] } });
    (leftover.state.never as Record<string, Record<string, number>>).gone = { [OFFICE]: 1, [PARKS]: 1 };
    expect(engine.isNeverHidden(OFFICE, ALEX, leftover)).toBe(false);
    expect(engine.isNeverHidden(PARKS, SAM, leftover)).toBe(false);
  });

  it('applies to the New feed as well', () => {
    const one = makeCtx({ never: { alex: [PADDINGTON] } });
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, ALEX, one).map((c) => c.itemId)).not.toContain(PADDINGTON);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, BOTH, one).map((c) => c.itemId)).not.toContain(PADDINGTON);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, SAM, one).map((c) => c.itemId)).toContain(PADDINGTON);
    const both = makeCtx({ never: { alex: [PADDINGTON], sam: [PADDINGTON] } });
    for (const who of audiencesOf(PAIR)) expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, who, both).map((c) => c.itemId)).not.toContain(PADDINGTON);
    const three = makeCtx({ members: THREE, never: { alex: [PADDINGTON], sam: [PADDINGTON] } });
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, KIT, three).map((c) => c.itemId)).toContain(PADDINGTON);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, ['kit', 'sam'], three).map((c) => c.itemId)).not.toContain(PADDINGTON);
  });

  it('a title nobody tapped is not hidden', () => {
    const ctx = makeCtx({ never: { alex: [OFFICE] } });
    for (const who of audiencesOf(PAIR)) expect(engine.isNeverHidden(PARKS, who, ctx)).toBe(false);
    const four = makeCtx({ members: FOUR });
    for (const who of audiencesOf(FOUR)) expect(engine.isNeverHidden(PARKS, who, four)).toBe(false);
  });

  it('SWEEP: no card was ever one its audience had tapped Never on, or one the whole household had', () => {
    expect(sweepFinds('rule7')).toEqual([]);
    expectExercised('rule7');
  }, 300_000);
});

// ---------------------------------------------------------------------------
describe('Rule 8: a title sitting in Matches is left out for any audience that overlaps the pick\'s people', () => {
  const deckHas = (id: string, who: Who, ctx: EngineContext) => ids(engine.buildDeck(req({ who, novelty: 'new' }), ctx, { limit: 100 })).includes(id);

  it("one person's solo pick hides the title from them and from the pair, but not from the other person alone", () => {
    const ctx = makeCtx({ picks: [{ itemId: OFFICE, who: ALEX }] });
    expect(engine.isPicked(OFFICE, ALEX, ctx)).toBe(true);
    expect(engine.isPicked(OFFICE, BOTH, ctx)).toBe(true);
    expect(engine.isPicked(OFFICE, SAM, ctx)).toBe(false);
    expect(deckHas(OFFICE, ALEX, ctx)).toBe(false);
    expect(deckHas(OFFICE, BOTH, ctx)).toBe(false);
    expect(deckHas(OFFICE, SAM, ctx)).toBe(true);
    expect(engine.isEligible(item(OFFICE), req({ who: ALEX }), ctx)).toBe(false);
    expect(engine.isEligible(item(OFFICE), req({ who: BOTH }), ctx)).toBe(false);
    expect(engine.isEligible(item(OFFICE), req({ who: SAM }), ctx)).toBe(true);
    expect(engine.isPicked(PARKS, ALEX, ctx)).toBe(false);
  });

  it("the same the other way round for the other person's solo pick", () => {
    const ctx = makeCtx({ picks: [{ itemId: OFFICE, who: SAM }] });
    expect([ALEX, SAM, BOTH].map((w) => engine.isPicked(OFFICE, w, ctx))).toEqual([false, true, true]);
    expect([ALEX, SAM, BOTH].map((w) => deckHas(OFFICE, w, ctx))).toEqual([true, false, false]);
  });

  it('a match for the pair hides it from each of them and from the pair', () => {
    const ctx = makeCtx({ picks: [{ itemId: OFFICE, who: BOTH }] });
    for (const who of audiencesOf(PAIR)) {
      expect(engine.isPicked(OFFICE, who, ctx)).toBe(true);
      expect(deckHas(OFFICE, who, ctx)).toBe(false);
      for (const novelty of NOVELTY) expect(engine.isEligible(item(OFFICE), req({ who, novelty }), ctx)).toBe(false);
    }
  });

  it('household of one: a right-swipe takes the title out of that person\'s decks', () => {
    const ctx = makeCtx({ members: SOLO_NEW, picks: [{ itemId: OFFICE, who: KIT }] });
    expect(engine.isPicked(OFFICE, KIT, ctx)).toBe(true);
    expect(deckHas(OFFICE, KIT, ctx)).toBe(false);
    for (const novelty of NOVELTY) expect(engine.isEligible(item(OFFICE), req({ who: KIT, novelty }), ctx)).toBe(false);
    expect(deckHas(PARKS, KIT, ctx)).toBe(true);
  });

  it('household of four: hidden for exactly the audiences that share a member with the pick', () => {
    // A solo pick (kit), a match for a pair inside the household (alex + sam), and a match for three.
    const ctx = makeCtx({ members: FOUR, picks: [{ itemId: OFFICE, who: KIT }, { itemId: PARKS, who: BOTH }, { itemId: BROOKLYN, who: ['alex', 'dee', 'kit'] }] });
    for (const who of audiencesOf(FOUR)) {
      const label = who.join('+');
      const office = who.includes('kit');
      const parks = who.includes('alex') || who.includes('sam');
      const brooklyn = who.includes('alex') || who.includes('dee') || who.includes('kit');
      expect(engine.isPicked(OFFICE, who, ctx), label).toBe(office);
      expect(engine.isPicked(PARKS, who, ctx), label).toBe(parks);
      expect(engine.isPicked(BROOKLYN, who, ctx), label).toBe(brooklyn);
      expect(deckHas(OFFICE, who, ctx), label).toBe(!office);
      expect(deckHas(PARKS, who, ctx), label).toBe(!parks);
      expect(deckHas(BROOKLYN, who, ctx), label).toBe(!brooklyn);
      expect(engine.isEligible(item(PARKS), req({ who }), ctx), label).toBe(!parks);
    }
    // In particular: the pair's match is still on offer to the other two, alone or together.
    expect(deckHas(PARKS, ['dee', 'kit'], ctx)).toBe(true);
    // ...and a match for all four hides it from everyone.
    const all = makeCtx({ members: FOUR, picks: [{ itemId: OFFICE, who: FOUR.slice().sort() }] });
    for (const who of audiencesOf(FOUR)) expect(engine.isPicked(OFFICE, who, all)).toBe(true);
  });

  it('removing the pick brings it back', () => {
    const ctx = makeCtx({ picks: [{ itemId: OFFICE, who: BOTH }, { itemId: PARKS, who: ALEX }] });
    expect(deckHas(OFFICE, ALEX, ctx)).toBe(false);
    ctx.state.picks = ctx.state.picks.filter((p) => p.itemId !== OFFICE);
    for (const who of audiencesOf(PAIR)) {
      expect(engine.isPicked(OFFICE, who, ctx)).toBe(false);
      expect(deckHas(OFFICE, who, ctx)).toBe(true);
    }
    expect(deckHas(PARKS, ALEX, ctx)).toBe(false); // the other pick is untouched
  });

  it('a picked favourite is left out of rewatch and either decks too', () => {
    const ctx = makeCtx({ picks: [{ itemId: SCRUBS, who: ALEX }] });
    for (const novelty of ['rewatch', 'either'] as const) {
      expect(ids(engine.buildDeck(req({ who: ALEX, novelty }), ctx, { limit: 100 }))).not.toContain(SCRUBS);
    }
    expect(ids(engine.buildDeck(req({ who: ALEX, novelty: 'rewatch' }), makeCtx(), { limit: 100 }))).toContain(SCRUBS);
  });

  it('picked titles are left out of the New feed and the follow-ups', () => {
    const HOTD = 'tv-94997';
    const none = makeCtx();
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, ALEX, none).map((c) => c.itemId)).toContain(PADDINGTON);
    expect(engine.followUps(ALEX, none).map((f) => f.itemId)).toContain(HOTD);
    const ctx = makeCtx({ picks: [{ itemId: PADDINGTON, who: ALEX }, { itemId: HOTD, who: BOTH }] });
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, ALEX, ctx).map((c) => c.itemId)).not.toContain(PADDINGTON);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, BOTH, ctx).map((c) => c.itemId)).not.toContain(PADDINGTON);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, SAM, ctx).map((c) => c.itemId)).toContain(PADDINGTON);
    expect(engine.followUps(ALEX, ctx).map((f) => f.itemId)).not.toContain(HOTD);
  });

  it('once someone it was picked for marks it watched (after picking it), it is an ordinary seen title again', () => {
    const picked = dayMs('2026-10-08');
    const ctx = makeCtx({ seen: { alex: { [OFFICE]: '2026-10-09' } } });
    ctx.state.picks = [makePick(OFFICE, ALEX, picked)];
    expect(engine.isPicked(OFFICE, ALEX, ctx)).toBe(false);
    expect(ids(engine.buildDeck(req({ who: ALEX, novelty: 'rewatch' }), ctx, { limit: 100 }))).toContain(OFFICE);
    // Watched BEFORE it was picked (a rewatch they swiped right on): still waiting on the Matches tab.
    const earlier = makeCtx({ seen: { alex: { [OFFICE]: '2026-10-01' } } });
    earlier.state.picks = [makePick(OFFICE, ALEX, picked)];
    expect(engine.isPicked(OFFICE, ALEX, earlier)).toBe(true);
    // Someone else watching it does not clear this person's pick.
    const other = makeCtx({ seen: { sam: { [OFFICE]: '2026-10-09' } } });
    other.state.picks = [makePick(OFFICE, ALEX, picked)];
    expect(engine.isPicked(OFFICE, ALEX, other)).toBe(true);
    // A match for three: any one of the three marking it watched afterwards clears it for all of them.
    const three = makeCtx({ members: FOUR, seen: { kit: { [OFFICE]: '2026-10-09' } } });
    three.state.picks = [makePick(OFFICE, ['alex', 'kit', 'sam'], picked)];
    for (const who of audiencesOf(FOUR)) expect(engine.isPicked(OFFICE, who, three)).toBe(false);
  });

  it('copes with households that have no picks list yet', () => {
    const ctx = makeCtx();
    (ctx.state as { picks?: unknown }).picks = undefined;
    expect(engine.isPicked(OFFICE, ALEX, ctx)).toBe(false);
    expect(engine.buildDeck(req(), ctx).length).toBeGreaterThan(5);
    expect(engine.followUps(BOTH, ctx).length).toBeGreaterThan(0);
  });

  it('SWEEP: no card was already on the Matches tab for someone watching', () => {
    expect(sweepFinds('rule8')).toEqual([]);
    expectExercised('rule8');
  }, 300_000);
});

// ---------------------------------------------------------------------------
describe('Also: "not tonight", already-dealt cards, and audiences', () => {
  it('"not tonight" hides the title from that person today, and from any group they are in', () => {
    const ctx = makeCtx({ notTonight: { alex: { [OFFICE]: TODAY } } });
    expect(ids(engine.buildDeck(req({ who: ALEX }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: BOTH }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: SAM }), ctx, { limit: 100 }))).toContain(OFFICE);
    expect(engine.isEligible(item(OFFICE), req({ who: ALEX }), ctx)).toBe(false);
    const four = makeCtx({ members: FOUR, notTonight: { kit: { [OFFICE]: TODAY } } });
    for (const who of audiencesOf(FOUR)) {
      expect(ids(engine.buildDeck(req({ who, novelty: 'new' }), four, { limit: 100 })).includes(OFFICE), who.join('+')).toBe(!who.includes('kit'));
    }
  });

  it('it comes back another day', () => {
    const tomorrow = makeCtx({ notTonight: { alex: { [OFFICE]: TODAY } }, today: '2026-10-11' });
    expect(ids(engine.buildDeck(req({ who: ALEX }), tomorrow, { limit: 100 }))).toContain(OFFICE);
    expect(ids(engine.buildDeck(req({ who: BOTH }), tomorrow, { limit: 100 }))).toContain(OFFICE);
    const swipedYesterday = makeCtx({ notTonight: { sam: { [OFFICE]: '2026-10-09' } } });
    expect(ids(engine.buildDeck(req({ who: SAM }), swipedYesterday, { limit: 100 }))).toContain(OFFICE);
  });

  it('SWEEP: no card was swiped "not tonight" today by someone watching', () => {
    expect(sweepFinds('notTonight')).toEqual([]);
    expectExercised('notTonight');
  }, 300_000);

  it('ids passed in `exclude` are never returned', () => {
    for (const [members, who] of [[PAIR, BOTH], [FOUR, FOUR.slice().sort()], [SOLO_NEW, KIT]] as [MemberId[], Who][]) {
      const ctx = makeCtx({ members });
      const first = engine.buildDeck(req({ who }), ctx, { limit: 5 });
      const more = engine.buildDeck(req({ who }), ctx, { limit: 100, exclude: ids(first) });
      for (const id of ids(first)) expect(ids(more)).not.toContain(id);
      expect(more.length).toBeGreaterThan(0);
    }
  });

  it('a deck never contains the same title twice', () => {
    for (const members of HOUSEHOLDS) {
      for (const { ctx } of setups(members)) {
        for (const r of everyRequest(members).filter((_, k) => k % (7 * members.length) === 0)) {
          const deck = ids(engine.buildDeck(r, ctx, { limit: 100, seed: 5 }));
          expect(new Set(deck).size).toBe(deck.length);
        }
      }
    }
  });

  it('an audience is a set of people: the order they are listed in does not change the deck', () => {
    const ctx = makeCtx({ members: FOUR, seen: { kit: [OFFICE] } });
    const sorted = engine.buildDeck(req({ who: ['alex', 'dee', 'kit', 'sam'], mood: 'cozy' }), ctx, { limit: 100, seed: 4 });
    const jumbled = engine.buildDeck(req({ who: ['sam', 'kit', 'alex', 'dee'], mood: 'cozy' }), ctx, { limit: 100, seed: 4 });
    expect(ids(jumbled)).toEqual(ids(sorted));
    expect(jumbled.map((c) => c.score)).toEqual(sorted.map((c) => c.score));
  });

  it('nobody watching: nothing is suggested and nothing fails', () => {
    const ctx = makeCtx();
    expect(engine.buildDeck(req({ who: [] }), ctx)).toEqual([]);
    expect(engine.isEligible(item(OFFICE), req({ who: [] }), ctx)).toBe(false);
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, [], ctx)).toEqual([]);
    expect(engine.followUps([], ctx)).toEqual([]);
  });

  it('no rule mentions a particular person: giving the same people different ids changes nothing', () => {
    // The pair again, but with the ids a real household gets from the sync layer.
    const sample = makeCtx({ seen: { alex: [OFFICE], sam: [PARKS] }, never: { sam: [BROOKLYN] } });
    const renamed = makeCtx({
      members: ['m1', 'm2'],
      favorites: { m1: sample.state.profiles.alex.favorites, m2: sample.state.profiles.sam.favorites },
      dealbreakers: { m1: sample.state.profiles.alex.dealbreakers, m2: sample.state.profiles.sam.dealbreakers },
      seen: { m1: [OFFICE], m2: [PARKS] },
      never: { m2: [BROOKLYN] },
    });
    const pairs: [Who, Who][] = [[ALEX, ['m1']], [SAM, ['m2']], [BOTH, ['m1', 'm2']]];
    for (const [a, b] of pairs) {
      for (const mood of ['laugh', 'gripped', 'cozy', 'scared'] as const) for (const novelty of NOVELTY) {
        const x = engine.buildDeck(req({ who: a, mood, novelty }), sample, { limit: 100 });
        const y = engine.buildDeck(req({ who: b, mood, novelty }), renamed, { limit: 100 });
        expect(ids(y)).toEqual(ids(x));
        expect(y.map((c) => c.score)).toEqual(x.map((c) => c.score));
      }
      expect(engine.availableMoods(b, renamed)).toEqual(engine.availableMoods(a, sample));
    }
  });
});
