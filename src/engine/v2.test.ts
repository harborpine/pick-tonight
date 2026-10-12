/**
 * Version 2 behaviour: the "any" time, picks (the Matches tab), watched entries
 * as objects, "either" as a lean towards new, and follow-ups.
 * (The seven original rules, with "any" and picks added to the sweeps, are in rules.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { EITHER_REWATCH_SHARE, MOODS, TIME_LIMIT_MINUTES, watchers, type Catalog, type CatalogItem, type DeckCard, type EngineContext, type SuggestRequest, type Who } from '../contracts';
import { FIXTURE_CATALOG, FIXTURE_NEW_ARRIVALS } from '../contracts/fixtures/catalog';
import { createEngine } from './index';
import { ALEX, BOTH, dayMs, itemsById, makeCtx, makePick, req, SAM, syntheticCatalog, TODAY, withFavorites } from './testkit';

const engine = createEngine();
const byId = itemsById(FIXTURE_CATALOG);
const item = (id: string) => byId.get(id)!;
const ids = (deck: DeckCard[]) => deck.map((c) => c.itemId);
const WHO: Who[] = [ALEX, SAM, BOTH];

const OFFICE = 'tv-2316';
const PARKS = 'tv-8592';
const GOT = 'tv-1399';
const HOTD = 'tv-94997'; // House of the Dragon, spinoff of Game of Thrones
const ABBOTT = 'tv-125935'; // season 4 started 2026-10-07
const TRAITORS = 'tv-205715'; // season 3 started 2026-10-05; Sam favourite
const BEAR = 'tv-136315'; // season 3 started 2026-09-25
const GREYS = 'tv-1416'; // season 21 started 2026-10-01; favourite of both
const SCRUBS = 'tv-4556'; // Alex favourite, last season 2009
const PADDINGTON = 'movie-346648';

/** A blank title to build made-up catalogs from. */
function title(id: number, over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: `tv-${id}`, tmdbId: id, kind: 'tv', title: `Title ${id}`, year: 2015, genres: ['drama'], keywords: [], related: [], poster: null, backdrop: null,
    overview: '', lang: 'en', runtime: 45, seasons: 3, rating: 7.5, votes: 1000, popularity: 50, providers: [8], attention: 'medium', moods: { gripped: 0.8 },
    dropIn: false, standout: [], flags: { horror: false, trueCrime: false, scary: false }, ...over,
  };
}
/** A made-up catalog; nobody has any favourites. */
const bare = (items: CatalogItem[]): Catalog => withFavorites({ schema: 1, builtAt: '2026-10-10T00:00:00.000Z', items }, {});

// ---------------------------------------------------------------------------
describe('time "any" (I don\'t care)', () => {
  it('applies no limit: everything that fits "2+ hrs" fits "any", for every title and audience', () => {
    const ctx = makeCtx();
    expect(TIME_LIMIT_MINUTES.any).toBe(Number.POSITIVE_INFINITY);
    for (const who of WHO) for (const mood of MOODS.map((m) => m.id)) {
      for (const i of FIXTURE_CATALOG.items) {
        expect(engine.isEligible(i, req({ who, mood, time: 'any' }), ctx)).toBe(engine.isEligible(i, req({ who, mood, time: 120 }), ctx));
      }
    }
    expect(engine.choosePick(item('movie-27205'), req({ time: 'any' }), ctx)).toEqual({ pick: { type: 'movie' }, minutes: 148 });
    expect(engine.choosePick(item(GOT), req({ time: 'any' }), ctx)).toEqual({ pick: { type: 'series-start' }, minutes: 57 });
  });

  it('has no length preference: titles that differ only in length score exactly the same', () => {
    const short = title(1, { runtime: 22 });
    const long = title(2, { runtime: 58 });
    const film = title(3, { id: 'movie-3', kind: 'movie', runtime: 170, seasons: undefined });
    const ctx = makeCtx({ catalog: bare([short, long, film]) });
    const any = engine.buildDeck(req({ who: ALEX, mood: 'gripped', time: 'any' }), ctx);
    expect(any).toHaveLength(3);
    expect(any.find((c) => c.itemId === 'tv-1')!.score).toBe(any.find((c) => c.itemId === 'tv-2')!.score);
    // The film differs from the series in kind as well, which viewing type cares about; length adds nothing on top.
    const filmShort = title(4, { id: 'movie-4', kind: 'movie', runtime: 80, seasons: undefined });
    const films = engine.buildDeck(req({ who: ALEX, mood: 'gripped', time: 'any' }), makeCtx({ catalog: bare([film, filmShort]) }));
    expect(films[0].score).toBe(films[1].score);
  });

  it('unlike "2+ hrs", which favours using the time', () => {
    const short = title(1, { runtime: 22 });
    const long = title(2, { runtime: 58 });
    const ctx = makeCtx({ catalog: bare([short, long]) });
    const two = engine.buildDeck(req({ who: ALEX, mood: 'gripped', time: 120 }), ctx);
    expect(ids(two)).toEqual(['tv-2', 'tv-1']);
    expect(two[0].score).toBeGreaterThan(two[1].score);
    const film = title(3, { id: 'movie-3', kind: 'movie', runtime: 105, genres: ['comedy'], moods: { laugh: 0.9 }, attention: 'low', seasons: undefined });
    const sitcom = title(4, { runtime: 22, genres: ['comedy'], moods: { laugh: 0.9 }, attention: 'low', dropIn: true });
    const c2 = makeCtx({ catalog: bare([sitcom, film]) });
    const gap = (time: SuggestRequest['time']) => {
      const d = engine.buildDeck(req({ who: ALEX, time }), c2);
      return d.find((c) => c.itemId === 'movie-3')!.score - d.find((c) => c.itemId === 'tv-4')!.score;
    };
    expect(gap(120)).toBeGreaterThan(gap('any') + 0.02); // "2+ hrs" leans to the film; "any" does not
  });

  it('deals a full, sensible deck and works with every other option', () => {
    const ctx = makeCtx({ catalog: syntheticCatalog(500) });
    for (const who of WHO) for (const novelty of ['new', 'rewatch', 'either'] as const) for (const viewing of ['focused', 'background'] as const) {
      const deck = engine.buildDeck(req({ who, novelty, viewing, time: 'any' }), ctx);
      expect(deck.length).toBeGreaterThan(5);
      for (const c of deck) expect(c.minutes).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe('picks: titles on the Matches tab are left out for the people concerned', () => {
  const deckHas = (id: string, who: Who, ctx: EngineContext) => ids(engine.buildDeck(req({ who, novelty: 'new' }), ctx, { limit: 100 })).includes(id);

  it("Alex's solo pick hides the title from Alex and from Together, but not from Sam alone", () => {
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

  it("the same the other way round for Sam's solo pick", () => {
    const ctx = makeCtx({ picks: [{ itemId: OFFICE, who: SAM }] });
    expect(WHO.map((w) => engine.isPicked(OFFICE, w, ctx))).toEqual([false, true, true]);
    expect(WHO.map((w) => deckHas(OFFICE, w, ctx))).toEqual([true, false, false]);
  });

  it('a Together match hides it from everyone', () => {
    const ctx = makeCtx({ picks: [{ itemId: OFFICE, who: BOTH }] });
    for (const who of WHO) {
      expect(engine.isPicked(OFFICE, who, ctx)).toBe(true);
      expect(deckHas(OFFICE, who, ctx)).toBe(false);
      for (const novelty of ['new', 'either', 'rewatch'] as const) expect(engine.isEligible(item(OFFICE), req({ who, novelty }), ctx)).toBe(false);
    }
  });

  it('removing the pick brings it back', () => {
    const ctx = makeCtx({ picks: [{ itemId: OFFICE, who: BOTH }, { itemId: PARKS, who: ALEX }] });
    expect(deckHas(OFFICE, ALEX, ctx)).toBe(false);
    ctx.state.picks = ctx.state.picks.filter((p) => p.itemId !== OFFICE);
    for (const who of WHO) {
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
    // Watched BEFORE it was picked (a rewatch he swiped right on): still waiting on the Matches tab.
    const earlier = makeCtx({ seen: { alex: { [OFFICE]: '2026-10-01' } } });
    earlier.state.picks = [makePick(OFFICE, ALEX, picked)];
    expect(engine.isPicked(OFFICE, ALEX, earlier)).toBe(true);
    // Sam watching it does not clear Alex's pick.
    const other = makeCtx({ seen: { sam: { [OFFICE]: '2026-10-09' } } });
    other.state.picks = [makePick(OFFICE, ALEX, picked)];
    expect(engine.isPicked(OFFICE, ALEX, other)).toBe(true);
  });

  it('copes with households that have no picks list yet', () => {
    const ctx = makeCtx();
    (ctx.state as { picks?: unknown }).picks = undefined;
    expect(engine.isPicked(OFFICE, ALEX, ctx)).toBe(false);
    expect(engine.buildDeck(req(), ctx).length).toBeGreaterThan(5);
    expect(engine.followUps(BOTH, ctx).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('watched entries are objects: presence means seen', () => {
  it('any entry counts as seen, whatever its source or date', () => {
    const ctx = makeCtx();
    ctx.state.seen.alex = {
      [OFFICE]: { at: dayMs('2026-01-01'), source: 'import', plays: 40, snapshot: { title: 'The Office', year: 2005, poster: null } },
      [PARKS]: { at: 0, source: 'onboarding' },
    };
    expect(engine.hasSeen('alex', OFFICE, ctx)).toBe(true);
    expect(engine.hasSeen('alex', PARKS, ctx)).toBe(true);
    expect(engine.hasSeen('sam', OFFICE, ctx)).toBe(false);
    const fresh = ids(engine.buildDeck(req({ who: ALEX, novelty: 'new' }), ctx, { limit: 100 }));
    expect(fresh).not.toContain(OFFICE);
    expect(fresh).not.toContain(PARKS);
    expect(ids(engine.buildDeck(req({ who: ALEX, novelty: 'rewatch' }), ctx, { limit: 100 }))).toEqual(expect.arrayContaining([OFFICE, PARKS]));
  });

  it('still reads a household saved before v2 (bare timestamps)', () => {
    const ctx = makeCtx();
    (ctx.state.seen as unknown as Record<string, Record<string, number>>).alex = { [OFFICE]: dayMs('2026-09-01') };
    expect(engine.hasSeen('alex', OFFICE, ctx)).toBe(true);
    expect(ids(engine.buildDeck(req({ who: ALEX, novelty: 'new' }), ctx, { limit: 100 }))).not.toContain(OFFICE);
    expect(() => engine.followUps(ALEX, ctx)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('"either" leans new: about one card in ten is a rewatch', () => {
  const catalog = syntheticCatalog(3000);
  const seen = { alex: catalog.items.slice(100, 400).map((i) => i.id), sam: catalog.items.slice(300, 700).map((i) => i.id) };
  const plenty = makeCtx({ catalog, seen });
  const isRewatch = (c: DeckCard, who: Who, ctx: EngineContext) => watchers(who).some((p) => engine.hasSeen(p, c.itemId, ctx));
  const REQUESTS: SuggestRequest[] = [];
  for (const who of WHO) {
    for (const mood of ['laugh', 'cozy', 'gripped', 'think', 'romantic', 'hyped', 'brainoff', 'feelgood', 'cry'] as const) {
      for (const [viewing, time] of [['focused', 120], ['background', 20], ['focused', 60], ['eating', 45], ['focused', 'any']] as const) {
        REQUESTS.push(req({ who, mood, viewing, time, novelty: 'either' }));
      }
    }
  }
  const SEEDS = [0, 1, 2, 3, 4, 5];

  it('STATISTICAL: over 810 decks where plenty of good rewatches exist, the share is 10% (tolerance: 8%-12% overall, 5%-15% for every request)', () => {
    let cards = 0;
    let rewatches = 0;
    for (const r of REQUESTS) {
      let n = 0;
      let rw = 0;
      for (const seed of SEEDS) {
        const deck = engine.buildDeck(r, plenty, { seed });
        expect(deck).toHaveLength(30);
        const count = deck.filter((c) => isRewatch(c, r.who, plenty)).length;
        // Not materially more than the share, however many good rewatches there are: never more than one per ten cards.
        expect(count).toBeLessThanOrEqual(Math.ceil(30 * EITHER_REWATCH_SHARE));
        n += deck.length;
        rw += count;
      }
      cards += n;
      rewatches += rw;
      expect(rw / n, JSON.stringify(r)).toBeGreaterThanOrEqual(0.05);
      expect(rw / n, JSON.stringify(r)).toBeLessThanOrEqual(0.15);
    }
    expect(cards).toBe(REQUESTS.length * SEEDS.length * 30);
    expect(rewatches / cards).toBeGreaterThanOrEqual(0.08);
    expect(rewatches / cards).toBeLessThanOrEqual(0.12);
  }, 120_000);

  it('NO BUNCHING: never in the first two cards, never two in a row, at most one in any run of ten, and not left to the end', () => {
    const firstAt: number[] = [];
    for (const r of REQUESTS.filter((_, k) => k % 3 === 0)) {
      for (const seed of [0, 7, 19, 23, 101]) {
        const deck = engine.buildDeck(r, plenty, { seed, limit: 60 });
        const at = deck.flatMap((c, k) => (isRewatch(c, r.who, plenty) ? [k] : []));
        expect(at.length).toBeGreaterThanOrEqual(3);
        expect(at[0]).toBeGreaterThanOrEqual(2);
        firstAt.push(at[0]);
        for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1]).toBeGreaterThanOrEqual(2);
        for (let start = 0; start < deck.length; start += 10) {
          expect(at.filter((x) => x >= start && x < start + 10).length).toBeLessThanOrEqual(1);
        }
        // Spread through the deck: every full run of twenty cards has some (a few moods give fewer than 60 cards).
        for (const third of [0, 20, 40].filter((t) => t + 20 <= deck.length)) expect(at.some((x) => x >= third && x < third + 20)).toBe(true);
        expect(at[at.length - 1]).toBeLessThan(deck.length - 1);
      }
    }
    // The first rewatch arrives within the first ten cards, and the seed moves it about.
    expect(Math.max(...firstAt)).toBeLessThan(10);
    expect(new Set(firstAt).size).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('the cards around the rewatches are exactly the NEW deck, in the same order', () => {
    for (const r of REQUESTS.filter((_, k) => k % 11 === 0)) {
      const either = engine.buildDeck(r, plenty, { seed: 4 });
      const fresh = ids(engine.buildDeck({ ...r, novelty: 'new' }, plenty, { seed: 4 }));
      const newOnes = ids(either.filter((c) => !isRewatch(c, r.who, plenty)));
      expect(newOnes).toEqual(fresh.slice(0, newOnes.length));
    }
  });

  it('the rewatches chosen are the good ones for the request, not just any seen title', () => {
    // Each rewatch dealt for a mood really fits that mood, and comes from the top of what a Rewatch deck would offer.
    for (const mood of ['laugh', 'gripped', 'romantic'] as const) {
      const r = req({ who: ALEX, mood, time: 'any', novelty: 'either' });
      const top = ids(engine.buildDeck({ ...r, novelty: 'rewatch' }, plenty, { limit: 60 }));
      for (const c of engine.buildDeck(r, plenty).filter((x) => isRewatch(x, ALEX, plenty))) {
        expect(catalog.items.find((i) => i.id === c.itemId)!.moods[mood] ?? 0).toBeGreaterThanOrEqual(0.4);
        expect(top).toContain(c.itemId);
      }
    }
  });

  it('ZERO SEEN TITLES: zero rewatches, and the deck is still full', () => {
    const ctx = makeCtx({ catalog });
    ctx.state.profiles.alex.favorites = [];
    ctx.state.profiles.sam.favorites = [];
    for (const r of REQUESTS.filter((_, k) => k % 5 === 0)) {
      const deck = engine.buildDeck(r, ctx, { seed: 3 });
      expect(deck).toHaveLength(30);
      expect(deck.filter((c) => isRewatch(c, r.who, ctx))).toHaveLength(0);
      expect(ids(deck)).toEqual(ids(engine.buildDeck({ ...r, novelty: 'new' }, ctx, { seed: 3 })));
    }
  });

  it('FEW GOOD REWATCHES: fewer rewatch cards, never a poor one forced in', () => {
    // Alex has seen exactly two things: one great fit for the request and one that fits it badly.
    const good = title(1, { title: 'Good Fit', moods: { gripped: 0.95 }, rating: 8.6, votes: 5000 });
    const poor = title(2, { title: 'Poor Fit', moods: { gripped: 0.45 }, rating: 5.4, votes: 5000 });
    const others = Array.from({ length: 120 }, (_, k) => title(100 + k, { moods: { gripped: 0.6 + (k % 4) / 10 }, rating: 6.6 + (k % 15) / 10 }));
    const cat = bare([good, poor, ...others]);
    const ctx = makeCtx({ catalog: cat, seen: { alex: ['tv-1', 'tv-2'] } });
    const deck = engine.buildDeck(req({ who: ALEX, mood: 'gripped', time: 'any', novelty: 'either' }), ctx, { limit: 60 });
    expect(deck).toHaveLength(60);
    const dealt = deck.filter((c) => engine.hasSeen('alex', c.itemId, ctx)).map((c) => c.itemId);
    expect(dealt).toEqual(['tv-1']); // six slots, one good rewatch: one rewatch card
    // With only the poor one seen there is no rewatch card at all — but the title is still allowed under Rewatch.
    const onlyPoor = makeCtx({ catalog: cat, seen: { alex: ['tv-2'] } });
    const d2 = engine.buildDeck(req({ who: ALEX, mood: 'gripped', time: 'any', novelty: 'either' }), onlyPoor, { limit: 60 });
    expect(d2.filter((c) => engine.hasSeen('alex', c.itemId, onlyPoor))).toHaveLength(0);
    expect(ids(engine.buildDeck(req({ who: ALEX, mood: 'gripped', time: 'any', novelty: 'rewatch' }), onlyPoor))).toEqual(['tv-2']);
  });

  it('on the real favourites, a request none of them suits gets no rewatch; one they suit gets about one in ten', () => {
    const ctx = makeCtx({ catalog: syntheticCatalog(1500) });
    // Only the seeded favourites are seen here. Alex's are comedies: plenty for a laugh.
    const laugh = engine.buildDeck(req({ who: ALEX, mood: 'laugh', viewing: 'background', time: 20, novelty: 'either' }), ctx);
    expect(laugh.filter((c) => engine.hasSeen('alex', c.itemId, ctx))).toHaveLength(3);
    const scared = engine.buildDeck(req({ who: ALEX, mood: 'scared', novelty: 'either' }), ctx);
    expect(scared.length).toBe(30);
    expect(scared.filter((c) => engine.hasSeen('alex', c.itemId, ctx))).toHaveLength(0);
  });

  it('Together: a title EITHER of them has seen counts as the rewatch', () => {
    let alexOnly = 0;
    let samOnly = 0;
    for (const r of REQUESTS.filter((x) => x.who === BOTH)) {
      for (const c of engine.buildDeck(r, plenty, { seed: 2 })) {
        const alex = engine.hasSeen('alex', c.itemId, plenty);
        const sam = engine.hasSeen('sam', c.itemId, plenty);
        if (alex && !sam) alexOnly++;
        if (sam && !alex) samOnly++;
      }
    }
    expect(alexOnly).toBeGreaterThan(0);
    expect(samOnly).toBeGreaterThan(0);
  });

  it('with a genre craving the lean still holds and the craved genre still comes first', () => {
    const r = req({ who: BOTH, mood: 'laugh', genre: 'animation', novelty: 'either' });
    const deck = engine.buildDeck(r, plenty, { seed: 9 });
    expect(deck).toHaveLength(30);
    for (const c of deck) expect(catalog.items.find((i) => i.id === c.itemId)!.genres).toContain('animation');
    const count = deck.filter((c) => isRewatch(c, BOTH, plenty)).length;
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
  });

  it('when there is nothing new at all, the deck is rewatches rather than empty', () => {
    const a = title(1);
    const b = title(2);
    const ctx = makeCtx({ catalog: bare([a, b]), seen: { alex: ['tv-1', 'tv-2'] } });
    expect(ids(engine.buildDeck(req({ who: ALEX, mood: 'gripped', novelty: 'either' }), ctx)).sort()).toEqual(['tv-1', 'tv-2']);
  });

  it('scores still never rise down the deck, and the deck is the same every time', () => {
    for (const r of REQUESTS.filter((_, k) => k % 9 === 0)) {
      const deck = engine.buildDeck(r, plenty, { seed: 6, limit: 60 });
      for (let k = 1; k < deck.length; k++) expect(deck[k].score).toBeLessThanOrEqual(deck[k - 1].score);
      expect(engine.buildDeck(r, plenty, { seed: 6, limit: 60 })).toEqual(deck);
      expect(new Set(ids(deck)).size).toBe(deck.length);
    }
  });

  it('"new" and "rewatch" remain hard rules', () => {
    for (const r of REQUESTS.filter((_, k) => k % 7 === 0)) {
      for (const c of engine.buildDeck({ ...r, novelty: 'new' }, plenty, { seed: 1 })) expect(isRewatch(c, r.who, plenty)).toBe(false);
      for (const c of engine.buildDeck({ ...r, novelty: 'rewatch' }, plenty, { seed: 1 })) expect(isRewatch(c, r.who, plenty)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('follow-ups ("because you watched...")', () => {
  const find = (who: Who, ctx: EngineContext, id: string) => engine.followUps(who, ctx).find((f) => f.itemId === id);

  it('NEW SEASON: a show they watched before the season started, with the season out in the last 120 days', () => {
    // Alex watched Abbott Elementary in August; season 4 started on 7 October.
    const ctx = makeCtx({ seen: { alex: { [ABBOTT]: '2026-08-15' } } });
    const f = find(ALEX, ctx, ABBOTT)!;
    expect(f).toMatchObject({ type: 'new-season', season: 4, becauseItemId: ABBOTT, text: 'Season 4 is out', key: `season:${ABBOTT}:4`, date: '2026-10-07' });
    expect(f.pick).toEqual({ type: 'season', season: 4 }); // owner's change (11 Oct 2026): a new-season follow-up says to watch the new season
    expect(f.minutes).toBe(22);
    expect(f.service).toEqual({ serviceId: 'hulu', planId: 'ads', adFree: false });
    expect(Number.isFinite(f.score)).toBe(true);
    // Not for Sam, who hasn't watched it.
    expect(find(SAM, ctx, ABBOTT)).toBeUndefined();
  });

  it('not when they watched it on or after the day the season started (they are up to date)', () => {
    expect(find(ALEX, makeCtx({ seen: { alex: { [ABBOTT]: '2026-10-07' } } }), ABBOTT)).toBeUndefined();
    expect(find(ALEX, makeCtx({ seen: { alex: { [ABBOTT]: '2026-10-09' } } }), ABBOTT)).toBeUndefined();
    expect(find(ALEX, makeCtx({ seen: { alex: { [ABBOTT]: '2026-10-06' } } }), ABBOTT)).toBeDefined();
  });

  it('not when the season started more than 120 days ago, or has not started yet', () => {
    const watched = { seen: { alex: { [ABBOTT]: '2026-08-15' } } };
    expect(find(ALEX, makeCtx({ ...watched, today: '2027-02-04' }), ABBOTT)).toBeDefined(); // day 120
    expect(find(ALEX, makeCtx({ ...watched, today: '2027-02-05' }), ABBOTT)).toBeUndefined(); // day 121
    expect(find(ALEX, makeCtx({ ...watched, today: '2026-10-07' }), ABBOTT)).toBeDefined(); // the day it starts
    expect(find(ALEX, makeCtx({ ...watched, today: '2026-10-06' }), ABBOTT)).toBeUndefined(); // not out yet
    // Scrubs is Alex's favourite but its last season was in 2009.
    expect(find(ALEX, makeCtx(), SCRUBS)).toBeUndefined();
  });

  it('favourites and undated entries: only when the season started in the last 60 days', () => {
    // The Traitors is Sam's favourite (no watch date): season 3 started 5 October.
    const f = find(SAM, makeCtx(), TRAITORS)!;
    expect(f).toMatchObject({ type: 'new-season', season: 3, text: 'Season 3 is out', key: `season:${TRAITORS}:3` });
    expect(find(SAM, makeCtx({ today: '2026-12-04' }), TRAITORS)).toBeDefined(); // day 60
    expect(find(SAM, makeCtx({ today: '2026-12-05' }), TRAITORS)).toBeUndefined(); // day 61
    // An entry with no real date (ticked on the first-run grid, at unknown) follows the same 60-day rule.
    const undated = (today: string) => makeCtx({ seen: { alex: [BEAR] }, today }); // The Bear S3 started 25 September
    expect(find(ALEX, undated('2026-11-24'), BEAR)).toBeDefined(); // day 60
    expect(find(ALEX, undated('2026-11-25'), BEAR)).toBeUndefined();
    // ...whereas a dated entry from before the season gets the full 120 days.
    expect(find(ALEX, makeCtx({ seen: { alex: { [BEAR]: '2026-09-01' } }, today: '2026-12-20' }), BEAR)).toBeDefined();
  });

  it('a first season is never announced as a "new season"', () => {
    const debut = title(1, { latestSeason: { number: 1, airDate: '2026-10-01' } });
    const ctx = makeCtx({ catalog: bare([debut]), seen: { alex: { 'tv-1': '2026-09-01' } } });
    expect(engine.followUps(ALEX, ctx)).toEqual([]);
  });

  it('SPINOFF: of something they watched, which they have not seen themselves', () => {
    // Game of Thrones is Alex's favourite; House of the Dragon is its spinoff.
    const f = find(ALEX, makeCtx(), HOTD)!;
    expect(f).toMatchObject({ type: 'spinoff', becauseItemId: GOT, text: 'A spinoff of Game of Thrones', key: `spinoff:${HOTD}` });
    expect(f.season).toBeUndefined();
    expect(f.pick).toEqual({ type: 'series-start' });
    expect(f.minutes).toBe(60); // no time limit applied
    // Gone once he has seen the spinoff itself.
    expect(find(ALEX, makeCtx({ seen: { alex: [HOTD] } }), HOTD)).toBeUndefined();
    // A parent on the watched list (not a favourite) works the same way.
    const parent = title(1, { title: 'Parent Show' });
    const child = title(2, { title: 'Child Show', spinoffOf: ['tv-1', 'tv-999'] });
    const ctx = makeCtx({ catalog: bare([parent, child]), seen: { alex: ['tv-1'] } });
    expect(engine.followUps(ALEX, ctx)).toMatchObject([{ itemId: 'tv-2', type: 'spinoff', becauseItemId: 'tv-1', text: 'A spinoff of Parent Show' }]);
    expect(engine.followUps(SAM, ctx)).toEqual([]);
  });

  it('a spinoff of a watched title that is not in the catalog is named from the watched list', () => {
    const child = title(2, { title: 'Child Show', spinoffOf: ['tv-777'] });
    const ctx = makeCtx({ catalog: bare([child]) });
    ctx.state.seen.sam = { 'tv-777': { at: dayMs('2026-01-01'), source: 'import', plays: 12, snapshot: { title: 'Far Away Show', year: 2019, poster: null } } };
    expect(engine.followUps(SAM, ctx)[0].text).toBe('A spinoff of Far Away Show');
    ctx.state.seen.sam = { 'tv-777': { at: dayMs('2026-01-01'), source: 'manual' } };
    expect(engine.followUps(SAM, ctx)[0].text).toBe('A spinoff of something you watched');
  });

  it('applies plans, dealbreakers, Never, picks and "not tonight"', () => {
    expect(find(ALEX, makeCtx({ plans: { netflix: 'standard', disney: null, hulu: null, hbo: null, peacock: null, paramount: null } }), HOTD)).toBeUndefined();
    expect(find(ALEX, makeCtx({ never: { alex: [HOTD] } }), HOTD)).toBeUndefined();
    expect(find(BOTH, makeCtx({ never: { sam: [HOTD] } }), HOTD)).toBeUndefined();
    expect(find(ALEX, makeCtx({ never: { sam: [HOTD] } }), HOTD)).toBeDefined();
    expect(find(ALEX, makeCtx({ picks: [{ itemId: HOTD, who: ALEX }] }), HOTD)).toBeUndefined();
    expect(find(ALEX, makeCtx({ picks: [{ itemId: HOTD, who: SAM }] }), HOTD)).toBeDefined();
    expect(find(ALEX, makeCtx({ notTonight: { alex: { [HOTD]: TODAY } } }), HOTD)).toBeUndefined();
    // Dealbreakers: a scary spinoff is never offered to Sam or Together.
    const parent = title(1, { title: 'Parent Show' });
    const scary = title(2, { title: 'Scary Child', spinoffOf: ['tv-1'], flags: { horror: true, trueCrime: false, scary: true } });
    const ctx = makeCtx({ catalog: bare([parent, scary]), seen: { alex: ['tv-1'], sam: ['tv-1'] } });
    expect(engine.followUps(ALEX, ctx).map((f) => f.itemId)).toEqual(['tv-2']);
    expect(engine.followUps(SAM, ctx)).toEqual([]);
    expect(engine.followUps(BOTH, ctx)).toEqual([]);
  });

  it('Together: says whose it is, or that both watched it', () => {
    const ctx = makeCtx();
    // Grey's Anatomy is a favourite of both; season 21 started 1 October.
    expect(find(BOTH, ctx, GREYS)!.text).toBe('Season 21 is out — you both watched this');
    expect(find(BOTH, ctx, TRAITORS)!.text).toBe("Season 3 is out — one of Sam's shows");
    expect(find(BOTH, ctx, HOTD)!.text).toBe('A spinoff of Game of Thrones, which Alex watched');
    const both = makeCtx({ seen: { sam: [GOT] } });
    expect(find(BOTH, both, HOTD)!.text).toBe('A spinoff of Game of Thrones, which you both watched');
    // Either of them having seen the spinoff removes it for Together.
    expect(find(BOTH, makeCtx({ seen: { sam: [HOTD] } }), HOTD)).toBeUndefined();
    // Solo wording never names anyone.
    expect(find(SAM, ctx, GREYS)!.text).toBe('Season 21 is out');
  });

  it('order: fresh news first (newest first), then evergreen spinoffs; Together puts what both watched ahead', () => {
    const alex = engine.followUps(ALEX, makeCtx({ seen: { alex: { [ABBOTT]: '2026-08-15', [BEAR]: '2026-08-15' } } }));
    expect(alex.map((f) => f.itemId)).toEqual([ABBOTT, GREYS, BEAR, HOTD]); // 7 Oct, 1 Oct, 25 Sep, then the spinoff
    const together = engine.followUps(BOTH, makeCtx({ seen: { alex: { [ABBOTT]: '2026-08-15' } } }));
    expect(together[0].itemId).toBe(GREYS); // both watched it, so it leads although Abbott's season is newer
    expect(together.map((f) => f.itemId)).toEqual([GREYS, ABBOTT, TRAITORS, HOTD]);
    // Two evergreen spinoffs: the one of a show both watched comes first.
    const p1 = title(1, { title: 'Shared Parent' });
    const p2 = title(2, { title: 'His Parent' });
    const c1 = title(11, { title: 'Child of Shared', spinoffOf: ['tv-1'], rating: 6.5 });
    const c2 = title(12, { title: 'Child of His', spinoffOf: ['tv-2'], rating: 8.9 });
    const ctx = makeCtx({ catalog: bare([p1, p2, c2, c1]), seen: { alex: ['tv-1', 'tv-2'], sam: ['tv-1'] } });
    expect(engine.followUps(BOTH, ctx).map((f) => f.itemId)).toEqual(['tv-11', 'tv-12']);
    expect(engine.followUps(ALEX, ctx).map((f) => f.itemId)).toEqual(['tv-12', 'tv-11']); // solo: the better one first
  });

  it('keys are stable and unique, one card per title, same result every time', () => {
    for (const who of WHO) {
      const ctx = makeCtx({ seen: { alex: { [ABBOTT]: '2026-08-15' }, sam: [BEAR] } });
      const a = engine.followUps(who, ctx);
      expect(engine.followUps(who, ctx)).toEqual(a);
      expect(new Set(a.map((f) => f.key)).size).toBe(a.length);
      expect(new Set(a.map((f) => f.itemId)).size).toBe(a.length);
      for (const f of a) {
        expect(f.key).toMatch(f.type === 'new-season' ? /^season:tv-\d+:\d+$/ : /^spinoff:(tv|movie)-\d+$/);
        expect(f.text).not.toMatch(/undefined|NaN|null/);
        expect(f.reasons.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('is quick on a phone-sized catalog and copes with a catalog that has no follow-up data', () => {
    const big = syntheticCatalog(3000);
    const ctx = makeCtx({ catalog: big, seen: { alex: big.items.slice(100, 400).map((i) => i.id) } });
    engine.followUps(BOTH, ctx);
    const t0 = performance.now();
    const list = engine.followUps(BOTH, ctx);
    expect(performance.now() - t0).toBeLessThan(150);
    expect(list.length).toBeGreaterThan(0);
    const plain = bare([title(1), title(2)]);
    expect(engine.followUps(BOTH, makeCtx({ catalog: plain, seen: { alex: ['tv-1'] } }))).toEqual([]);
  });
});

describe('follow-ups: what to watch', () => {
  it('a new-season follow-up tells you to watch that season, not to start the series', () => {
    const ups = engine.followUps(ALEX, makeCtx());
    const seasons = ups.filter((f) => f.type === 'new-season');
    expect(seasons.length).toBeGreaterThan(0);
    for (const f of seasons) expect(f.pick).toEqual({ type: 'season', season: f.season });
    const grey = seasons.find((f) => f.itemId === 'tv-1416');
    expect(grey?.pick).toEqual({ type: 'season', season: 21 });
  });
  it('a spinoff follow-up keeps the normal pick (you have not started it)', () => {
    const spin = engine.followUps(ALEX, makeCtx()).filter((f) => f.type === 'spinoff');
    expect(spin.length).toBeGreaterThan(0);
    for (const f of spin) expect(f.pick.type).not.toBe('season');
  });
});
