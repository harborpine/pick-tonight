/**
 * Ranking: what to watch, taste, mood, craving, Together blending, novelty,
 * variety, determinism, the New feed, the first-run grid, and speed.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, type Catalog, type CatalogItem, type DeckCard, type TasteRef } from '../contracts';
import { FIXTURE_CATALOG, FIXTURE_NEW_ARRIVALS } from '../contracts/fixtures/catalog';
import { createEngine } from './index';
import { itemsById, makeCtx, req, syntheticCatalog } from './testkit';

const engine = createEngine();
const byId = itemsById(FIXTURE_CATALOG);
const item = (id: string) => byId.get(id)!;
const ids = (deck: DeckCard[]) => deck.map((c) => c.itemId);
const rank = (deck: DeckCard[], id: string) => {
  const k = ids(deck).indexOf(id);
  return k < 0 ? Number.POSITIVE_INFINITY : k;
};

/** A blank title to build made-up catalogs from. */
function title(id: number, over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: `tv-${id}`,
    tmdbId: id,
    kind: 'tv',
    title: `Title ${id}`,
    year: 2015,
    genres: ['drama'],
    keywords: [],
    related: [],
    poster: null,
    backdrop: null,
    overview: '',
    runtime: 45,
    seasons: 3,
    rating: 7.5,
    votes: 1000,
    popularity: 50,
    providers: [8],
    attention: 'medium',
    moods: { gripped: 0.8 },
    dropIn: false,
    standout: [],
    flags: { horror: false, trueCrime: false, scary: false },
    ...over,
  };
}
const refOf = (i: CatalogItem): TasteRef => ({ id: i.id, tmdbId: i.tmdbId, kind: i.kind, title: i.title, year: i.year, genres: i.genres, keywords: i.keywords, related: i.related });
function madeUp(items: CatalogItem[], favs: { HG: CatalogItem[]; BG: CatalogItem[] }): Catalog {
  const all = [...favs.HG, ...favs.BG];
  return {
    schema: 1,
    builtAt: '2026-10-10T00:00:00.000Z',
    items,
    tasteRefs: [...new Map(all.map((f) => [f.id, refOf(f)])).values()],
    seedFavorites: { HG: favs.HG.map((f) => f.id), BG: favs.BG.map((f) => f.id) },
  };
}

describe('what to watch (choosePick)', () => {
  const ctx = makeCtx();
  it('a film is "the movie"', () => {
    expect(engine.choosePick(item('movie-13'), req(), ctx)?.pick).toEqual({ type: 'movie' });
  });
  it('a drop-in show with no standout episode is "any episode"', () => {
    expect(engine.choosePick(item('tv-1668'), req(), ctx)?.pick).toEqual({ type: 'any-episode' });
  });
  it('a serialized show is "start the series"', () => {
    expect(engine.choosePick(item('tv-76331'), req(), ctx)?.pick).toEqual({ type: 'series-start' });
  });
  it('a drop-in show with a standout episode names it', () => {
    expect(engine.choosePick(item('tv-2316'), req(), ctx)?.pick).toEqual({ type: 'episode', season: 4, episode: 13, name: 'Dinner Party' });
  });
  it('a serialized show names a standout episode only when everyone watching has already seen the show', () => {
    const serial: CatalogItem = { ...item('tv-76331'), id: 'tv-900010', tmdbId: 900010, standout: [{ season: 2, episode: 10, name: 'This Is Not for Tears' }] };
    const catalog = { ...FIXTURE_CATALOG, items: [...FIXTURE_CATALOG.items, serial] };
    const fresh = makeCtx({ catalog });
    expect(engine.choosePick(serial, req({ who: 'HG' }), fresh)?.pick).toEqual({ type: 'series-start' });
    const hgSeen = makeCtx({ catalog, seen: { HG: [serial.id] } });
    expect(engine.choosePick(serial, req({ who: 'HG' }), hgSeen)?.pick).toEqual({ type: 'episode', season: 2, episode: 10, name: 'This Is Not for Tears' });
    // Together, BG would be dropped into the middle of the story: start from the beginning instead.
    expect(engine.choosePick(serial, req({ who: 'Together' }), hgSeen)?.pick).toEqual({ type: 'series-start' });
    const bothSeen = makeCtx({ catalog, seen: { HG: [serial.id], BG: [serial.id] } });
    expect(engine.choosePick(serial, req({ who: 'Together' }), bothSeen)?.pick.type).toBe('episode');
  });
  it('the seed varies which standout episode is named, where there is a choice', () => {
    // Community has two standout episodes in the sample catalog.
    const picks = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const card = engine.buildDeck(req({ who: 'HG' }), ctx, { seed, limit: 100 }).find((c) => c.itemId === 'tv-18347');
      picks.add(card?.pick.type === 'episode' ? card.pick.name : String(card?.pick.type));
    }
    expect(picks.has('Advanced Dungeons & Dragons')).toBe(true);
    expect(picks.has('Modern Warfare')).toBe(true);
    // Seed 0 always names the first (best) one.
    const plain = engine.buildDeck(req({ who: 'HG' }), ctx, { limit: 100 }).find((c) => c.itemId === 'tv-18347');
    expect(plain?.pick).toEqual({ type: 'episode', season: 2, episode: 14, name: 'Advanced Dungeons & Dragons' });
  });
});

describe('deck basics', () => {
  it('cards carry a pick, a service, minutes and at most three plain-language reasons', () => {
    for (const who of ['HG', 'BG', 'Together'] as const) {
      const deck = engine.buildDeck(req({ who }), makeCtx());
      expect(deck.length).toBeGreaterThan(5);
      for (const c of deck) {
        expect(c.minutes).toBeGreaterThan(0);
        expect(c.service).toBeTruthy();
        expect(c.reasons.length).toBeLessThanOrEqual(3);
        for (const r of c.reasons) {
          expect(r.length).toBeGreaterThan(3);
          expect(r).not.toMatch(/\d\.\d|undefined|NaN|null/); // never internal numbers
        }
        expect(Number.isFinite(c.score)).toBe(true);
      }
    }
  });

  it('scores never rise down the deck (higher is better, in order)', () => {
    for (const mood of ['laugh', 'gripped', 'cozy'] as const) {
      const deck = engine.buildDeck(req({ who: 'Together', mood, genre: mood === 'laugh' ? 'comedy' : null }), makeCtx(), { limit: 100, seed: 3 });
      for (let k = 1; k < deck.length; k++) expect(deck[k].score).toBeLessThanOrEqual(deck[k - 1].score);
    }
  });

  it('returns 30 cards by default and honours `limit`', () => {
    const big = makeCtx({ catalog: syntheticCatalog(400) });
    expect(engine.buildDeck(req(), big)).toHaveLength(30);
    expect(engine.buildDeck(req(), big, { limit: 7 })).toHaveLength(7);
    expect(engine.buildDeck(req(), big, { limit: 0 })).toHaveLength(0);
  });

  it('reasons name the favourites a title resembles', () => {
    const deck = engine.buildDeck(req({ who: 'HG', novelty: 'new' }), makeCtx(), { limit: 100 });
    const office = deck.find((c) => c.itemId === 'tv-2316')!;
    expect(office.reasons.join(' | ')).toMatch(/Scrubs|Curb Your Enthusiasm/);
    const own = engine.buildDeck(req({ who: 'HG', novelty: 'rewatch' }), makeCtx()).find((c) => c.itemId === 'tv-4556')!;
    expect(own.reasons[0]).toBe('One of your favourites');
    const together = engine.buildDeck(req({ who: 'Together' }), makeCtx(), { limit: 100 }).find((c) => c.itemId === 'tv-1434')!;
    expect(together.reasons[0]).toBe('A favourite for both of you');
  });
});

describe('determinism and the seed', () => {
  it('same inputs give exactly the same deck, every time', () => {
    for (const who of ['HG', 'BG', 'Together'] as const) {
      const a = engine.buildDeck(req({ who, mood: 'cozy' }), makeCtx());
      const b = createEngine().buildDeck(req({ who, mood: 'cozy' }), makeCtx());
      expect(b).toEqual(a);
    }
  });
  it('seed 0 is the same as no seed', () => {
    expect(engine.buildDeck(req(), makeCtx(), { seed: 0 })).toEqual(engine.buildDeck(req(), makeCtx()));
  });
  it('same seed, same deck; different seeds vary the order without changing what is good', () => {
    const ctx = makeCtx({ catalog: syntheticCatalog(600) });
    const r = req({ who: 'Together', mood: 'laugh' });
    const plain = ids(engine.buildDeck(r, ctx));
    const s1 = ids(engine.buildDeck(r, ctx, { seed: 11 }));
    expect(ids(engine.buildDeck(r, ctx, { seed: 11 }))).toEqual(s1);
    const s2 = ids(engine.buildDeck(r, ctx, { seed: 12 }));
    expect(s1).not.toEqual(plain);
    expect(s2).not.toEqual(s1);
    // ...but most of the deck is the same strong titles.
    const overlap = s1.filter((id) => plain.includes(id)).length;
    expect(overlap).toBeGreaterThanOrEqual(15);
  });
});

describe('mood', () => {
  it('the top of the deck fits the requested mood', () => {
    const ctx = makeCtx();
    for (const mood of ['laugh', 'cozy', 'gripped', 'feelgood', 'romantic', 'hyped', 'think', 'cry', 'brainoff'] as const) {
      const deck = engine.buildDeck(req({ who: 'HG', mood }), ctx);
      for (const c of deck.slice(0, 3)) expect(item(c.itemId).moods[mood] ?? 0, `${mood}: ${item(c.itemId).title}`).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('the same title ranks far lower when it does not fit the mood', () => {
    const twin = (id: number, moods: CatalogItem['moods']) => title(id, { moods, keywords: ['heist'], genres: ['crime'] });
    const filler = Array.from({ length: 8 }, (_, k) => title(100 + k, { moods: { gripped: 0.6 }, rating: 7 }));
    const catalog = madeUp([twin(1, { gripped: 0.9 }), twin(2, { laugh: 0.9 }), ...filler], { HG: [], BG: [] });
    const deck = engine.buildDeck(req({ who: 'HG', mood: 'gripped' }), makeCtx({ catalog }), { limit: 100 });
    expect(rank(deck, 'tv-1')).toBe(0);
    expect(rank(deck, 'tv-2')).toBeGreaterThan(rank(deck, 'tv-107'));
  });

  it('when plenty of titles fit the mood, ones that do not are left out altogether', () => {
    const ctx = makeCtx({ catalog: syntheticCatalog(600) });
    const deck = engine.buildDeck(req({ who: 'HG', mood: 'romantic' }), ctx, { limit: 200 });
    expect(deck.length).toBeGreaterThan(12);
    for (const c of deck) expect(ctx.catalog.items.find((i) => i.id === c.itemId)!.moods.romantic ?? 0).toBeGreaterThanOrEqual(0.2);
  });

  it('when only a few fit, the deck is short and on-mood rather than padded with noise', () => {
    const deck = engine.buildDeck(req({ who: 'BG', mood: 'romantic', novelty: 'new' }), makeCtx(), { limit: 100 });
    expect(deck.length).toBeGreaterThanOrEqual(4);
    expect(ids(deck).slice(0, 2)).toContain('tv-91239'); // Bridgerton
    // Nothing with no romance and no neighbouring mood (e.g. South Park) pads the deck.
    expect(ids(deck)).not.toContain('tv-2190');
    expect(ids(deck)).not.toContain('tv-76331');
  });
});

describe('taste', () => {
  const fav = title(1, { title: 'Fav One', genres: ['comedy'], keywords: ['sitcom', 'workplace comedy', 'hospital'], runtime: 22, dropIn: true, attention: 'low', moods: { laugh: 0.9 } });
  const fav2 = title(2, { title: 'Fav Two', genres: ['comedy'], keywords: ['sitcom', 'friendship', 'bar'], runtime: 22, dropIn: true, attention: 'low', moods: { laugh: 0.9 } });
  const fav3 = title(3, { title: 'Fav Three', genres: ['reality'], keywords: ['competition', 'strategy'], moods: { gripped: 0.8 } });
  const base = { genres: ['comedy'] as CatalogItem['genres'], runtime: 22, dropIn: true, attention: 'low' as const, moods: { laugh: 0.9 } };
  const likeBoth = title(10, { ...base, keywords: ['sitcom', 'workplace comedy', 'friendship', 'bar'] });
  const likeOne = title(11, { ...base, keywords: ['workplace comedy', 'hospital'] });
  const likeNone = title(12, { ...base, genres: ['family'], keywords: ['dog', 'farm'] });
  const related = title(13, { ...base, genres: ['family'], keywords: ['zebra'] });
  const padding = Array.from({ length: 12 }, (_, k) => title(200 + k, { ...base, genres: ['music'], keywords: [`thing ${k}`, 'sitcom'], rating: 6.5 }));
  const fav1WithRelated = { ...fav, related: ['tv-13'] };
  const catalog = madeUp([fav1WithRelated, fav2, fav3, likeBoth, likeOne, likeNone, related, ...padding], { HG: [fav1WithRelated, fav2, fav3], BG: [fav3] });
  const ctx = makeCtx({ catalog });
  const deck = engine.buildDeck(req({ who: 'HG', mood: 'laugh', novelty: 'new' }), ctx, { limit: 100 });

  it('a title that resembles the favourites beats an otherwise identical one that does not', () => {
    expect(rank(deck, 'tv-11')).toBeLessThan(rank(deck, 'tv-12'));
  });
  it('resembling several favourites beats resembling just one', () => {
    expect(rank(deck, 'tv-10')).toBeLessThan(rank(deck, 'tv-11'));
    expect(deck.find((c) => c.itemId === 'tv-10')!.reasons[0]).toMatch(/^Like Fav (One and Fav Two|Two and Fav One)$/);
    expect(deck.find((c) => c.itemId === 'tv-11')!.reasons[0]).toBe('Because you love Fav One');
  });
  it('being on a favourite\'s "people also like" list lifts a title even with nothing else in common', () => {
    expect(rank(deck, 'tv-13')).toBeLessThan(rank(deck, 'tv-12'));
  });
  it('...but that link alone is too noisy to SAY: the favourite is only named when something visible is shared', () => {
    // tv-13 is on Fav One's "people also like" list but shares no theme and no genre with it.
    const linkOnly = deck.find((c) => c.itemId === 'tv-13')!;
    expect(linkOnly.reasons.join(' | ')).not.toMatch(/Fav One|Fav Two|Fav Three/);
    // Add shared themes and genre to the very same link and the favourite is named.
    const backed = title(14, { ...base, keywords: ['workplace comedy', 'hospital', 'zebra'] });
    const fav1 = { ...fav, related: ['tv-13', 'tv-14'] };
    const cat = madeUp([fav1, fav2, fav3, related, backed, likeNone, ...padding], { HG: [fav1, fav2, fav3], BG: [fav3] });
    const d = engine.buildDeck(req({ who: 'HG', mood: 'laugh', novelty: 'new' }), makeCtx({ catalog: cat }), { limit: 100 });
    expect(d.find((c) => c.itemId === 'tv-14')!.reasons[0]).toBe('Because you love Fav One');
    expect(d.find((c) => c.itemId === 'tv-13')!.reasons.join(' | ')).not.toMatch(/Fav/);
    // One loosely shared theme across different genres is not enough either
    // (the real-catalog cases: Scream Queens <- Scrubs via "hospital", Black Mirror <- The Simpsons via "satire").
    const loose = title(15, { ...base, genres: ['mystery'], keywords: ['hospital', 'slasher', 'college', 'mascot'] });
    const fav1b = { ...fav, related: ['tv-15'] };
    const cat2 = madeUp([fav1b, fav2, fav3, loose, likeNone, ...padding], { HG: [fav1b, fav2, fav3], BG: [fav3] });
    const d2 = engine.buildDeck(req({ who: 'HG', mood: 'laugh', novelty: 'new' }), makeCtx({ catalog: cat2 }), { limit: 100 });
    expect(d2.find((c) => c.itemId === 'tv-15')!.reasons.join(' | ')).not.toMatch(/Fav/);
  });
  it('Together reasons follow the same rule', () => {
    const cat = madeUp([fav1WithRelated, fav2, fav3, related, likeBoth, ...padding], { HG: [fav1WithRelated, fav2], BG: [fav1WithRelated, fav3] });
    const d = engine.buildDeck(req({ who: 'Together', mood: 'laugh', novelty: 'new' }), makeCtx({ catalog: cat }), { limit: 100 });
    expect(d.find((c) => c.itemId === 'tv-13')!.reasons.join(' | ')).not.toMatch(/Fav/);
    expect(d.find((c) => c.itemId === 'tv-10')!.reasons.join(' | ')).toMatch(/Fav One/);
  });
  it('favourites that are not in the catalog still shape taste (sample catalog: The Devil\'s Plan -> The Traitors)', () => {
    const d = engine.buildDeck(req({ who: 'HG', mood: 'gripped', time: 60, novelty: 'new' }), makeCtx(), { limit: 100 });
    const traitors = d.find((c) => c.itemId === 'tv-205715')!;
    expect(traitors.reasons.join(' | ')).toContain("The Devil's Plan");
    expect(rank(d, 'tv-205715')).toBeLessThan(5);
  });
  it('quality counts, with few-vote ratings trusted less', () => {
    const a = title(1, { rating: 8.6, votes: 5000 });
    const b = title(2, { rating: 6.2, votes: 5000 });
    const c = title(3, { rating: 9.8, votes: 3 }); // three votes: not to be believed
    const d = engine.buildDeck(req({ who: 'HG', mood: 'gripped' }), makeCtx({ catalog: madeUp([b, c, a], { HG: [], BG: [] }) }));
    expect(rank(d, 'tv-1')).toBe(0);
    expect(rank(d, 'tv-1')).toBeLessThan(rank(d, 'tv-3'));
    expect(rank(d, 'tv-1')).toBeLessThan(rank(d, 'tv-2'));
  });
  it('it is not just a popularity chart: a well-matched modest title beats a mismatched blockbuster', () => {
    const hit = title(20, { ...base, genres: ['family'], keywords: ['dog'], popularity: 5000, votes: 30000, rating: 7.8 });
    const fit = title(21, { ...base, keywords: ['sitcom', 'workplace comedy', 'hospital', 'friendship'], popularity: 5, votes: 300, rating: 7.6 });
    const cat = madeUp([fav, fav2, hit, fit, ...padding], { HG: [fav, fav2], BG: [] });
    const d = engine.buildDeck(req({ who: 'HG', mood: 'laugh', novelty: 'new' }), makeCtx({ catalog: cat }), { limit: 100 });
    expect(rank(d, 'tv-21')).toBeLessThan(rank(d, 'tv-20'));
  });
  it('anime and kids\' shows are held back for someone whose favourites include none', () => {
    const plain = title(30, { keywords: ['detective'], rating: 8.0 });
    const anime = title(31, { keywords: ['detective', 'anime'], rating: 8.4 });
    const kids = title(32, { keywords: ['detective'], genres: ['drama', 'kids'], rating: 8.4 });
    const animeFav = title(33, { title: 'Anime Fav', keywords: ['based on manga', 'ninja'] });
    const fresh = makeCtx({ catalog: madeUp([plain, anime, kids], { HG: [fav3], BG: [animeFav] }) });
    const hg = engine.buildDeck(req({ who: 'HG', mood: 'gripped' }), fresh);
    // Despite their higher ratings, the anime and the kids' show rank below the plain drama for HG.
    expect(ids(hg)[0]).toBe('tv-30');
    // BG has an anime favourite, so anime competes on its merits for her.
    const bg = engine.buildDeck(req({ who: 'BG', mood: 'gripped' }), fresh);
    expect(rank(bg, 'tv-31')).toBe(0);
  });
});

describe('resemblance cannot carry a badly rated or unproven title to the top', () => {
  const favs = [1, 2, 3].map((k) => title(k, { title: `Dating Fav ${k}`, genres: ['reality'], keywords: ['dating show', 'villa', 'summer'], moods: { brainoff: 0.9 } }));
  const clone = (id: number, over: Partial<CatalogItem>) => title(id, { genres: ['reality'], keywords: ['dating show', 'villa', 'summer'], moods: { brainoff: 0.9 }, ...over });
  const good = clone(10, { rating: 7.6, votes: 900 });
  const poor = clone(11, { rating: 5.2, votes: 900 }); // identical, but people who watched it didn't like it
  const unproven = clone(12, { rating: 8.4, votes: 12 }); // identical, glowing rating from a dozen people
  const halfMatch = title(13, { genres: ['reality'], keywords: ['dating show', 'cooking'], moods: { brainoff: 0.9 }, rating: 7.6, votes: 900 });
  const noMatch = title(14, { genres: ['history'], keywords: ['archive'], moods: { brainoff: 0.9 }, rating: 7.6, votes: 900 });
  const poorNoMatch = title(15, { genres: ['history'], keywords: ['archive'], moods: { brainoff: 0.9 }, rating: 5.2, votes: 900 });
  const filler = Array.from({ length: 10 }, (_, k) => title(100 + k, { genres: ['music'], keywords: [`f${k}`], moods: { brainoff: 0.9 }, rating: 7.4, votes: 900 }));
  const catalog = madeUp([...favs, poor, unproven, halfMatch, noMatch, poorNoMatch, good, ...filler], { HG: favs, BG: favs });
  const ctx = makeCtx({ catalog });
  const deck = engine.buildDeck(req({ who: 'BG', mood: 'brainoff', novelty: 'new' }), ctx, { limit: 100 });

  it('of two equally close matches, the well-rated one wins clearly', () => {
    expect(rank(deck, 'tv-10')).toBe(0);
    expect(rank(deck, 'tv-11')).toBeGreaterThan(rank(deck, 'tv-10') + 1);
  });
  it('a perfect match with a poor rating ranks below a partial match with a good one', () => {
    expect(rank(deck, 'tv-13')).toBeLessThan(rank(deck, 'tv-11'));
  });
  it('a glowing rating from a handful of voters is not trusted: the proven title ranks above it', () => {
    expect(rank(deck, 'tv-10')).toBeLessThan(rank(deck, 'tv-12'));
    const score = (id: string) => deck.find((c) => c.itemId === id)!.score;
    expect(score('tv-12')).toBeLessThan(score('tv-10') - 0.05);
  });
  it('resemblance still counts between equals: of two poorly rated titles, the close match ranks higher', () => {
    expect(rank(deck, 'tv-11')).toBeLessThan(rank(deck, 'tv-15'));
  });
  it("a person's own favourite is never marked down for its rating", () => {
    const lowFav = title(1, { title: 'Guilty Pleasure', genres: ['reality'], keywords: ['dating show'], moods: { brainoff: 0.9 }, rating: 5.0, votes: 20, attention: 'low', dropIn: true });
    const cat = madeUp([lowFav, good, ...filler], { HG: [], BG: [lowFav] });
    const d = engine.buildDeck(req({ who: 'BG', mood: 'brainoff', novelty: 'rewatch' }), makeCtx({ catalog: cat }));
    expect(d[0].itemId).toBe('tv-1');
    expect(d[0].reasons[0]).toBe('One of your favourites');
  });
});

describe('one favourite does not speak for the whole person', () => {
  // Ten favourites: nine dramas about lawyers and scandals, and ONE animated sitcom.
  const dramas = Array.from({ length: 9 }, (_, k) => title(k + 1, { title: `Drama Fav ${k + 1}`, genres: ['drama'], keywords: ['lawyer', 'scandal', `d${k}`], moods: { cozy: 0.8 } }));
  const cartoonFav = title(20, { title: 'Cartoon Fav', genres: ['animation', 'comedy'], keywords: ['adult animation', 'cutaway gags', 'talking dog'], runtime: 22, dropIn: true, attention: 'low', moods: { cozy: 0.8 } });
  const moreCartoons = [21, 22, 23].map((k) => title(k, { title: `Cartoon Fav ${k}`, genres: ['animation', 'comedy'], keywords: ['adult animation', 'cutaway gags', `c${k}`], runtime: 22, dropIn: true, attention: 'low', moods: { cozy: 0.8 } }));
  // Candidates: a near-clone of the cartoon, and a drama that shares one theme with the dramas.
  const cartoonClone = title(30, { genres: ['animation', 'comedy'], keywords: ['adult animation', 'cutaway gags', 'talking dog'], runtime: 22, dropIn: true, attention: 'low', moods: { cozy: 0.8 } });
  const dramaLike = title(31, { genres: ['drama'], keywords: ['lawyer', 'scandal'], moods: { cozy: 0.8 } });
  const filler = Array.from({ length: 10 }, (_, k) => title(100 + k, { genres: ['history'], keywords: [`f${k}`], moods: { cozy: 0.8 }, rating: 7.2 }));
  const otherCartoon = title(32, { genres: ['animation', 'comedy'], keywords: ['space pirates', 'robot butler', 'moon base'], runtime: 22, dropIn: true, attention: 'low', moods: { cozy: 0.8 } });
  const items = [...dramas, cartoonFav, ...moreCartoons, cartoonClone, otherCartoon, dramaLike, ...filler];
  // "Mostly dramas" has one cartoon favourite; "cartoon fan" has four.
  const catalog = madeUp(items, { BG: [...dramas, cartoonFav], HG: [cartoonFav, ...moreCartoons, ...dramas.slice(0, 2)] });
  const ctx = makeCtx({ catalog });
  const r = req({ mood: 'cozy', novelty: 'new' });

  it('with one cartoon among ten favourites, a clone of that cartoon does not outrank what the other nine point to', () => {
    const deck = engine.buildDeck({ ...r, who: 'BG' }, ctx, { limit: 100 });
    expect(rank(deck, 'tv-31')).toBe(0);
    expect(rank(deck, 'tv-31')).toBeLessThan(rank(deck, 'tv-30'));
  });
  it('for someone with four cartoon favourites the same clone comes first', () => {
    const deck = engine.buildDeck({ ...r, who: 'HG' }, ctx, { limit: 100 });
    expect(rank(deck, 'tv-30')).toBe(0);
    expect(rank(deck, 'tv-30')).toBeLessThan(rank(deck, 'tv-31'));
  });
  it('the lone favourite still counts for something: its clone beats an otherwise identical cartoon with nothing in common', () => {
    const deck = engine.buildDeck({ ...r, who: 'BG' }, ctx, { limit: 100 });
    expect(rank(deck, 'tv-30')).toBeLessThan(rank(deck, 'tv-32'));
  });
  it('the same clone scores lower for the one-cartoon person than for the cartoon fan', () => {
    const score = (who: 'HG' | 'BG') => engine.buildDeck({ ...r, who }, ctx, { limit: 100 }).find((c) => c.itemId === 'tv-30')!.score;
    expect(score('BG')).toBeLessThan(score('HG') - 0.1);
  });
  it('on the real favourites: BG (one animated favourite of 22) gets less adult animation than HG (four of 14)', () => {
    const real = makeCtx();
    const animated = (who: 'HG' | 'BG') =>
      engine
        .buildDeck(req({ who, mood: 'laugh', viewing: 'background', time: 20, novelty: 'either' }), real, { limit: 6 })
        .filter((c) => real.catalog.items.find((i) => i.id === c.itemId)!.genres.includes('animation')).length;
    expect(animated('BG')).toBeLessThan(animated('HG'));
    // Bob's Burgers (animated) vs Parks and Recreation (live-action sitcom): BG's sitcom favourites should win out.
    const bg = engine.buildDeck(req({ who: 'BG', mood: 'laugh', viewing: 'background', time: 20, novelty: 'new' }), real, { limit: 100 });
    expect(rank(bg, 'tv-8592')).toBeLessThan(rank(bg, 'tv-32726'));
  });
});

describe('genre craving', () => {
  it('every title with the craved genre comes before any title without it', () => {
    for (const { who, genre, mood } of [
      { who: 'HG', genre: 'animation', mood: 'laugh' },
      { who: 'Together', genre: 'romance', mood: 'cozy' },
      { who: 'BG', genre: 'reality', mood: 'brainoff' },
      { who: 'HG', genre: 'scifi', mood: 'gripped' },
    ] as const) {
      const deck = engine.buildDeck(req({ who, genre, mood }), makeCtx(), { limit: 100, seed: 2 });
      const has = deck.map((c) => item(c.itemId).genres.includes(genre));
      expect(has[0], `${who} ${genre}`).toBe(true);
      const firstWithout = has.indexOf(false);
      if (firstWithout >= 0) expect(has.slice(firstWithout).includes(true)).toBe(false);
    }
  });
  it('the craving changes the deck and is given as a reason', () => {
    const ctx = makeCtx();
    const without = engine.buildDeck(req({ who: 'HG', mood: 'laugh', time: 120 }), ctx);
    const withCraving = engine.buildDeck(req({ who: 'HG', mood: 'laugh', time: 120, genre: 'animation' }), ctx);
    expect(ids(withCraving)).not.toEqual(ids(without));
    expect(withCraving[0].reasons).toContain('Animation, like you asked');
  });
  it('with a big catalog a craving deck is entirely that genre', () => {
    const ctx = makeCtx({ catalog: syntheticCatalog(800) });
    const deck = engine.buildDeck(req({ who: 'Together', mood: 'laugh', genre: 'animation' }), ctx);
    expect(deck).toHaveLength(30);
    for (const c of deck) expect(ctx.catalog.items.find((i) => i.id === c.itemId)!.genres).toContain('animation');
  });
});

describe('Together: the pick has to suit both', () => {
  const hgFavs = [1, 2, 3].map((k) => title(k, { title: `HG Fav ${k}`, genres: ['western'], keywords: ['gunslinger', 'frontier', 'outlaw'] }));
  const bgFavs = [4, 5, 6].map((k) => title(k, { title: `BG Fav ${k}`, genres: ['music'], keywords: ['ballet', 'dance', 'audition'] }));
  const hgOnly = title(10, { genres: ['western'], keywords: ['gunslinger', 'frontier', 'outlaw'] }); // HG would love it, nothing for BG
  const bgOnly = title(11, { genres: ['music'], keywords: ['ballet', 'dance', 'audition'] });
  const both = title(12, { genres: ['western', 'music'], keywords: ['gunslinger', 'frontier', 'dance', 'ballet'] }); // decent for each
  const neither = title(13, { genres: ['history'], keywords: ['archive'] });
  const catalog = madeUp([hgOnly, bgOnly, both, neither], { HG: hgFavs, BG: bgFavs });
  const ctx = makeCtx({ catalog });
  const r = req({ mood: 'gripped' });

  it('alone, each person gets their own favourite kind of thing first', () => {
    expect(ids(engine.buildDeck({ ...r, who: 'HG' }, ctx))[0]).toBe('tv-10');
    expect(ids(engine.buildDeck({ ...r, who: 'BG' }, ctx))[0]).toBe('tv-11');
  });
  it('together, the title that works for both beats the ones only one of them would love', () => {
    const deck = engine.buildDeck({ ...r, who: 'Together' }, ctx);
    expect(ids(deck)[0]).toBe('tv-12');
    expect(rank(deck, 'tv-12')).toBeLessThan(rank(deck, 'tv-10'));
    expect(rank(deck, 'tv-12')).toBeLessThan(rank(deck, 'tv-11'));
  });
  it('the blend leans on the less keen person, not the average', () => {
    // Give BG a strong dislike of westerns: HG's favourite kind must now sink below even the neutral title.
    const soured = makeCtx({ catalog });
    soured.state.profiles.BG = engine.correctTaste(soured.state.profiles.BG, 'genre:western', 'less');
    const deck = engine.buildDeck({ ...r, who: 'Together' }, soured);
    expect(rank(deck, 'tv-10')).toBeGreaterThan(rank(deck, 'tv-13'));
    // ...while HG alone is unaffected by BG's dislike.
    expect(ids(engine.buildDeck({ ...r, who: 'HG' }, soured))[0]).toBe('tv-10');
  });
  it('Together reasons say whose favourite a title resembles', () => {
    const deck = engine.buildDeck({ ...r, who: 'Together' }, ctx);
    const reasons = deck.find((c) => c.itemId === 'tv-12')!.reasons.join(' | ');
    expect(reasons).toMatch(/Because HG loves HG Fav/);
    expect(reasons).toMatch(/Because BG loves BG Fav/);
    const shared = engine.buildDeck(req({ who: 'Together', mood: 'laugh', novelty: 'new' }), makeCtx(), { limit: 100 });
    expect(shared.find((c) => c.itemId === 'tv-32726')!.reasons[0]).toBe('Because you both love Family Guy'); // Bob's Burgers
  });
});

describe('new vs seen under "either"', () => {
  it('in a non-comfort mood, new titles lead and things already seen are marked down', () => {
    const deck = engine.buildDeck(req({ who: 'HG', mood: 'gripped', novelty: 'either' }), makeCtx(), { limit: 100 });
    const ctx = makeCtx();
    expect(engine.hasSeen('HG', deck[0].itemId, ctx)).toBe(false);
    const seenInTop = deck.slice(0, 9).filter((c) => engine.hasSeen('HG', c.itemId, ctx)).length;
    expect(seenInTop).toBeLessThanOrEqual(3);
  });
  it('in a comfort mood, favourites are welcome near the top but do not fill the deck', () => {
    const ctx = makeCtx();
    const deck = engine.buildDeck(req({ who: 'HG', mood: 'cozy', viewing: 'background', time: 20, novelty: 'either' }), ctx);
    const top = deck.slice(0, 10);
    const seen = top.filter((c) => engine.hasSeen('HG', c.itemId, ctx)).length;
    expect(seen).toBeGreaterThanOrEqual(1);
    expect(seen).toBeLessThanOrEqual(6);
  });
  it('a seen title ranks lower under "either" than the same title unseen', () => {
    const id = 'tv-76331'; // Succession
    const unseen = engine.buildDeck(req({ who: 'HG', mood: 'gripped' }), makeCtx(), { limit: 100 });
    const seen = engine.buildDeck(req({ who: 'HG', mood: 'gripped' }), makeCtx({ seen: { HG: [id] } }), { limit: 100 });
    expect(rank(seen, id)).toBeGreaterThan(rank(unseen, id));
  });
  it('for a rewatch, favourites come first', () => {
    const ctx = makeCtx({ seen: { HG: ['tv-8592', 'tv-48891', 'tv-125935'] } });
    const deck = engine.buildDeck(req({ who: 'HG', mood: 'laugh', novelty: 'rewatch', time: 20 }), ctx);
    expect(ctx.state.profiles.HG.favorites).toContain(deck[0].itemId);
    expect(ctx.state.profiles.HG.favorites).toContain(deck[1].itemId);
  });
});

describe('time and viewing fit', () => {
  it('with 2+ hours, a film beats an otherwise identical 22-minute sitcom; with 20 minutes only the sitcom fits', () => {
    const film = title(1, { id: 'movie-1', kind: 'movie', runtime: 105, genres: ['comedy'], keywords: ['wedding'], moods: { laugh: 0.9 }, attention: 'low', seasons: undefined });
    const sitcom = title(2, { runtime: 22, genres: ['comedy'], keywords: ['wedding'], moods: { laugh: 0.9 }, attention: 'low', dropIn: true });
    const ctx = makeCtx({ catalog: madeUp([sitcom, film], { HG: [], BG: [] }) });
    expect(ids(engine.buildDeck(req({ who: 'HG', time: 120 }), ctx))).toEqual(['movie-1', 'tv-2']);
    expect(ids(engine.buildDeck(req({ who: 'HG', time: 20 }), ctx))).toEqual(['tv-2']);
  });
  it('with an hour, an hour-long episode beats an otherwise identical 22-minute one', () => {
    const long = title(1, { runtime: 55 });
    const short = title(2, { runtime: 22 });
    const ctx = makeCtx({ catalog: madeUp([short, long], { HG: [], BG: [] }) });
    expect(ids(engine.buildDeck(req({ who: 'HG', mood: 'gripped', time: 60 }), ctx))).toEqual(['tv-1', 'tv-2']);
  });
  it('for background viewing a drop-in show beats an otherwise identical one you must follow in order', () => {
    const drop = title(1, { attention: 'low', dropIn: true });
    const serial = title(2, { attention: 'low', dropIn: false });
    const ctx = makeCtx({ catalog: madeUp([serial, drop], { HG: [], BG: [] }) });
    const deck = engine.buildDeck(req({ who: 'HG', mood: 'gripped', viewing: 'background' }), ctx);
    expect(ids(deck)).toEqual(['tv-1', 'tv-2']);
    expect(deck[0].reasons).toContain('Easy to drop into');
  });
});

describe('variety', () => {
  it('a deck is not ten near-identical titles in a row when good alternatives exist', () => {
    // 12 near-identical westerns that score a little higher, 6 slightly lower titles of other kinds.
    const clones = Array.from({ length: 12 }, (_, k) => title(k + 1, { genres: ['western'], keywords: ['outlaw'], rating: 7.9, related: ['tv-1'] }));
    const others = (['music', 'history', 'war', 'documentary', 'fantasy', 'romance'] as const).map((g, k) =>
      title(50 + k, { genres: [g], keywords: [`k${k}`], rating: 7.7, providers: [337] }),
    );
    const ctx = makeCtx({ catalog: madeUp([...clones, ...others], { HG: [], BG: [] }) });
    const deck = engine.buildDeck(req({ who: 'HG', mood: 'gripped' }), ctx);
    const firstTen = deck.slice(0, 10).map((c) => ctx.catalog.items.find((i) => i.id === c.itemId)!.genres[0]);
    expect(new Set(firstTen).size).toBeGreaterThanOrEqual(4);
    expect(firstTen[0]).toBe('western'); // the best title still leads
  });
});

describe('the New feed (rankNewArrivals)', () => {
  it('keeps arrivals that are in the catalog and on our plans, with the arrival attached', () => {
    const cards = engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'HG', makeCtx());
    expect(cards.map((c) => c.itemId).sort()).toEqual(['movie-346648', 'movie-419430', 'movie-661374', 'tv-125935', 'tv-136315', 'tv-205715'].sort());
    for (const c of cards) expect(c.arrival.itemId).toBe(c.itemId);
    for (let k = 1; k < cards.length; k++) expect(cards[k].score).toBeLessThanOrEqual(cards[k - 1].score);
  });
  it('ignores arrivals that are not in the catalog', () => {
    const arrivals = { ...FIXTURE_NEW_ARRIVALS, entries: [{ itemId: 'tv-999999', type: 'title' as const, providers: [8], date: '2026-10-09' }, ...FIXTURE_NEW_ARRIVALS.entries] };
    expect(engine.rankNewArrivals(arrivals, 'HG', makeCtx()).map((c) => c.itemId)).not.toContain('tv-999999');
  });
  it('drops a title a watcher has already seen, unless it is a new season', () => {
    const ctx = makeCtx({ seen: { HG: ['movie-661374', 'tv-125935'] } });
    const hg = engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'HG', ctx).map((c) => c.itemId);
    expect(hg).not.toContain('movie-661374'); // a film he has seen
    expect(hg).toContain('tv-125935'); // new season of a show he watches
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'Together', ctx).map((c) => c.itemId)).not.toContain('movie-661374');
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'BG', ctx).map((c) => c.itemId)).toContain('movie-661374');
    // The Traitors is a BG favourite (so seen); its new season stays in her feed.
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'BG', ctx).map((c) => c.itemId)).toContain('tv-205715');
  });
  it('ranks by taste: a new season of a favourite tops the feed', () => {
    expect(engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'BG', makeCtx())[0].itemId).toBe('tv-205715');
  });
  it('uses the same "what to watch" logic with no time limit, and does not point a new season at an old episode', () => {
    const cards = engine.rankNewArrivals(FIXTURE_NEW_ARRIVALS, 'HG', makeCtx());
    expect(cards.find((c) => c.itemId === 'movie-346648')!.pick).toEqual({ type: 'movie' });
    expect(cards.find((c) => c.itemId === 'tv-125935')!.pick).toEqual({ type: 'any-episode' });
    expect(cards.find((c) => c.itemId === 'tv-136315')!.pick).toEqual({ type: 'series-start' });
    expect(cards.find((c) => c.itemId === 'movie-661374')!.service.adFree).toBe(true);
  });
});

describe('the first-run grid (onboardingTitles)', () => {
  it('returns the requested number of distinct, on-plan titles, the same every time', () => {
    const a = engine.onboardingTitles(FIXTURE_CATALOG, DEFAULT_PLANS, 20);
    expect(a).toHaveLength(20);
    expect(new Set(a.map((i) => i.id)).size).toBe(20);
    for (const i of a) expect(engine.chooseService(i, DEFAULT_PLANS)).not.toBeNull();
    expect(engine.onboardingTitles(FIXTURE_CATALOG, DEFAULT_PLANS, 20).map((i) => i.id)).toEqual(a.map((i) => i.id));
  });
  it('leads with widely-known titles and mixes films with series and several genres', () => {
    const a = engine.onboardingTitles(FIXTURE_CATALOG, DEFAULT_PLANS, 16);
    expect(a.slice(0, 6).map((i) => i.title)).toContain('Game of Thrones');
    expect(a.some((i) => i.kind === 'movie')).toBe(true);
    expect(a.some((i) => i.kind === 'tv')).toBe(true);
    expect(new Set(a.map((i) => i.genres[0])).size).toBeGreaterThanOrEqual(5);
  });
  it('does not leave titles out for dealbreakers — it only asks "have you seen this?"', () => {
    const all = engine.onboardingTitles(FIXTURE_CATALOG, DEFAULT_PLANS, 500);
    expect(all.map((i) => i.id)).toContain('movie-419430'); // Get Out
    expect(all).toHaveLength(FIXTURE_CATALOG.items.filter((i) => engine.chooseService(i, DEFAULT_PLANS)).length);
  });
});

describe('speed on a phone-sized catalog (about 3,000 titles)', () => {
  it('builds a deck in well under 100 ms once warm, for every audience', () => {
    const catalog = syntheticCatalog(3000);
    expect(catalog.items).toHaveLength(3000);
    const ctx = makeCtx({ catalog, seen: { HG: catalog.items.slice(100, 400).map((i) => i.id), BG: catalog.items.slice(300, 700).map((i) => i.id) } });
    const requests = [
      req({ who: 'HG', mood: 'laugh', viewing: 'background', time: 20 }),
      req({ who: 'BG', mood: 'gripped', time: 60, novelty: 'new' }),
      req({ who: 'Together', mood: 'cozy', viewing: 'eating', time: 45 }),
      req({ who: 'Together', mood: 'hyped', genre: 'action', novelty: 'new' }),
    ];
    const cold0 = performance.now();
    engine.buildDeck(requests[2], ctx);
    const cold = performance.now() - cold0;
    let worst = 0;
    let total = 0;
    let n = 0;
    for (let round = 0; round < 5; round++) {
      for (const r of requests) {
        const t0 = performance.now();
        const deck = engine.buildDeck(r, ctx, { seed: round });
        const ms = performance.now() - t0;
        expect(deck.length).toBe(30);
        worst = Math.max(worst, ms);
        total += ms;
        n++;
      }
    }
    // Generous ceilings so a busy test machine doesn't cause false alarms; typical figures are far lower.
    expect(total / n).toBeLessThan(60);
    expect(worst).toBeLessThan(150);
    expect(cold).toBeLessThan(1000);
  });

  it('a swipe (which changes the learned weights) does not force the expensive part to be redone', () => {
    const catalog = syntheticCatalog(3000);
    const ctx = makeCtx({ catalog });
    engine.buildDeck(req({ who: 'HG' }), ctx);
    ctx.state.profiles.HG = engine.learnFromSwipe(ctx.state.profiles.HG, catalog.items[5], 'yes', catalog);
    const t0 = performance.now();
    engine.buildDeck(req({ who: 'HG' }), ctx);
    expect(performance.now() - t0).toBeLessThan(150);
  });
});
