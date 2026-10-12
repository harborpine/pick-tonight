/**
 * The public version's new ground: anyone can use the app, in a household of
 * one to four, starting from nothing.
 *
 *  - cold start: no favourites, no history;
 *  - a few favourites, a first import, first swipes;
 *  - mixed audiences: someone the app knows well with someone it doesn't;
 *  - blending two, three and four watchers;
 *  - reasons and follow-ups that use people's names (never their ids);
 *  - favourites that carry their own data (and may not be in the catalog);
 *  - catalogs of up to 8,000 titles, and catalogs that change under our feet.
 *
 * (The hard rules for every household size are in rules.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogItem, DeckCard, FavoriteTitle, ImportedTitle, MemberId, Profile, SuggestRequest, Who } from '../contracts';
import { FIXTURE_CATALOG, FIXTURE_TITLE_INDEX } from '../contracts/fixtures/catalog';
import { getIndex } from './catalogIndex';
import { createEngine } from './index';
import { blend } from './rank';
import { ALEX, asFavorite, audiencesOf, blankProfile, BOTH, HOUSE_OF_FOUR, itemsById, KIT, makeCtx, PLANS, req, SAM, sampleProfile, syntheticCatalog, withFavorites } from './testkit';

const engine = createEngine();
const byId = itemsById(FIXTURE_CATALOG);
const item = (id: string) => byId.get(id)!;
const ids = (deck: DeckCard[]) => deck.map((c) => c.itemId);
const rank = (deck: DeckCard[], id: string) => {
  const k = ids(deck).indexOf(id);
  return k < 0 ? Number.POSITIVE_INFINITY : k;
};
const scoreOf = (deck: DeckCard[], id: string) => deck.find((c) => c.itemId === id)!.score;
const ALL_FOUR: Who = HOUSE_OF_FOUR.slice().sort();

/** A blank title to build made-up catalogs from. */
function title(id: number, over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: `tv-${id}`, tmdbId: id, kind: 'tv', title: `Title ${id}`, year: 2015, genres: ['drama'], keywords: [], related: [], poster: null, backdrop: null,
    overview: '', lang: 'en', runtime: 45, seasons: 3, rating: 7.5, votes: 1000, popularity: 50, providers: [8], attention: 'medium', moods: { gripped: 0.8 },
    dropIn: false, standout: [], flags: { horror: false, trueCrime: false, scary: false }, ...over,
  };
}
/** A made-up catalog with the favourites each person has picked (anyone not listed has none). */
const madeUp = (items: CatalogItem[], favs: Partial<Record<MemberId, CatalogItem[]>> = {}): Catalog => withFavorites({ schema: 1, builtAt: '2026-10-10T00:00:00.000Z', items }, favs);

// ---------------------------------------------------------------------------
describe('cold start: a brand-new person with no favourites and no history', () => {
  const catalog = syntheticCatalog(1500);
  const info = new Map(catalog.items.map((i) => [i.id, i]));
  const solo = makeCtx({ catalog, members: ['kit'] });
  const MOODS_TRIED = ['laugh', 'cozy', 'gripped', 'feelgood', 'think', 'romantic', 'hyped', 'cry', 'brainoff'] as const;

  it('gets a full deck for every mood, and every card respects the mood', () => {
    for (const mood of MOODS_TRIED) {
      const deck = engine.buildDeck(req({ who: KIT, mood, time: 'any' }), solo, { seed: 3 });
      expect(deck, mood).toHaveLength(30);
      for (const c of deck) expect(info.get(c.itemId)!.moods[mood] ?? 0, `${mood}: ${info.get(c.itemId)!.title}`).toBeGreaterThanOrEqual(0.4);
      // The very top fits the mood well, not just adequately.
      for (const c of deck.slice(0, 5)) expect(info.get(c.itemId)!.moods[mood] ?? 0, `${mood} top: ${info.get(c.itemId)!.title}`).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('respects the viewing type and the time available exactly as for anyone else', () => {
    const bg = engine.buildDeck(req({ who: KIT, mood: 'laugh', viewing: 'background', time: 20 }), solo, { seed: 2 });
    expect(bg).toHaveLength(30);
    for (const c of bg) {
      expect(info.get(c.itemId)!.attention).toBe('low');
      expect(c.minutes).toBeLessThanOrEqual(25);
    }
    // With a whole evening, films and long episodes come forward; with twenty minutes there are none.
    const evening = engine.buildDeck(req({ who: KIT, mood: 'laugh', time: 120 }), solo, { seed: 2 });
    expect(evening.filter((c) => info.get(c.itemId)!.kind === 'movie').length).toBeGreaterThan(5);
    expect(bg.filter((c) => info.get(c.itemId)!.kind === 'movie')).toHaveLength(0);
  });

  it('is quality-led: the deck is drawn from the best-rated, best-known titles that fit, not from anywhere', () => {
    for (const mood of ['gripped', 'laugh', 'feelgood'] as const) {
      const r = req({ who: KIT, mood, time: 'any', novelty: 'new' });
      const deck = engine.buildDeck(r, solo);
      const fits = catalog.items.filter((i) => (i.moods[mood] ?? 0) >= 0.4 && engine.isEligible(i, r, solo));
      const mean = (xs: CatalogItem[], f: (i: CatalogItem) => number) => xs.reduce((s, i) => s + f(i), 0) / xs.length;
      const dealt = deck.map((c) => info.get(c.itemId)!);
      expect(fits.length).toBeGreaterThan(200);
      // Clearly better rated, and by far more people, than the average title that would have fitted.
      expect(mean(dealt, (i) => i.rating)).toBeGreaterThan(mean(fits, (i) => i.rating) + 0.8);
      expect(mean(dealt, (i) => i.votes)).toBeGreaterThan(mean(fits, (i) => i.votes) * 1.2);
      // Nothing poorly rated, and nothing that only a handful of people have rated.
      for (const i of dealt) {
        expect(i.rating, i.title).toBeGreaterThanOrEqual(7);
        expect(i.votes, i.title).toBeGreaterThanOrEqual(200);
      }
    }
  });

  it('is not just a popularity chart: a better-rated title beats a more popular, worse-rated one', () => {
    const hit = title(1, { title: 'Everyone Has Seen It', rating: 6.4, votes: 40000, popularity: 9000 });
    const good = title(2, { title: 'Properly Good', rating: 8.5, votes: 3000, popularity: 60 });
    const unproven = title(3, { title: 'Nine Point Eight From Three People', rating: 9.8, votes: 3, popularity: 5 });
    const filler = Array.from({ length: 12 }, (_, k) => title(100 + k, { rating: 7.0 + (k % 5) / 10, votes: 800 + 100 * k, popularity: 20 + k }));
    const ctx = makeCtx({ catalog: madeUp([hit, unproven, ...filler, good]), members: ['kit'] });
    const deck = engine.buildDeck(req({ who: KIT, mood: 'gripped' }), ctx, { limit: 100 });
    expect(rank(deck, 'tv-2')).toBe(0);
    expect(rank(deck, 'tv-2')).toBeLessThan(rank(deck, 'tv-1'));
    expect(rank(deck, 'tv-2')).toBeLessThan(rank(deck, 'tv-3'));
    // Being well known still counts between equals.
    const known = title(4, { rating: 8.0, votes: 20000, popularity: 400 });
    const obscure = title(5, { rating: 8.0, votes: 150, popularity: 3 });
    const d2 = engine.buildDeck(req({ who: KIT, mood: 'gripped' }), makeCtx({ catalog: madeUp([obscure, known, ...filler]), members: ['kit'] }), { limit: 100 });
    expect(rank(d2, 'tv-4')).toBeLessThan(rank(d2, 'tv-5'));
  });

  it('is varied: not dominated by one genre, one format or one service', () => {
    const firstGenres = (deck: DeckCard[]) => deck.map((c) => info.get(c.itemId)!.genres[0]);
    const share = (xs: string[]) => {
      const m = new Map<string, number>();
      for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
      return Math.max(...m.values()) / xs.length;
    };
    for (const mood of ['gripped', 'feelgood', 'cozy'] as const) {
      const deck = engine.buildDeck(req({ who: KIT, mood, time: 'any' }), solo, { seed: 5 });
      const genres = firstGenres(deck);
      expect(new Set(genres).size, mood).toBeGreaterThanOrEqual(4);
      expect(share(genres), `${mood}: one genre's share`).toBeLessThanOrEqual(0.5);
      // The first screenful already shows a spread.
      expect(new Set(genres.slice(0, 8)).size, `${mood}: first eight`).toBeGreaterThanOrEqual(3);
      expect(new Set(deck.map((c) => c.service.serviceId)).size, mood).toBeGreaterThanOrEqual(3);
      expect(share(deck.map((c) => c.service.serviceId)), `${mood}: one service's share`).toBeLessThanOrEqual(0.65);
    }
    // Films and series both, when there is time for either.
    const evening = engine.buildDeck(req({ who: KIT, mood: 'feelgood', time: 120 }), solo, { seed: 5 });
    const films = evening.filter((c) => info.get(c.itemId)!.kind === 'movie').length;
    expect(films).toBeGreaterThanOrEqual(5);
    expect(films).toBeLessThanOrEqual(25);
  });

  it('the spread is wider than taste alone would give: the same request, the same titles, less bunching than for someone we know', () => {
    // 14 near-identical well-rated crime dramas and 10 slightly lower-rated titles of other kinds.
    const clones = Array.from({ length: 14 }, (_, k) => title(k + 1, { genres: ['crime', 'drama'], keywords: ['detective'], rating: 8.3, votes: 4000 }));
    const others = (['comedy', 'documentary', 'fantasy', 'romance', 'scifi', 'western', 'music', 'history', 'war', 'adventure'] as const).map((g, k) =>
      title(50 + k, { genres: [g], keywords: [`k${k}`], rating: 8.1, votes: 4000, providers: [k % 2 ? 337 : 15] }),
    );
    const cat = madeUp([...clones, ...others]);
    const ctx = makeCtx({ catalog: cat, members: ['kit'] });
    const deck = engine.buildDeck(req({ who: KIT, mood: 'gripped' }), ctx, { limit: 12 });
    const crime = (d: DeckCard[]) => d.filter((c) => c.itemId.match(/^tv-([1-9]|1[0-4])$/)).length;
    expect(ids(deck)[0]).toMatch(/^tv-([1-9]|1[0-4])$/); // the best title still leads
    expect(crime(deck.slice(0, 12))).toBeLessThanOrEqual(6);
    expect(new Set(deck.map((c) => c.service.serviceId)).size).toBe(3);
  });

  it('decks are not identical for every new person: the seed changes what is dealt and what comes first', () => {
    const r = req({ who: KIT, mood: 'gripped', time: 'any' });
    const decks = [1, 2, 3, 4, 5, 6].map((seed) => ids(engine.buildDeck(r, solo, { seed })));
    // Same seed, same deck.
    expect(ids(engine.buildDeck(r, solo, { seed: 3 }))).toEqual(decks[2]);
    for (let a = 0; a < decks.length; a++) for (let b = a + 1; b < decks.length; b++) {
      expect(decks[a]).not.toEqual(decks[b]);
      const shared = decks[a].filter((id) => decks[b].includes(id)).length;
      expect(shared, `seeds ${a + 1} and ${b + 1} share ${shared} of 30`).toBeLessThanOrEqual(22); // different cards, not just a different order
      expect(shared).toBeGreaterThanOrEqual(5); // ...but the strongest titles keep turning up
    }
    expect(new Set(decks.map((d) => d[0])).size).toBeGreaterThanOrEqual(3);
    expect(new Set(decks.flat()).size).toBeGreaterThanOrEqual(60);
  });

  it('the seed shuffles a blank person\'s deck more than it shuffles the deck of someone we know', () => {
    const overlap = (who: Who, ctx = solo) => {
      const r = req({ who, mood: 'gripped', time: 'any', novelty: 'new' });
      let shared = 0;
      let n = 0;
      for (const [a, b] of [[1, 2], [3, 4], [5, 6], [7, 8]]) {
        const x = ids(engine.buildDeck(r, ctx, { seed: a }));
        const y = ids(engine.buildDeck(r, ctx, { seed: b }));
        shared += x.filter((id) => y.includes(id)).length;
        n += x.length;
      }
      return shared / n;
    };
    const known = makeCtx({ catalog });
    expect(overlap(KIT)).toBeLessThan(overlap(ALEX, known) - 0.1);
  });

  it('with no seed it is still deterministic', () => {
    const r = req({ who: KIT, mood: 'cozy' });
    expect(engine.buildDeck(r, solo)).toEqual(createEngine().buildDeck(r, makeCtx({ catalog, members: ['kit'] })));
  });

  it('acquired tastes (anime, kids\' shows) are held back for a blank profile too — and released by a favourite, a swipe run, an import or a correction', () => {
    const plain = title(30, { keywords: ['detective'], rating: 8.0 });
    const anime = title(31, { title: 'An Anime', keywords: ['detective', 'anime'], rating: 8.6 });
    const kids = title(32, { title: 'A Kids Show', keywords: ['detective'], genres: ['drama', 'kids'], rating: 8.6 });
    const filler = Array.from({ length: 6 }, (_, k) => title(100 + k, { keywords: [`f${k}`], rating: 7.2 }));
    const cat = madeUp([anime, kids, plain, ...filler]);
    const r = req({ who: KIT, mood: 'gripped' });
    const blank = makeCtx({ catalog: cat, members: ['kit'] });
    const deck = engine.buildDeck(r, blank, { limit: 100 });
    // Despite their higher ratings, both sit below the plain drama — and below the ordinary filler.
    expect(ids(deck)[0]).toBe('tv-30');
    expect(rank(deck, 'tv-31')).toBeGreaterThan(rank(deck, 'tv-100'));
    expect(rank(deck, 'tv-32')).toBeGreaterThan(rank(deck, 'tv-100'));
    // They are held back, not banned.
    expect(ids(deck)).toContain('tv-31');

    const withProfile = (p: Profile) => {
      const ctx = makeCtx({ catalog: cat, members: ['kit'] });
      ctx.state.profiles.kit = p;
      return engine.buildDeck(r, ctx, { limit: 100 });
    };
    // A favourite that is anime (not even in the catalog).
    const animeFav: FavoriteTitle = { id: 'tv-777001', kind: 'tv', title: 'Some Anime', year: 2019, genres: ['animation'], keywords: ['based on manga', 'ninja'], poster: null };
    expect(rank(withProfile({ ...blankProfile('kit'), favorites: [animeFav] }), 'tv-31')).toBe(0);
    // A correction on the taste page.
    expect(rank(withProfile(engine.correctTaste(blankProfile('kit'), 'keyword:anime', 'more')), 'tv-31')).toBe(0);
    expect(rank(withProfile(engine.correctTaste(blankProfile('kit'), 'genre:kids', 'more')), 'tv-32')).toBe(0);
    // A run of yeses.
    let swiped = blankProfile('kit');
    for (let k = 0; k < 4; k++) swiped = engine.learnFromSwipe(swiped, anime, 'yes', cat);
    expect(rank(withProfile(swiped), 'tv-31')).toBe(0);
    // An imported history with anime in it.
    const entry = (id: string, name: string): ImportedTitle => ({ entry: { id, kind: 'tv', title: name, year: 2015, genres: ['animation'], keywords: ['anime', 'detective'], popularity: 10 }, plays: 20 });
    const imported = engine.learnFromImport(blankProfile('kit'), [entry('tv-888001', 'A'), entry('tv-888002', 'B'), entry('tv-888003', 'C')], cat);
    expect(rank(withProfile(imported), 'tv-31')).toBeLessThan(rank(deck, 'tv-31'));
    expect(rank(withProfile(imported), 'tv-31')).toBeLessThanOrEqual(1);
  });

  it('all-ages cartoons rated TV-PG count as kids\' shows for this purpose; grown-up animated sitcoms do not', () => {
    const cartoon = { genres: ['animation', 'family', 'comedy'] as CatalogItem['genres'], certification: 'TV-PG', runtime: 22, dropIn: true, attention: 'low' as const, moods: { laugh: 0.9 }, rating: 8.5 };
    const allAges = title(40, { ...cartoon, title: 'All-Ages Cartoon', keywords: ['friendship', 'magic'] });
    const grownUp = title(41, { ...cartoon, title: 'Grown-Up Cartoon', keywords: ['adult animation', 'satire'] });
    const sitcom = title(42, { genres: ['comedy'], keywords: ['sitcom'], runtime: 22, dropIn: true, attention: 'low', moods: { laugh: 0.9 }, rating: 8.0 });
    const filler = Array.from({ length: 6 }, (_, k) => title(100 + k, { genres: ['comedy'], keywords: [`f${k}`], runtime: 22, dropIn: true, attention: 'low', moods: { laugh: 0.9 }, rating: 7.2 }));
    const deck = engine.buildDeck(req({ who: KIT, mood: 'laugh' }), makeCtx({ catalog: madeUp([allAges, grownUp, sitcom, ...filler]), members: ['kit'] }), { limit: 100 });
    expect(rank(deck, 'tv-41')).toBe(0); // the best rated, and nothing holds it back
    expect(rank(deck, 'tv-40')).toBeGreaterThan(rank(deck, 'tv-42'));
    expect(rank(deck, 'tv-40')).toBeGreaterThan(rank(deck, 'tv-100'));
  });

  it('a title not originally in English is marked down a little for someone we know nothing about — not hidden, and not for someone we know', () => {
    const twin = { genres: ['crime', 'drama'] as CatalogItem['genres'], keywords: ['heist'], rating: 8.3, votes: 4000 };
    const english = title(51, { ...twin, title: 'English Twin' });
    const foreign = title(50, { ...twin, title: 'Foreign Twin', lang: 'es' });
    const lesser = title(52, { ...twin, title: 'Lesser English', keywords: ['bank'], rating: 6.6 });
    const famous = title(53, { ...twin, title: 'World Famous Foreign', keywords: ['mask'], lang: 'ko', rating: 8.6, votes: 30000, popularity: 900 });
    const westerns = Array.from({ length: 8 }, (_, k) => title(200 + k, { title: `Western Fav ${k}`, genres: ['western'], keywords: ['gunslinger', `w${k}`] }));
    const cat = madeUp([foreign, english, lesser, famous], { alex: westerns });
    const blank = engine.buildDeck(req({ who: KIT, mood: 'gripped' }), makeCtx({ catalog: cat, members: ['kit', 'alex'] }), { limit: 100 });
    // Identical but for the language: the English one first (tv-50 would win a tie on id).
    expect(rank(blank, 'tv-51')).toBeLessThan(rank(blank, 'tv-50'));
    // Only a little (worth about one point of rating): it still beats a clearly worse English title, and a famous one still leads.
    expect(rank(blank, 'tv-50')).toBeLessThan(rank(blank, 'tv-52'));
    expect(rank(blank, 'tv-53')).toBe(0);
    expect(ids(blank)).toHaveLength(4);
    // For someone with a long favourites list nothing is assumed: the twins score the same.
    const known = engine.buildDeck(req({ who: ALEX, mood: 'gripped' }), makeCtx({ catalog: cat, members: ['kit', 'alex'] }), { limit: 100 });
    expect(scoreOf(known, 'tv-50')).toBe(scoreOf(known, 'tv-51'));
    expect(rank(known, 'tv-50')).toBeLessThan(rank(known, 'tv-51'));
    // "Nothing subtitled" is a different thing altogether: a hard rule.
    const strict = makeCtx({ catalog: cat, members: ['kit', 'alex'], dealbreakers: { kit: { subtitled: true } } });
    expect(ids(engine.buildDeck(req({ who: KIT, mood: 'gripped' }), strict, { limit: 100 })).sort()).toEqual(['tv-51', 'tv-52']);
  });

  it('the New feed and the follow-ups work for someone with nothing: quality-led, and no follow-ups to offer', () => {
    const ctx = makeCtx({ members: ['kit'] });
    const feed = engine.rankNewArrivals({ schema: 1, builtAt: '', entries: FIXTURE_CATALOG.items.map((i) => ({ itemId: i.id, type: 'title' as const, providers: i.providers, date: '2026-10-09' })) }, KIT, ctx);
    expect(feed.length).toBeGreaterThan(40);
    for (let k = 1; k < feed.length; k++) expect(feed[k].score).toBeLessThanOrEqual(feed[k - 1].score);
    const top = feed.slice(0, 8).map((c) => item(c.itemId));
    for (const i of top) expect(i.rating, i.title).toBeGreaterThanOrEqual(8);
    expect(top.map((i) => i.id)).not.toContain('tv-82728'); // Bluey: a kids' show, however well rated
    expect(engine.followUps(KIT, ctx)).toEqual([]);
    for (const c of feed) for (const reason of c.reasons) expect(reason).not.toMatch(/favourite|love/i);
  });

  it('reasons for a blank person claim nothing about their taste', () => {
    for (const mood of MOODS_TRIED) {
      for (const c of engine.buildDeck(req({ who: KIT, mood }), solo)) {
        expect(c.reasons.length).toBeLessThanOrEqual(3);
        for (const reason of c.reasons) expect(reason, reason).not.toMatch(/favourite|you love|Because|You watch|saying yes|Kit|kit/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('getting to know someone: a few favourites, first swipes, a first import', () => {
  const catalog = syntheticCatalog(1500);
  const info = new Map(catalog.items.map((i) => [i.id, i]));
  const withKit = (p: Profile) => {
    const ctx = makeCtx({ catalog, members: ['kit'] });
    ctx.state.profiles.kit = p;
    return ctx;
  };
  const genreCount = (deck: DeckCard[], genre: string) => deck.filter((c) => (info.get(c.itemId)!.genres as string[]).includes(genre)).length;

  it('three favourites clearly steer the deck, and are given as the reason', () => {
    // Three reality-competition favourites.
    const favs = ['tv-14658', 'tv-205715', 'tv-87012'].map((id) => asFavorite(item(id)));
    const r = req({ who: KIT, mood: 'gripped', time: 'any', novelty: 'new' });
    const blank = engine.buildDeck(r, withKit(blankProfile('kit')));
    const steered = engine.buildDeck(r, withKit({ ...blankProfile('kit'), favorites: favs }));
    expect(genreCount(blank, 'reality')).toBeLessThanOrEqual(6);
    expect(genreCount(steered, 'reality')).toBeGreaterThanOrEqual(genreCount(blank, 'reality') + 8);
    expect(genreCount(steered.slice(0, 10), 'reality')).toBeGreaterThanOrEqual(6);
    const reasons = steered.slice(0, 10).flatMap((c) => c.reasons).join(' | ');
    expect(reasons).toMatch(/Survivor|The Traitors/);
    // It is still a mix, and still fits the mood.
    expect(genreCount(steered, 'reality')).toBeLessThan(30);
    for (const c of steered) expect(info.get(c.itemId)!.moods.gripped ?? 0).toBeGreaterThanOrEqual(0.4);
  });

  it('each added favourite moves things: one nudges, two pull, three steer', () => {
    const favs = ['tv-14658', 'tv-205715', 'tv-87012'].map((id) => asFavorite(item(id)));
    const r = req({ who: KIT, mood: 'gripped', time: 'any', novelty: 'new' });
    const counts = [0, 1, 2, 3].map((n) => genreCount(engine.buildDeck(r, withKit({ ...blankProfile('kit'), favorites: favs.slice(0, n) })), 'reality'));
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThanOrEqual(counts[1]);
    expect(counts[3]).toBeGreaterThanOrEqual(counts[2]);
    expect(counts[3]).toBeGreaterThan(counts[1]);
  });

  it('a short list is taken at its word: the "one favourite does not speak for the person" mark-down fades in with the length of the list', () => {
    // The same lone cartoon favourite, in a list of three and in a list of ten (the rest are dramas).
    const dramas = Array.from({ length: 9 }, (_, k) => title(k + 1, { title: `Drama Fav ${k + 1}`, genres: ['drama'], keywords: ['lawyer', 'scandal', `d${k}`], moods: { cozy: 0.8 } }));
    const cartoon = { genres: ['animation', 'comedy'] as CatalogItem['genres'], runtime: 22, dropIn: true, attention: 'low' as const, moods: { cozy: 0.8 } };
    const cartoonFav = title(20, { ...cartoon, title: 'Cartoon Fav', keywords: ['adult animation', 'cutaway gags', 'talking dog'] });
    const clone = title(30, { ...cartoon, keywords: ['adult animation', 'cutaway gags', 'talking dog'] });
    const dramaLike = title(31, { genres: ['drama'], keywords: ['lawyer', 'scandal'], moods: { cozy: 0.8 } });
    const otherCartoon = title(32, { ...cartoon, keywords: ['space pirates', 'robot butler', 'moon base'] });
    const filler = Array.from({ length: 10 }, (_, k) => title(100 + k, { genres: ['history'], keywords: [`f${k}`], moods: { cozy: 0.8 }, rating: 7.2 }));
    const items = [...dramas, cartoonFav, clone, otherCartoon, dramaLike, ...filler];
    const deckFor = (favs: CatalogItem[]) => engine.buildDeck(req({ who: KIT, mood: 'cozy', novelty: 'new' }), makeCtx({ catalog: madeUp(items, { kit: favs }), members: ['kit'] }), { limit: 100 });
    const three = deckFor([cartoonFav, dramas[0], dramas[1]]);
    const five = deckFor([cartoonFav, ...dramas.slice(0, 4)]);
    const ten = deckFor([cartoonFav, ...dramas]);
    // Three favourites: the cartoon is a third of what they told us. Its clone is right at the top
    // (only the drama that resembles BOTH their other favourites can be ahead of it).
    expect(rank(three, 'tv-30')).toBeLessThanOrEqual(1);
    expect(rank(three, 'tv-30')).toBeLessThan(rank(three, 'tv-100'));
    // Ten favourites: it is one in ten. What the other nine point to leads, as before.
    expect(rank(ten, 'tv-31')).toBe(0);
    expect(rank(ten, 'tv-31')).toBeLessThan(rank(ten, 'tv-30'));
    // And in between it fades: the clone scores highest in the short list, lowest in the long one.
    expect(scoreOf(three, 'tv-30')).toBeGreaterThan(scoreOf(five, 'tv-30') + 0.01);
    expect(scoreOf(five, 'tv-30')).toBeGreaterThan(scoreOf(ten, 'tv-30') + 0.01);
    expect(scoreOf(three, 'tv-30')).toBeGreaterThan(scoreOf(ten, 'tv-30') + 0.08);
    // In every list the lone favourite counts for something.
    for (const d of [three, five, ten]) expect(rank(d, 'tv-30')).toBeLessThan(rank(d, 'tv-32'));
  });

  it('a single favourite is enough to be named as the reason for its nearest neighbours', () => {
    const ctx = makeCtx({ members: ['kit'], favorites: { kit: [asFavorite(item('tv-2316'))] } }); // The Office
    const deck = engine.buildDeck(req({ who: KIT, mood: 'laugh', novelty: 'new' }), ctx, { limit: 100 });
    expect(rank(deck, 'tv-8592')).toBeLessThan(3); // Parks and Recreation
    expect(deck.find((c) => c.itemId === 'tv-8592')!.reasons).toContain('Because you love The Office');
    expect(ids(deck)).not.toContain('tv-2316'); // their favourite counts as seen
    expect(engine.buildDeck(req({ who: KIT, mood: 'laugh', novelty: 'rewatch' }), ctx)[0]).toMatchObject({ itemId: 'tv-2316', reasons: expect.arrayContaining(['One of your favourites']) });
  });

  it('a first run of swipes moves a blank person\'s deck', () => {
    const r = req({ who: KIT, mood: 'think', time: 'any', novelty: 'new' });
    const before = engine.buildDeck(r, withKit(blankProfile('kit')));
    let p = blankProfile('kit');
    for (const id of ['tv-68595', 'tv-64439', 'tv-68595', 'tv-64439', 'tv-68595', 'tv-64439']) p = engine.learnFromSwipe(p, item(id), 'yes', catalog); // documentaries
    const after = engine.buildDeck(r, withKit(p));
    expect(genreCount(after, 'documentary')).toBeGreaterThan(genreCount(before, 'documentary') + 3);
    expect(after.slice(0, 5).flatMap((c) => c.reasons).join(' | ')).toMatch(/saying yes to documentaries/);
    // A run of "never" on something sinks its like.
    let q = blankProfile('kit');
    for (let k = 0; k < 4; k++) q = engine.learnFromSwipe(q, item('tv-76331'), 'never', catalog); // Succession: drama
    const soured = engine.buildDeck(req({ who: KIT, mood: 'gripped', time: 'any', novelty: 'new' }), withKit(q));
    const fresh = engine.buildDeck(req({ who: KIT, mood: 'gripped', time: 'any', novelty: 'new' }), withKit(blankProfile('kit')));
    expect(genreCount(soured, 'drama')).toBeLessThan(genreCount(fresh, 'drama'));
  });

  it('an import is the fast way in: a blank person with a watch history gets a deck shaped by it', () => {
    const shows = ['Bridgerton', 'Normal People', 'Gilmore Girls', "Grey's Anatomy"].flatMap((t) => Array.from({ length: 6 }, (_, k) => `"${t}: Season 1: Episode ${k + 1}",1/${k + 1}/26`));
    const films = ['The Notebook', 'Crazy Rich Asians'].map((t) => `"${t}",2/1/26`);
    const parsed = engine.parseWatchHistory(['Title,Date', ...shows, ...films].join('\n'), 'NetflixViewingHistory.csv');
    const matched = engine.matchWatchHistory(parsed, FIXTURE_TITLE_INDEX).matched;
    expect(matched.length).toBe(6);
    const p = engine.learnFromImport(blankProfile('kit'), matched, catalog);
    const r = req({ who: KIT, mood: 'cozy', time: 'any', novelty: 'new' });
    const before = engine.buildDeck(r, withKit(blankProfile('kit')));
    const after = engine.buildDeck(r, withKit(p));
    const romanceOrDrama = (d: DeckCard[]) => d.filter((c) => info.get(c.itemId)!.genres.some((g) => g === 'romance' || g === 'drama')).length;
    expect(genreCount(after, 'romance')).toBeGreaterThan(genreCount(before, 'romance'));
    expect(romanceOrDrama(after)).toBeGreaterThanOrEqual(romanceOrDrama(before) + 4);
    const feelgood = req({ who: KIT, mood: 'feelgood', time: 'any', novelty: 'new' });
    expect(genreCount(engine.buildDeck(feelgood, withKit(p)), 'romance')).toBeGreaterThanOrEqual(genreCount(engine.buildDeck(feelgood, withKit(blankProfile('kit'))), 'romance') + 2);
    const lines = engine.describeTaste(p, catalog);
    expect(lines.find((l) => l.key === 'genre:romance')?.text).toMatch(/^You (often )?watch (a lot of )?romance$/);
  });
});

// ---------------------------------------------------------------------------
describe('mixed audiences: someone the app knows well with someone it does not', () => {
  // alexFavs: westerns. A newcomer with nothing. A third person who loves dance shows.
  const westerns = [1, 2, 3].map((k) => title(k, { title: `Western Fav ${k}`, genres: ['western'], keywords: ['gunslinger', 'frontier', 'outlaw'] }));
  const dances = [4, 5, 6].map((k) => title(k, { title: `Dance Fav ${k}`, genres: ['music'], keywords: ['ballet', 'dance', 'audition'] }));
  const western = title(10, { genres: ['western'], keywords: ['gunslinger', 'frontier', 'outlaw'] });
  const dance = title(11, { genres: ['music'], keywords: ['ballet', 'dance', 'audition'] });
  const bothKinds = title(12, { genres: ['western', 'music'], keywords: ['gunslinger', 'frontier', 'dance', 'ballet'] });
  const neutral = title(13, { genres: ['history'], keywords: ['archive'] });
  const better = title(14, { genres: ['history'], keywords: ['museum'], rating: 7.9 }); // a little better rated than everything else
  const catalog = madeUp([western, dance, bothKinds, neutral, better], { alex: westerns, sam: dances });
  const ctx = makeCtx({ catalog, members: ['alex', 'sam', 'kit'] });
  const r = req({ mood: 'gripped' });
  const deck = (who: Who, c = ctx) => engine.buildDeck({ ...r, who }, c, { limit: 100 });

  it('a blank person does not veto: with them along, what the other loves still comes first', () => {
    expect(ids(deck(ALEX))[0]).toBe('tv-10');
    expect(ids(deck(['alex', 'kit']))[0]).toBe('tv-10');
    // Alone, the newcomer just gets the best-rated title.
    expect(ids(deck(KIT))[0]).toBe('tv-14');
    // "No opinion" is neutral: the western scores about what it does for alex alone, far above a flat least-misery score.
    expect(scoreOf(deck(['alex', 'kit']), 'tv-10')).toBeGreaterThan(scoreOf(deck(ALEX), 'tv-10') - 0.04);
    // (A flat least-misery blend would put it only about 0.05 above what it scores for the newcomer alone.)
    expect(scoreOf(deck(['alex', 'kit']), 'tv-10')).toBeGreaterThan(scoreOf(deck(KIT), 'tv-10') + 0.15);
    // And the order is alex's order, not the newcomer's.
    expect(ids(deck(['alex', 'kit'])).slice(0, 2)).toEqual(ids(deck(ALEX)).slice(0, 2));
  });

  it('contrast: two people we DO know still need a title that suits both', () => {
    const d = deck(BOTH);
    expect(ids(d)[0]).toBe('tv-12');
    expect(rank(d, 'tv-12')).toBeLessThan(rank(d, 'tv-10'));
    expect(rank(d, 'tv-12')).toBeLessThan(rank(d, 'tv-11'));
    // Adding the newcomer to that pair changes nothing about what comes first.
    const three = deck(['alex', 'kit', 'sam']);
    expect(ids(three)[0]).toBe('tv-12');
    expect(rank(three, 'tv-12')).toBeLessThan(rank(three, 'tv-10'));
  });

  it('the newcomer goes along with the others, but is not counted as an extra vote for either side', () => {
    // With alex and sam both watching, kit's borrowed opinion is the average of theirs:
    // it must not tip the balance towards whichever of them is keener on a title.
    const three = deck(['alex', 'kit', 'sam']);
    expect(Math.abs(scoreOf(three, 'tv-10') - scoreOf(three, 'tv-11'))).toBeLessThan(0.02);
    expect(scoreOf(three, 'tv-12')).toBeGreaterThan(scoreOf(three, 'tv-10') + 0.05);
  });

  it('the newcomer\'s own hard signals still count in full: never-show-me, Never, a "less" correction', () => {
    const banned = makeCtx({ catalog, members: ['alex', 'sam', 'kit'], dealbreakers: { kit: { genres: ['western'] } } });
    expect(ids(deck(['alex', 'kit'], banned))).not.toContain('tv-10');
    expect(ids(deck(ALEX, banned))[0]).toBe('tv-10');
    const never = makeCtx({ catalog, members: ['alex', 'sam', 'kit'], never: { kit: ['tv-10'] } });
    expect(ids(deck(['alex', 'kit'], never))).not.toContain('tv-10');
    const less = makeCtx({ catalog, members: ['alex', 'sam', 'kit'] });
    less.state.profiles.kit = engine.correctTaste(less.state.profiles.kit, 'genre:western', 'less');
    const d = deck(['alex', 'kit'], less);
    expect(rank(d, 'tv-10')).toBeGreaterThan(rank(d, 'tv-13')); // sunk below even the neutral title
    expect(ids(deck(ALEX, less))[0]).toBe('tv-10');
  });

  it('once the newcomer shows a dislike by swiping, that is an opinion and it is kept', () => {
    const soured = makeCtx({ catalog, members: ['alex', 'sam', 'kit'] });
    let p = soured.state.profiles.kit;
    for (let k = 0; k < 5; k++) p = engine.learnFromSwipe(p, western, 'never', catalog);
    soured.state.profiles.kit = p;
    expect(scoreOf(deck(['alex', 'kit'], soured), 'tv-10')).toBeLessThan(scoreOf(deck(['alex', 'kit']), 'tv-10') - 0.1);
  });

  it('someone with ONE favourite keeps their own view where they have one, and mostly goes along otherwise', () => {
    // (Without the title that is both a western and a dance show, so nothing else in the deck resembles either.)
    const small = madeUp([western, dance, neutral, better], { alex: westerns });
    const one = makeCtx({ catalog: small, members: ['alex', 'sam', 'kit'], favorites: { kit: [asFavorite(dances[0])] } });
    const d = deck(['alex', 'kit'], one);
    const blank = deck(['alex', 'kit'], makeCtx({ catalog: small, members: ['alex', 'sam', 'kit'] }));
    // The dance title: with a blank kit it is nothing to either of them and sits below the better-rated history title;
    // kit's own (one-favourite) liking lifts it over that, though alex has no view of it.
    expect(rank(blank, 'tv-11')).toBeGreaterThan(rank(blank, 'tv-14'));
    expect(rank(d, 'tv-11')).toBeLessThan(rank(d, 'tv-14'));
    expect(rank(d, 'tv-11')).toBeLessThan(rank(d, 'tv-13'));
    // The western: kit has no view, and goes most of the way with alex — it still leads.
    expect(ids(d)[0]).toBe('tv-10');
  });

  it('on the sample household: alex with the newcomer gets alex\'s kind of deck; all three get what alex and sam share', () => {
    const big = syntheticCatalog(800);
    const c = makeCtx({ catalog: big, members: ['alex', 'sam', 'kit'] });
    const ask = (who: Who): SuggestRequest => req({ who, mood: 'laugh', time: 'any', novelty: 'new' });
    const top = (who: Who) => ids(engine.buildDeck(ask(who), c, { limit: 20 }));
    const shared = (a: string[], b: string[]) => a.filter((id) => b.includes(id)).length;
    const alex = top(ALEX);
    const kit = top(KIT);
    const alexKit = top(['alex', 'kit']);
    expect(shared(alexKit, alex)).toBeGreaterThanOrEqual(14);
    expect(shared(alexKit, alex)).toBeGreaterThan(shared(alexKit, kit) + 4);
    const pair = top(BOTH);
    const trio = top(['alex', 'kit', 'sam']);
    expect(shared(trio, pair)).toBeGreaterThanOrEqual(14);
    expect(shared(trio, pair)).toBeGreaterThan(shared(trio, kit) + 4);
    // Reasons in the mixed deck are about the person we know, by name.
    const reasons = engine.buildDeck(ask(['alex', 'kit']), c, { limit: 10 }).flatMap((x) => x.reasons).join(' | ');
    expect(reasons).toMatch(/Because Alex loves /);
    expect(reasons).not.toMatch(/Kit loves|Because you/);
  });

  it('an acquired taste one watcher has not shown is still held back for the group', () => {
    const plain = title(30, { keywords: ['detective'], rating: 8.0 });
    const anime = title(31, { keywords: ['detective', 'anime'], rating: 8.4 });
    const animeFav = title(33, { title: 'Anime Fav', keywords: ['based on manga', 'ninja', 'detective'] });
    const cat = madeUp([plain, anime], { alex: [animeFav] });
    const c = makeCtx({ catalog: cat, members: ['alex', 'kit'] });
    expect(ids(engine.buildDeck(req({ who: ALEX, mood: 'gripped' }), c))[0]).toBe('tv-31');
    // With the newcomer along, the anime is marked down on their account (most people who haven't shown the taste say no).
    const together = engine.buildDeck(req({ who: ['alex', 'kit'], mood: 'gripped' }), c);
    expect(scoreOf(together, 'tv-31')).toBeLessThan(scoreOf(engine.buildDeck(req({ who: ALEX, mood: 'gripped' }), c), 'tv-31') - 0.1);
  });
});

// ---------------------------------------------------------------------------
describe('blending two, three and four watchers: the pick has to suit everyone', () => {
  it('the formula: 0.56 x the least keen watcher + 0.44 x the average', () => {
    expect(blend([0.7])).toBe(0.7);
    // Two watchers: exactly the rule the ranking was tuned with (0.78 x lower + 0.22 x higher).
    expect(blend([0.2, 0.8])).toBeCloseTo(0.78 * 0.2 + 0.22 * 0.8, 10);
    expect(blend([0.8, 0.2])).toBeCloseTo(blend([0.2, 0.8]), 12);
    // Three and four: the least keen carries 71% and 67%; the others share the rest equally.
    expect(blend([0, 1, 1])).toBeCloseTo(0.44 * (2 / 3), 10);
    expect(blend([1, 0, 0])).toBeCloseTo(0.44 / 3, 10);
    expect(blend([0, 1, 1, 1])).toBeCloseTo(0.44 * 0.75, 10);
    expect(blend([1, 0, 0, 0])).toBeCloseTo(0.11, 10);
    expect(blend([0.5, 0.5, 0.5, 0.5])).toBeCloseTo(0.5, 10);
    // Always between the lowest score and the average, and the order of the watchers never matters.
    const sets = [[0.9, 0.1, 0.5], [0.3, 0.3, 0.9, 0.2], [1, 0.6, 0.6, 0.6], [-0.2, 0.8, 0.8, 0.8]];
    for (const s of sets) {
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      expect(blend(s)).toBeGreaterThanOrEqual(Math.min(...s) - 1e-12);
      expect(blend(s)).toBeLessThanOrEqual(mean + 1e-12);
      expect(blend([...s].reverse())).toBeCloseTo(blend(s), 12);
    }
    // Raising anyone's score never lowers the blend.
    expect(blend([0.3, 0.5, 0.9, 0.6])).toBeGreaterThan(blend([0.3, 0.5, 0.7, 0.6]));
    expect(blend([0.4, 0.5, 0.9, 0.6])).toBeGreaterThan(blend([0.3, 0.5, 0.9, 0.6]));
  });

  it('what it means: one lukewarm watcher in four does not veto, a real objection does, and "everyone likes it" beats "some love it"', () => {
    // Three love it (0.9), one is lukewarm (0.5): still ahead of something all four merely like (0.6)...
    expect(blend([0.9, 0.9, 0.9, 0.5])).toBeGreaterThan(blend([0.6, 0.6, 0.6, 0.6]));
    // ...and far ahead of something nobody feels anything for.
    expect(blend([0.9, 0.9, 0.9, 0.5])).toBeGreaterThan(blend([0.5, 0.5, 0.5, 0.5]) + 0.1);
    // But if the fourth actively dislikes it (0.1), the thing they all like wins.
    expect(blend([0.9, 0.9, 0.9, 0.1])).toBeLessThan(blend([0.6, 0.6, 0.6, 0.6]));
    // Two love it and two have nothing for it: loses to a title all four like.
    expect(blend([0.9, 0.9, 0.3, 0.3])).toBeLessThan(blend([0.65, 0.65, 0.65, 0.65]));
    // The least keen watcher counts for less as the group grows (78% -> 71% -> 67%), never for less than two thirds.
    const leastKeenShare = (n: number) => 1 - blend([0, ...new Array<number>(n - 1).fill(1)]);
    expect(leastKeenShare(2)).toBeCloseTo(0.78, 10);
    expect(leastKeenShare(3)).toBeCloseTo(0.56 + 0.44 / 3, 10);
    expect(leastKeenShare(4)).toBeCloseTo(0.67, 10);
  });

  // Four people, four tastes.
  const people: MemberId[] = ['alex', 'sam', 'kit', 'dee'];
  const kinds = { alex: ['western', ['gunslinger', 'frontier', 'outlaw']], sam: ['music', ['ballet', 'dance', 'audition']], kit: ['war', ['trench', 'battalion', 'siege']], dee: ['fantasy', ['wizard', 'quest', 'kingdom']] } as const;
  const favsOf = (m: keyof typeof kinds, base: number) => [0, 1, 2].map((k) => title(base + k, { title: `${m} fav ${k}`, genres: [kinds[m][0]], keywords: [...kinds[m][1]] }));
  const favs = { alex: favsOf('alex', 1), sam: favsOf('sam', 4), kit: favsOf('kit', 7), dee: favsOf('dee', 10) };
  const forOne = title(20, { genres: ['western'], keywords: ['gunslinger', 'frontier', 'outlaw'] }); // alex only
  const forThree = title(21, { genres: ['western', 'music', 'war'], keywords: ['gunslinger', 'frontier', 'outlaw', 'ballet', 'dance', 'audition', 'trench', 'battalion', 'siege'] }); // everyone but dee
  const forAll = title(22, { genres: ['western', 'music', 'war', 'fantasy'], keywords: ['gunslinger', 'frontier', 'ballet', 'dance', 'trench', 'battalion', 'wizard', 'quest'] });
  const forNobody = title(23, { genres: ['history'], keywords: ['archive'] });
  const catalog = madeUp([forOne, forThree, forAll, forNobody], favs);
  // (These made-up people have no never-show-me choices.)
  const none = { horror: false, trueCrime: false, scary: false, genres: [], subtitled: false };
  const ctx = (cat: Catalog = catalog) => makeCtx({ catalog: cat, members: people, dealbreakers: { alex: none, sam: none, kit: none, dee: none } });
  const r = req({ mood: 'gripped' });
  /**
   * Which of two titles the blend prefers for an audience: a catalog of just those two, so that the
   * first card is decided by the blended score alone (nothing has been dealt yet for variety to react to).
   */
  const prefers = (a: CatalogItem, b: CatalogItem, who: Who, change?: (c: ReturnType<typeof makeCtx>) => void): string => {
    const c = ctx(madeUp([b, a], favs));
    change?.(c);
    return engine.buildDeck({ ...r, who }, c)[0].itemId;
  };

  it('four watching: for all four > three love it > one loves it > nobody cares', () => {
    expect(ids(engine.buildDeck({ ...r, who: ALL_FOUR }, ctx()))[0]).toBe('tv-22');
    expect(prefers(forAll, forThree, ALL_FOUR)).toBe('tv-22');
    expect(prefers(forThree, forOne, ALL_FOUR)).toBe('tv-21');
    // One lukewarm person in four does not veto: the title three of them love beats the one nobody cares about...
    expect(prefers(forThree, forNobody, ALL_FOUR)).toBe('tv-21');
    // ...and even one person's enthusiasm counts for a little.
    expect(prefers(forOne, forNobody, ALL_FOUR)).toBe('tv-20');
  });

  it('three watching (the three it suits): the title made for those three leads', () => {
    const trio: Who = ['alex', 'kit', 'sam'];
    expect(ids(engine.buildDeck({ ...r, who: trio }, ctx()))[0]).toBe('tv-21');
    expect(prefers(forThree, forOne, trio)).toBe('tv-21');
    expect(prefers(forThree, forNobody, trio)).toBe('tv-21');
    // A different three (dee instead of kit): the title for all four suits them better than the one that leaves dee out.
    expect(prefers(forAll, forThree, ['alex', 'dee', 'sam'])).toBe('tv-22');
  });

  it('each alone gets their own kind first; every pair gets a title that suits both of them before one that suits only one', () => {
    expect(ids(engine.buildDeck({ ...r, who: ALEX }, ctx()))[0]).toBe('tv-20');
    for (const who of audiencesOf(people).filter((w) => w.length === 2)) {
      const deck = engine.buildDeck({ ...r, who }, ctx());
      expect(['tv-21', 'tv-22'], who.join('+')).toContain(ids(deck)[0]);
      if (who.includes('dee')) expect(ids(deck)[0], who.join('+')).toBe('tv-22'); // the only one with anything for dee
      if (who.includes('alex')) expect(prefers(forAll, forOne, who), who.join('+')).toBe('tv-22');
    }
  });

  it('a real objection from one of the four sinks a title the other three love', () => {
    const objects = (c: ReturnType<typeof makeCtx>) => {
      c.state.profiles.dee = engine.correctTaste(c.state.profiles.dee, 'genre:war', 'less');
    };
    // Below even the title nobody cares about.
    expect(prefers(forThree, forNobody, ALL_FOUR, objects)).toBe('tv-23');
    // The other three, watching without dee, are unaffected.
    expect(prefers(forThree, forNobody, ['alex', 'kit', 'sam'], objects)).toBe('tv-21');
  });

  it('a pair inside a household of four is treated exactly as that pair in a household of two', () => {
    const four = makeCtx({ members: HOUSE_OF_FOUR, seen: { alex: ['tv-2316'], sam: ['tv-8592'] } });
    const two = makeCtx({ seen: { alex: ['tv-2316'], sam: ['tv-8592'] } });
    for (const mood of ['laugh', 'cozy', 'gripped'] as const) for (const novelty of ['new', 'either', 'rewatch'] as const) {
      const a = engine.buildDeck(req({ who: BOTH, mood, novelty }), four, { seed: 4, limit: 100 });
      const b = engine.buildDeck(req({ who: BOTH, mood, novelty }), two, { seed: 4, limit: 100 });
      expect(a).toEqual(b);
    }
    // ...and each of them alone, likewise.
    expect(engine.buildDeck(req({ who: SAM, mood: 'cozy' }), four)).toEqual(engine.buildDeck(req({ who: SAM, mood: 'cozy' }), two));
  });

  it('on the sample household, decks for three and four are full, on-mood, and scores never rise down the deck', () => {
    const big = syntheticCatalog(800);
    const c = makeCtx({ catalog: big, members: HOUSE_OF_FOUR });
    for (const who of audiencesOf(HOUSE_OF_FOUR).filter((w) => w.length >= 3)) {
      for (const mood of ['laugh', 'gripped', 'cozy'] as const) {
        const deck = engine.buildDeck(req({ who, mood, time: 'any' }), c, { seed: 2 });
        expect(deck.length, `${who.join('+')} ${mood}`).toBe(30);
        for (let k = 1; k < deck.length; k++) expect(deck[k].score).toBeLessThanOrEqual(deck[k - 1].score);
        expect(new Set(ids(deck)).size).toBe(30);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('reasons and follow-ups use people\'s names, never their ids', () => {
  const FAMILY_GUY = 'tv-1434';
  const BOBS = 'tv-32726';
  const reasonsOf = (deck: DeckCard[], id: string) => deck.find((c) => c.itemId === id)!.reasons;

  it('alone it is always "you"', () => {
    const ctx = makeCtx();
    const own = engine.buildDeck(req({ who: ALEX, novelty: 'rewatch' }), ctx, { limit: 100 });
    expect(reasonsOf(own, 'tv-4556')[0]).toBe('One of your favourites');
    for (const who of [ALEX, SAM]) {
      for (const novelty of ['new', 'rewatch'] as const) for (const mood of ['laugh', 'gripped', 'cozy'] as const) {
        for (const c of engine.buildDeck(req({ who, novelty, mood }), ctx, { limit: 100 })) {
          for (const reason of c.reasons) expect(reason, reason).not.toMatch(/Alex|Sam|alex|sam|both|all (three|four)/);
        }
      }
    }
  });

  it('two watching: "both of you" / "you both", and the name of the one whose favourite it is', () => {
    const ctx = makeCtx();
    const deck = engine.buildDeck(req({ who: BOTH, novelty: 'rewatch' }), ctx, { limit: 100 });
    expect(reasonsOf(deck, FAMILY_GUY)[0]).toBe('A favourite for both of you');
    expect(reasonsOf(deck, 'tv-4556')[0]).toBe("One of Alex's favourites"); // Scrubs
    expect(reasonsOf(deck, 'tv-1668')[0]).toBe("One of Sam's favourites"); // Friends
    const fresh = engine.buildDeck(req({ who: BOTH, mood: 'laugh', novelty: 'new' }), ctx, { limit: 100 });
    expect(reasonsOf(fresh, BOBS)[0]).toBe('Because you both love Family Guy');
    expect(reasonsOf(fresh, 'tv-2316').join(' | ')).toMatch(/Because Alex loves Scrubs|Because Sam loves Community/);
  });

  it('three and four watching: "all three of you" / "all four of you" when it is everyone, names when it is some', () => {
    const fg = asFavorite(item(FAMILY_GUY));
    // Everyone has Family Guy as a favourite.
    const three = makeCtx({ members: ['alex', 'sam', 'kit'], favorites: { kit: [fg] } });
    const own3 = engine.buildDeck(req({ who: ['alex', 'kit', 'sam'], novelty: 'rewatch' }), three, { limit: 100 });
    expect(reasonsOf(own3, FAMILY_GUY)[0]).toBe('A favourite for all three of you');
    const new3 = engine.buildDeck(req({ who: ['alex', 'kit', 'sam'], mood: 'laugh', novelty: 'new' }), three, { limit: 100 });
    expect(reasonsOf(new3, BOBS)[0]).toBe('Because all three of you love Family Guy');

    const none = { horror: false, trueCrime: false, scary: false, genres: [], subtitled: false };
    const four = makeCtx({ members: HOUSE_OF_FOUR, favorites: { kit: [fg], dee: [fg] }, dealbreakers: { dee: none } });
    const own4 = engine.buildDeck(req({ who: ALL_FOUR, novelty: 'rewatch' }), four, { limit: 100 });
    expect(reasonsOf(own4, FAMILY_GUY)[0]).toBe('A favourite for all four of you');
    expect(reasonsOf(engine.buildDeck(req({ who: ALL_FOUR, mood: 'laugh', novelty: 'new' }), four, { limit: 100 }), BOBS)[0]).toBe('Because all four of you love Family Guy');

    // Only alex and sam have it (kit is blank): they are named, kit is not, and nobody is "both of you".
    const mixed = makeCtx({ members: ['alex', 'sam', 'kit'] });
    const own = engine.buildDeck(req({ who: ['alex', 'kit', 'sam'], novelty: 'rewatch' }), mixed, { limit: 100 });
    expect(reasonsOf(own, FAMILY_GUY)[0]).toBe('A favourite for Alex and Sam');
    expect(reasonsOf(own, 'tv-4556')[0]).toBe("One of Alex's favourites");
    const fresh = engine.buildDeck(req({ who: ['alex', 'kit', 'sam'], mood: 'laugh', novelty: 'new' }), mixed, { limit: 100 });
    expect(reasonsOf(fresh, BOBS)).toContain('Because Alex and Sam both love Family Guy');
    for (const c of [...own, ...fresh]) for (const reason of c.reasons) expect(reason).not.toMatch(/you both|both of you|all three/);
    // Three of four share it.
    const most = makeCtx({ members: HOUSE_OF_FOUR, favorites: { kit: [fg] }, dealbreakers: { dee: none } });
    expect(reasonsOf(engine.buildDeck(req({ who: ALL_FOUR, novelty: 'rewatch' }), most, { limit: 100 }), FAMILY_GUY)[0]).toBe('A favourite for Alex, Sam and Kit');
    expect(reasonsOf(engine.buildDeck(req({ who: ALL_FOUR, mood: 'laugh', novelty: 'new' }), most, { limit: 100 }), BOBS)).toContain('Because Alex, Sam and Kit all love Family Guy');
  });

  it('"asked for more": you, alone; the person\'s name, in a group', () => {
    const ctx = makeCtx({ members: ['alex', 'sam', 'kit'] });
    ctx.state.profiles.kit = engine.correctTaste(ctx.state.profiles.kit, 'genre:western', 'more');
    const solo = engine.buildDeck(req({ who: KIT, mood: 'gripped', time: 60, novelty: 'new' }), ctx, { limit: 100 });
    expect(reasonsOf(solo, 'tv-73586')).toContain('You asked for more westerns'); // Yellowstone
    const group = engine.buildDeck(req({ who: ['alex', 'kit'], mood: 'gripped', time: 60, novelty: 'new' }), ctx, { limit: 100 });
    expect(reasonsOf(group, 'tv-73586')).toContain('Kit asked for more westerns');
  });

  it('names come from the household\'s member list — whatever the ids are, the ids are never printed', () => {
    const sample = makeCtx();
    const ctx = makeCtx({
      members: ['m1', 'm2', 'm3'],
      favorites: { m1: sample.state.profiles.alex.favorites, m2: sample.state.profiles.sam.favorites },
      seen: { m3: ['tv-1416'] },
    });
    ctx.state.members.m1.name = 'Robin';
    ctx.state.members.m2.name = 'Jo';
    ctx.state.members.m3.name = 'Chris';
    const all: Who = ['m1', 'm2', 'm3'];
    const texts: string[] = [];
    for (const who of audiencesOf(all)) {
      for (const novelty of ['new', 'rewatch'] as const) for (const mood of ['laugh', 'gripped'] as const) {
        for (const c of engine.buildDeck(req({ who, novelty, mood }), ctx, { limit: 100 })) texts.push(...c.reasons);
      }
      for (const f of engine.followUps(who, ctx)) texts.push(f.text, ...f.reasons);
    }
    const joined = texts.join(' | ');
    expect(joined).toMatch(/One of Robin's favourites/);
    expect(joined).toMatch(/One of Jo's favourites/);
    expect(joined).toMatch(/Because Robin and Jo both love Family Guy/);
    expect(joined).toMatch(/one of Jo's shows/);
    expect(joined).toMatch(/all three of you watched this/); // Grey's Anatomy: a favourite of two, seen by the third
    for (const t of texts) expect(t, t).not.toMatch(/\bm[123]\b|M[123]\b|undefined|null|NaN/);
    // A name ending in s still reads properly.
    const chris = makeCtx({ members: ['m1', 'm3'], favorites: { m3: sample.state.profiles.alex.favorites } });
    chris.state.members.m3.name = 'Chris';
    const own = engine.buildDeck(req({ who: ['m1', 'm3'], novelty: 'rewatch' }), chris, { limit: 100 });
    expect(own.find((c) => c.itemId === 'tv-4556')!.reasons[0]).toBe("One of Chris's favourites");
  });

  it('someone whose name has not arrived yet is "Someone" — still never an id', () => {
    const ctx = makeCtx();
    delete (ctx.state.members as Record<string, unknown>).alex;
    const deck = engine.buildDeck(req({ who: BOTH, novelty: 'rewatch' }), ctx, { limit: 100 });
    expect(deck.find((c) => c.itemId === 'tv-4556')!.reasons[0]).toBe("One of Someone's favourites");
    for (const c of deck) for (const reason of c.reasons) expect(reason).not.toMatch(/alex/);
  });

  it('follow-ups say whose show it is: everyone, some of them by name, or one person', () => {
    const GREYS = 'tv-1416'; // favourite of alex and sam; season 21 started 1 October
    const TRAITORS = 'tv-205715'; // sam's favourite
    const HOTD = 'tv-94997'; // spinoff of Game of Thrones (alex's favourite)
    const GOT = 'tv-1399';
    const find = (who: Who, ctx: ReturnType<typeof makeCtx>, id: string) => engine.followUps(who, ctx).find((f) => f.itemId === id);
    const trio: Who = ['alex', 'kit', 'sam'];

    // kit has not watched Grey's: it is alex's and sam's show.
    const three = makeCtx({ members: ['alex', 'sam', 'kit'] });
    expect(find(trio, three, GREYS)!.text).toBe('Season 21 is out — Alex and Sam both watched this');
    expect(find(trio, three, TRAITORS)!.text).toBe("Season 3 is out — one of Sam's shows");
    expect(find(trio, three, HOTD)!.text).toBe('A spinoff of Game of Thrones, which Alex watched');
    expect(find(['kit', 'sam'], three, GREYS)!.text).toBe("Season 21 is out — one of Sam's shows");
    expect(find(BOTH, three, GREYS)!.text).toBe('Season 21 is out — you both watched this');
    expect(find(KIT, three, GREYS)).toBeUndefined();
    expect(find(SAM, three, GREYS)!.text).toBe('Season 21 is out'); // alone: nobody is named

    // kit watched it too: all three.
    const all = makeCtx({ members: ['alex', 'sam', 'kit'], seen: { kit: [GREYS, GOT], sam: [GOT] } });
    expect(find(trio, all, GREYS)!.text).toBe('Season 21 is out — all three of you watched this');
    expect(find(trio, all, HOTD)!.text).toBe('A spinoff of Game of Thrones, which all three of you watched');
    const two = makeCtx({ members: ['alex', 'sam', 'kit'], seen: { sam: [GOT] } });
    expect(find(trio, two, HOTD)!.text).toBe('A spinoff of Game of Thrones, which Alex and Sam both watched');

    // Four: "all four of you", and three of four by name.
    const four = makeCtx({ members: HOUSE_OF_FOUR, seen: { kit: [GREYS], dee: [GREYS] } });
    expect(find(ALL_FOUR, four, GREYS)!.text).toBe('Season 21 is out — all four of you watched this');
    const threeOfFour = makeCtx({ members: HOUSE_OF_FOUR, seen: { kit: [GREYS] } });
    expect(find(ALL_FOUR, threeOfFour, GREYS)!.text).toBe('Season 21 is out — Alex, Sam and Kit all watched this');
    // A spinoff whose parent we can only name from a favourite that is not in the catalog.
    const child = title(2, { title: 'Child Show', spinoffOf: ['tv-39269'] }); // Scandal: sam's off-catalog favourite
    const cat: Catalog = { ...FIXTURE_CATALOG, items: [...FIXTURE_CATALOG.items, child] };
    expect(engine.followUps(['kit', 'sam'], makeCtx({ catalog: cat, members: ['alex', 'sam', 'kit'] })).find((f) => f.itemId === 'tv-2')!.text).toBe('A spinoff of Scandal, which Sam watched');
  });

  it('follow-ups for a group: what more of them watched comes first', () => {
    const GREYS = 'tv-1416';
    const ABBOTT = 'tv-125935'; // season 4 started 7 October (newer than Grey's)
    const ctx = makeCtx({ members: ['alex', 'sam', 'kit'], seen: { alex: { [ABBOTT]: '2026-08-15' }, kit: { [ABBOTT]: '2026-08-15' } } });
    const trio = engine.followUps(['alex', 'kit', 'sam'], ctx).map((f) => f.itemId);
    // Both were watched by two of the three, so the newer season leads; The Traitors (one person) follows.
    expect(trio.slice(0, 3)).toEqual([ABBOTT, GREYS, 'tv-205715']);
    const all = makeCtx({ members: ['alex', 'sam', 'kit'], seen: { alex: { [ABBOTT]: '2026-08-15' }, kit: { [GREYS]: '2026-08-15' } } });
    // Now Grey's is all three's and Abbott only alex's: Grey's leads although Abbott's season is newer.
    expect(engine.followUps(['alex', 'kit', 'sam'], all).map((f) => f.itemId).slice(0, 2)).toEqual([GREYS, ABBOTT]);
  });
});

// ---------------------------------------------------------------------------
describe('favourites carry their own data', () => {
  it('a favourite that is not in the catalog steers by the genres and keywords it carries', () => {
    const fav: FavoriteTitle = { id: 'tv-555001', kind: 'tv', title: 'An Unlisted Game Show', year: 2020, genres: ['reality'], keywords: ['competition', 'strategy', 'social game', 'elimination'], poster: null };
    const ctx = makeCtx({ members: ['kit'], favorites: { kit: [fav] } });
    const deck = engine.buildDeck(req({ who: KIT, mood: 'gripped', time: 60, novelty: 'new' }), ctx, { limit: 100 });
    const blank = engine.buildDeck(req({ who: KIT, mood: 'gripped', time: 60, novelty: 'new' }), makeCtx({ members: ['kit'] }), { limit: 100 });
    expect(rank(deck, 'tv-205715')).toBeLessThan(rank(blank, 'tv-205715')); // The Traitors
    expect(rank(deck, 'tv-205715')).toBeLessThanOrEqual(3);
    expect(deck.find((c) => c.itemId === 'tv-205715')!.reasons).toContain('Because you love An Unlisted Game Show');
    expect(engine.hasSeen('kit', 'tv-555001', ctx)).toBe(true);
  });

  it('with no keywords it still counts, through its genres', () => {
    const fav: FavoriteTitle = { id: 'tv-555002', kind: 'tv', title: 'Bare Western', year: 2001, genres: ['western'], keywords: [], poster: null };
    const ctx = makeCtx({ members: ['kit'], favorites: { kit: [fav] } });
    const r = req({ who: KIT, mood: 'gripped', time: 60, novelty: 'new' });
    const deck = engine.buildDeck(r, ctx, { limit: 100 });
    const blank = engine.buildDeck(r, makeCtx({ members: ['kit'] }), { limit: 100 });
    // Yellowstone (drama, western) moves up, and says why.
    expect(rank(deck, 'tv-73586')).toBeLessThan(rank(blank, 'tv-73586'));
    expect(deck.find((c) => c.itemId === 'tv-73586')!.reasons).toContain('Because you love Bare Western');
    // A favourite with no genres and no keywords tells us nothing: the person is still treated as new.
    const nothing: FavoriteTitle = { id: 'tv-555009', kind: 'tv', title: 'Just A Name', year: 2001, genres: [], keywords: [], poster: null };
    expect(ids(engine.buildDeck(r, makeCtx({ members: ['kit'], favorites: { kit: [nothing] } }), { limit: 100 }))).toEqual(ids(blank));
  });

  it('when the favourite IS in the catalog, the catalog\'s richer data is used — whatever the favourite itself carries', () => {
    const full = sampleProfile('alex').favorites;
    // The same favourites as a search might have returned them: no keywords, and the wrong genres.
    const thin = full.map((f): FavoriteTitle => (byId.has(f.id) ? { ...f, genres: ['history'], keywords: [] } : f));
    const a = makeCtx({ favorites: { alex: full } });
    const b = makeCtx({ favorites: { alex: thin } });
    for (const mood of ['laugh', 'gripped'] as const) {
      expect(engine.buildDeck(req({ who: ALEX, mood, novelty: 'new' }), b, { limit: 100 })).toEqual(engine.buildDeck(req({ who: ALEX, mood, novelty: 'new' }), a, { limit: 100 }));
    }
    expect(engine.describeTaste(b.state.profiles.alex, FIXTURE_CATALOG)).toEqual(engine.describeTaste(a.state.profiles.alex, FIXTURE_CATALOG));
    // ...including its "people also like" links, which a favourite never carries: The Office is on Scrubs' list.
    const scrubsOnly = makeCtx({ members: ['kit'], favorites: { kit: [{ id: 'tv-4556', kind: 'tv', title: 'Scrubs', year: 2001, genres: [], keywords: [], poster: null }] } });
    const deck = engine.buildDeck(req({ who: KIT, mood: 'laugh', novelty: 'new' }), scrubsOnly, { limit: 100 });
    expect(deck.find((c) => c.itemId === 'tv-2316')!.reasons).toContain('Because you love Scrubs');
  });

  it('the same favourite id with different data is not confused with an earlier one (two households, one phone)', () => {
    const western: FavoriteTitle = { id: 'tv-555003', kind: 'tv', title: 'Mystery Fav', year: 2001, genres: ['western'], keywords: ['ranch'], poster: null };
    const reality: FavoriteTitle = { ...western, genres: ['reality'], keywords: ['competition', 'strategy'] };
    const r = req({ who: KIT, mood: 'gripped', time: 60, novelty: 'new' });
    const first = engine.buildDeck(r, makeCtx({ members: ['kit'], favorites: { kit: [western] } }), { limit: 100 });
    const second = engine.buildDeck(r, makeCtx({ members: ['kit'], favorites: { kit: [reality] } }), { limit: 100 });
    expect(rank(first, 'tv-73586')).toBeLessThan(rank(second, 'tv-73586')); // Yellowstone
    expect(rank(second, 'tv-205715')).toBeLessThan(rank(first, 'tv-205715')); // The Traitors
  });

  it('a favourite we know nothing about, or a damaged one, does no harm', () => {
    const empty: FavoriteTitle = { id: 'movie-555004', kind: 'movie', title: 'Nothing Known', year: 0, genres: [], keywords: [], poster: null };
    const ctx = makeCtx({ members: ['kit'], favorites: { kit: [empty, { id: 'tv-555005' } as FavoriteTitle, null as unknown as FavoriteTitle] } });
    const deck = engine.buildDeck(req({ who: KIT, mood: 'laugh' }), ctx, { limit: 100 });
    expect(deck.length).toBeGreaterThan(10);
    for (const c of deck) for (const reason of c.reasons) expect(reason).not.toMatch(/undefined|null|NaN/);
    expect(() => engine.describeTaste(ctx.state.profiles.kit, FIXTURE_CATALOG)).not.toThrow();
    expect(() => engine.followUps(KIT, ctx)).not.toThrow();
    expect(engine.hasSeen('kit', 'movie-555004', ctx)).toBe(true);
  });

  it('a full list of forty favourites works, and learning from a swipe leaves the list exactly as it was', () => {
    const forty = FIXTURE_CATALOG.items.slice(0, 40).map(asFavorite);
    const ctx = makeCtx({ members: ['kit'], favorites: { kit: forty } });
    expect(engine.buildDeck(req({ who: KIT, mood: 'laugh', novelty: 'rewatch' }), ctx, { limit: 100 }).length).toBeGreaterThan(10);
    expect(engine.describeTaste(ctx.state.profiles.kit, FIXTURE_CATALOG).length).toBeGreaterThanOrEqual(8);
    const next = engine.learnFromSwipe(ctx.state.profiles.kit, item('tv-68595'), 'yes', FIXTURE_CATALOG);
    expect(next.favorites).toEqual(forty);
    expect(next.favorites).not.toBe(ctx.state.profiles.kit.favorites);
  });
});

// ---------------------------------------------------------------------------
describe('big catalogs, and catalogs that change', () => {
  it('a household with many services (8,000 titles): a warm deck is fast for every audience size', () => {
    const catalog = syntheticCatalog(8000);
    expect(catalog.items).toHaveLength(8000);
    const ctx = makeCtx({
      catalog,
      members: HOUSE_OF_FOUR,
      seen: { alex: catalog.items.slice(100, 400).map((i) => i.id), sam: catalog.items.slice(300, 700).map((i) => i.id), kit: catalog.items.slice(600, 2600).map((i) => i.id) },
      never: { alex: catalog.items.slice(900, 1000).map((i) => i.id), kit: catalog.items.slice(950, 1100).map((i) => i.id) },
    });
    const cold0 = performance.now();
    engine.buildDeck(req({ who: KIT, mood: 'cozy' }), ctx);
    const coldIndex = performance.now() - cold0;
    const first0 = performance.now();
    engine.buildDeck(req({ who: ALL_FOUR, mood: 'cozy' }), ctx);
    const firstAll = performance.now() - first0;
    let worst = 0;
    let total = 0;
    let n = 0;
    for (const who of [KIT, ALEX, BOTH, ['alex', 'kit', 'sam'], ALL_FOUR] as Who[]) {
      const asks = [
        req({ who, mood: 'laugh', viewing: 'background', time: 20 }),
        req({ who, mood: 'gripped', time: 60, novelty: 'new' }),
        req({ who, mood: 'cozy', viewing: 'eating', time: 45 }),
        req({ who, mood: 'hyped', genre: 'action', novelty: 'new' }),
        req({ who, mood: 'feelgood', time: 'any' }),
      ];
      for (let round = 1; round <= 4; round++) {
        for (const r of asks) {
          const t0 = performance.now();
          const deck = engine.buildDeck(r, ctx, { seed: round });
          const ms = performance.now() - t0;
          expect(deck.length).toBe(30);
          worst = Math.max(worst, ms);
          total += ms;
          n++;
        }
      }
    }
    // Generous ceilings so a busy test machine doesn't cause false alarms. Typical on a desktop:
    // about 10 ms warm (a phone is several times slower, hence the budget of well under 100 ms there).
    expect(total / n).toBeLessThan(60);
    expect(worst).toBeLessThan(200);
    expect(coldIndex).toBeLessThan(1500);
    expect(firstAll).toBeLessThan(3000);
    const f0 = performance.now();
    engine.followUps(ALL_FOUR, ctx);
    expect(performance.now() - f0).toBeLessThan(200);
  }, 60_000);

  it('the per-catalog work is done once per catalog OBJECT and never carried over to another', () => {
    const a = syntheticCatalog(300);
    expect(getIndex(a)).toBe(getIndex(a));
    const copy: Catalog = { ...a };
    expect(getIndex(copy)).not.toBe(getIndex(a));
    expect(getIndex(copy).catalog).toBe(copy);
  });

  it('when the household changes its plans the catalog object changes: decks come from the new one only', () => {
    // Before: every service. After: Netflix only — a new, smaller catalog object with different titles in it.
    const before = FIXTURE_CATALOG;
    const netflix = FIXTURE_CATALOG.items.filter((i) => i.providers.includes(8));
    const extra = title(990001, { title: 'Only In The New Catalog', genres: ['comedy'], keywords: ['sitcom', 'workplace comedy'], runtime: 22, dropIn: true, attention: 'low', moods: { laugh: 0.9 }, rating: 8.4, votes: 4000 });
    const after: Catalog = { schema: 1, builtAt: '2026-10-11T06:00:00.000Z', items: [...netflix, extra] };
    const r = req({ who: ALEX, mood: 'laugh', novelty: 'new' });
    const favorites = { alex: sampleProfile('alex').favorites, sam: sampleProfile('sam').favorites };
    const old = engine.buildDeck(r, makeCtx({ catalog: before, favorites }), { limit: 100 });
    const now = engine.buildDeck(r, makeCtx({ catalog: after, favorites, plans: { netflix: 'standard' } }), { limit: 100 });
    expect(ids(old)).not.toContain(extra.id);
    expect(ids(now)).toContain(extra.id);
    const allowed = new Set(after.items.map((i) => i.id));
    for (const c of now) {
      expect(allowed.has(c.itemId), c.itemId).toBe(true);
      expect(c.service.serviceId).toBe('netflix');
    }
    // Favourites that dropped out of the catalog with the old services still shape taste (they carry their own data):
    // Scrubs (Hulu) is gone from the catalog, but it is still alex's favourite and still a reason.
    expect(after.items.some((i) => i.id === 'tv-4556')).toBe(false);
    expect(now.find((c) => c.itemId === extra.id)!.reasons.join(' | ')).toMatch(/Scrubs|Curb Your Enthusiasm|How I Met Your Mother/);
    // Going back to the old catalog gives exactly the old answer (nothing was overwritten).
    expect(engine.buildDeck(r, makeCtx({ catalog: before, favorites }), { limit: 100 })).toEqual(old);
    // Many catalogs in a row (a household editing its plans repeatedly) stay correct.
    for (let k = 0; k < 12; k++) {
      const c: Catalog = { ...after, items: after.items.slice(k) };
      const deck = engine.buildDeck(r, makeCtx({ catalog: c, favorites, plans: { netflix: 'standard' } }), { limit: 100 });
      const inC = new Set(c.items.map((i) => i.id));
      for (const card of deck) expect(inC.has(card.itemId)).toBe(true);
    }
  });

  it('the first-run grid: popular, widely known, a good spread, only what is on the selected plans — whatever the plans', () => {
    const catalog = syntheticCatalog(2000);
    for (const plans of [PLANS, { netflix: 'standard' }, { peacock: 'premium', paramount: 'essential' }, { disney: 'premium', hulu: 'noads', hbo: 'adfree' }]) {
      const grid = engine.onboardingTitles(catalog, plans, 40);
      expect(grid).toHaveLength(40);
      expect(new Set(grid.map((i) => i.id)).size).toBe(40);
      for (const i of grid) expect(engine.chooseService(i, plans)).not.toBeNull();
      expect(new Set(grid.map((i) => i.genres[0])).size).toBeGreaterThanOrEqual(5);
      expect(grid.some((i) => i.kind === 'movie')).toBe(true);
      expect(grid.some((i) => i.kind === 'tv')).toBe(true);
      // Well known: far more votes than the typical title on those plans.
      const onPlan = catalog.items.filter((i) => engine.chooseService(i, plans));
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      expect(median(grid.map((i) => i.votes))).toBeGreaterThan(median(onPlan.map((i) => i.votes)) * 1.5);
      expect(engine.onboardingTitles(catalog, plans, 40).map((i) => i.id)).toEqual(grid.map((i) => i.id));
    }
    expect(engine.onboardingTitles(catalog, {}, 40)).toEqual([]);
  });
});
