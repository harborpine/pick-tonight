/**
 * Profiles, learning from swipes, the plain-language taste page, and manual corrections.
 */
import { describe, expect, it } from 'vitest';
import { NO_DEALBREAKERS, type DeckCard, type Profile, type SwipeAction } from '../contracts';
import { FIXTURE_CATALOG } from '../contracts/fixtures/catalog';
import { createEngine } from './index';
import { ALEX, blankProfile, itemsById, makeCtx, req, SAM, sampleProfile, syntheticCatalog } from './testkit';

const engine = createEngine();
const C = FIXTURE_CATALOG;
const byId = itemsById(C);
const item = (id: string) => byId.get(id)!;
const rank = (deck: DeckCard[], id: string) => {
  const k = deck.findIndex((c) => c.itemId === id);
  return k < 0 ? Number.POSITIVE_INFINITY : k;
};
const swipe = (p: Profile, id: string, action: SwipeAction, times = 1) => {
  for (let k = 0; k < times; k++) p = engine.learnFromSwipe(p, item(id), action, C);
  return p;
};

const PLANET_EARTH = 'tv-68595'; // documentary, nature
const BAKE_OFF = 'tv-87012'; // reality
const LOVE_ISLAND = 'tv-91768'; // reality + romance
const BRIDGERTON = 'tv-91239'; // period drama, romance
const NORMAL_PEOPLE = 'tv-89905';

// REWRITTEN for the public version: profiles used to start with a fixed person's seeded
// favourites and dealbreakers; everyone now starts from the same empty profile.
describe('emptyProfile', () => {
  it('starts everyone with nothing: no favourites, no never-show-me choices, no learned taste, not onboarded', () => {
    expect(engine.emptyProfile()).toEqual({
      favorites: [],
      dealbreakers: { horror: false, trueCrime: false, scary: false, genres: [], subtitled: false },
      taste: { genres: {}, keywords: {}, traits: {}, corrections: {} },
      onboarded: false,
    });
    expect(engine.emptyProfile()).not.toHaveProperty('id');
  });
  it('returns a fresh copy each time (editing one profile cannot affect another, or the shared defaults)', () => {
    const a = engine.emptyProfile();
    a.favorites.push(sampleProfile('alex').favorites[0]);
    a.taste.genres.comedy = 1;
    a.dealbreakers.genres.push('reality');
    a.dealbreakers.horror = true;
    const b = engine.emptyProfile();
    expect(b.favorites).toEqual([]);
    expect(b.taste.genres).toEqual({});
    expect(b.dealbreakers).toEqual(NO_DEALBREAKERS);
    expect(NO_DEALBREAKERS.genres).toEqual([]);
  });
  it('nothing about any particular person is built in: two new members get identical profiles', () => {
    expect(blankProfile('m1')).toEqual({ ...blankProfile('m2'), id: 'm1' });
  });
});

describe('learnFromSwipe', () => {
  const base = sampleProfile('alex');

  it('returns an updated copy and never changes the profile it was given', () => {
    const frozen = JSON.stringify(base);
    const next = engine.learnFromSwipe(base, item(PLANET_EARTH), 'yes', C);
    expect(JSON.stringify(base)).toBe(frozen);
    expect(next).not.toBe(base);
    expect(next.taste).not.toBe(base.taste);
    expect(next.favorites).toEqual(base.favorites);
    expect(next.dealbreakers).toEqual(base.dealbreakers);
    expect(next.id).toBe('alex');
  });

  it('yes and save are positive; never is strongly negative; not-tonight is almost nothing; seen is slightly positive', () => {
    const w = (a: SwipeAction) => engine.learnFromSwipe(base, item(PLANET_EARTH), a, C).taste.genres.documentary ?? 0;
    expect(w('yes')).toBeGreaterThan(0.04);
    expect(w('save')).toBeGreaterThan(0.03);
    expect(w('save')).toBeLessThanOrEqual(w('yes'));
    expect(w('seen')).toBeGreaterThan(0);
    expect(w('seen')).toBeLessThan(w('save') / 2);
    expect(w('never')).toBeLessThan(-0.15);
    expect(Math.abs(w('not-tonight'))).toBeLessThan(0.015);
    expect(w('not-tonight')).toBeLessThanOrEqual(0);
    expect(Math.abs(w('never'))).toBeGreaterThan(w('yes') * 2);
  });

  it('updates genre, keyword and trait weights', () => {
    const t = engine.learnFromSwipe(base, item(PLANET_EARTH), 'yes', C).taste;
    expect(t.genres.documentary).toBeGreaterThan(0);
    expect(t.keywords.nature).toBeGreaterThan(0);
    expect(t.keywords.wildlife).toBeGreaterThan(0);
    expect(t.traits.dropIn).toBeGreaterThan(0);
    expect(t.traits['kind:tv']).toBeGreaterThan(0);
  });

  it('one swipe never dominates: shifts are small and build gradually', () => {
    const one = swipe(base, PLANET_EARTH, 'yes').taste.genres.documentary!;
    const five = swipe(base, PLANET_EARTH, 'yes', 5).taste.genres.documentary!;
    const thirty = swipe(base, PLANET_EARTH, 'yes', 30).taste.genres.documentary!;
    expect(one).toBeLessThan(0.1);
    expect(five).toBeGreaterThan(one * 3);
    expect(thirty).toBeGreaterThan(five);
    // One "yes" barely moves a deck; it takes a run of them.
    const before = engine.buildDeck(req({ who: ALEX, mood: 'think', time: 60 }), makeCtx(), { limit: 100 });
    const ctx = makeCtx();
    ctx.state.profiles.alex = swipe(base, PLANET_EARTH, 'yes');
    const after = engine.buildDeck(req({ who: ALEX, mood: 'think', time: 60 }), ctx, { limit: 100 });
    expect(Math.abs(rank(after, PLANET_EARTH) - rank(before, PLANET_EARTH))).toBeLessThanOrEqual(1);
  });

  it('weights always stay within -1..1, however many swipes', () => {
    let p = swipe(base, PLANET_EARTH, 'yes', 300);
    p = swipe(p, BRIDGERTON, 'never', 300);
    for (const group of [p.taste.genres, p.taste.keywords, p.taste.traits]) {
      for (const v of Object.values(group)) {
        expect(v as number).toBeGreaterThanOrEqual(-1);
        expect(v as number).toBeLessThanOrEqual(1);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(p.taste.genres.documentary).toBeGreaterThan(0.3); // faded a little by the 300 later swipes, not erased
    expect(p.taste.keywords['period drama']).toBeLessThan(-0.5);
  });

  it('old opinions fade slowly as new swipes arrive', () => {
    const liked = swipe(base, PLANET_EARTH, 'yes', 10);
    const later = swipe(liked, 'tv-2316', 'yes', 40); // 40 swipes on something unrelated
    expect(later.taste.genres.documentary).toBeLessThan(liked.taste.genres.documentary!);
    expect(later.taste.genres.documentary).toBeGreaterThan(0);
  });

  it('repeated yeses lift similar titles in the deck; repeated nevers sink them', () => {
    const r = req({ who: SAM, mood: 'romantic', novelty: 'new' });
    const before = engine.buildDeck(r, makeCtx(), { limit: 100 });
    expect(rank(before, BRIDGERTON)).toBeLessThan(rank(before, 'movie-11036')); // Bridgerton starts above The Notebook

    const sour = makeCtx();
    sour.state.profiles.sam = swipe(sour.state.profiles.sam, NORMAL_PEOPLE, 'never', 4); // romance dramas "based on novel"
    const after = engine.buildDeck(r, sour, { limit: 100 });
    const scoreOf = (deck: DeckCard[], id: string) => deck.find((c) => c.itemId === id)!.score;
    expect(scoreOf(after, BRIDGERTON)).toBeLessThan(scoreOf(before, BRIDGERTON) - 0.03);

    const keen = makeCtx();
    keen.state.profiles.alex = swipe(keen.state.profiles.alex, PLANET_EARTH, 'yes', 12);
    const think = req({ who: ALEX, mood: 'think', time: 60, novelty: 'either' });
    expect(rank(engine.buildDeck(think, keen, { limit: 100 }), PLANET_EARTH)).toBeLessThan(rank(engine.buildDeck(think, makeCtx(), { limit: 100 }), PLANET_EARTH));
  });

  it('"not tonight" does not change the deck order (it is about tonight, not taste)', () => {
    const r = req({ who: ALEX, mood: 'laugh', novelty: 'new' });
    const before = engine.buildDeck(r, makeCtx(), { limit: 100 }).map((c) => c.itemId);
    const ctx = makeCtx();
    ctx.state.profiles.alex = swipe(ctx.state.profiles.alex, 'tv-8592', 'not-tonight', 2);
    expect(engine.buildDeck(r, ctx, { limit: 100 }).map((c) => c.itemId)).toEqual(before);
  });

  it('a dislike counts for less against something the favourites are full of', () => {
    // Alex's favourites are mostly comedies; one rejected comedy shouldn't shake that much.
    const comedy = engine.learnFromSwipe(base, item('movie-8363'), 'never', C).taste.genres.comedy!; // Superbad
    const western = engine.learnFromSwipe(base, item('tv-73586'), 'never', C).taste.genres.western!; // Yellowstone
    expect(comedy).toBeLessThan(0);
    expect(Math.abs(comedy)).toBeLessThan(Math.abs(western) * 0.75);
  });

  it('manual corrections are never overwritten by learning', () => {
    let p = engine.correctTaste(base, 'genre:documentary', 'less');
    p = engine.correctTaste(p, 'keyword:nature', 'more');
    p = swipe(p, PLANET_EARTH, 'yes', 25);
    p = swipe(p, PLANET_EARTH, 'never', 3);
    expect(p.taste.corrections).toEqual({ 'genre:documentary': 'less', 'keyword:nature': 'more' });
  });

  it('keeps the stored profile small', () => {
    let p = base;
    for (const i of C.items) p = engine.learnFromSwipe(p, i, 'yes', C);
    for (const i of C.items) p = engine.learnFromSwipe(p, i, 'never', C);
    expect(Object.keys(p.taste.keywords).length).toBeLessThanOrEqual(150);
    expect(JSON.stringify(p.taste).length).toBeLessThan(8000);
  });

  it('learning is deterministic', () => {
    expect(swipe(base, PLANET_EARTH, 'yes', 3)).toEqual(swipe(base, PLANET_EARTH, 'yes', 3));
  });
});

describe('describeTaste (the "what it has learned" page)', () => {
  it('gives 8-16 plain-language lines for each well-known profile, strongest first', () => {
    for (const p of ['alex', 'sam']) {
      const lines = engine.describeTaste(sampleProfile(p), C);
      expect(lines.length).toBeGreaterThanOrEqual(8);
      expect(lines.length).toBeLessThanOrEqual(16);
      for (let k = 1; k < lines.length; k++) expect(Math.abs(lines[k].strength)).toBeLessThanOrEqual(Math.abs(lines[k - 1].strength));
      expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
      expect(new Set(lines.map((l) => l.text)).size).toBe(lines.length);
      for (const l of lines) {
        expect(l.key).toMatch(/^(genre|keyword|trait):.+/);
        expect(l.text).toMatch(/^[A-Z]/);
        expect(l.text).not.toMatch(/\d|undefined|NaN|:|_/); // no numbers, no internal names
        expect(l.strength).toBeGreaterThanOrEqual(-1);
        expect(l.strength).toBeLessThanOrEqual(1);
        expect(['favorites', 'learned', 'corrected']).toContain(l.source);
        expect(l.correction).toBeNull();
      }
    }
  });

  it("reflects what the favourites imply (alex: comedies and sitcoms; sam: competition shows and reality TV)", () => {
    const alex = engine.describeTaste(sampleProfile('alex'), C);
    const comedy = alex.find((l) => l.key === 'genre:comedy')!;
    expect(comedy.text).toBe('You love comedies');
    expect(comedy.source).toBe('favorites');
    expect(alex[0].key).toBe('genre:comedy');
    expect(alex.find((l) => l.key === 'keyword:sitcom')?.text).toMatch(/sitcoms/);
    expect(alex.find((l) => l.key === 'trait:dropIn')?.text).toMatch(/drop into/);

    const sam = engine.describeTaste(sampleProfile('sam'), C);
    expect(sam.find((l) => l.key === 'keyword:competition')?.text).toMatch(/competition shows/);
    expect(sam.find((l) => l.key === 'genre:reality')?.text).toMatch(/reality TV/);
    expect(sam.find((l) => l.key === 'genre:drama')?.strength).toBeGreaterThan(0.4);
  });

  it('shows what swipes have taught, positive and negative', () => {
    let p = sampleProfile('alex');
    p = swipe(p, PLANET_EARTH, 'yes', 8);
    p = swipe(p, BRIDGERTON, 'never', 3);
    const lines = engine.describeTaste(p, C);
    const docs = lines.find((l) => l.key === 'genre:documentary')!;
    expect(docs.source).toBe('learned');
    expect(docs.strength).toBeGreaterThan(0);
    expect(docs.text).toMatch(/saying yes to documentaries/);
    const period = lines.find((l) => l.key === 'keyword:period drama')!;
    expect(period.source).toBe('learned');
    expect(period.strength).toBeLessThan(0);
    expect(period.text).toMatch(/^You(’|')ve been skipping period dramas$|^You steer clear of period dramas$/);
  });

  // REWRITTEN for the public version (was: an empty profile gives no lines). A blank profile is now
  // the usual starting point, so the page says the little that is true of it instead of nothing.
  it('for a blank profile it says only what is true: the two acquired tastes everyone starts with held back', () => {
    const lines = engine.describeTaste(blankProfile('kit'), C);
    expect(lines.map((l) => l.key).sort()).toEqual(['genre:kids', 'keyword:anime']);
    expect(lines.map((l) => l.text).sort()).toEqual(['Anime is held back until you show you like it', "Kids' shows are held back until you show you like them"]);
    for (const l of lines) {
      expect(l.strength).toBeLessThan(0);
      expect(l.correction).toBeNull();
      expect(l.text).not.toMatch(/favourite|love|\d|undefined|NaN/);
    }
    // Nothing is claimed about what they like.
    expect(lines.filter((l) => l.strength > 0)).toEqual([]);
  });

  it('reads sensibly at every stage: one favourite claims nothing, a few are stated modestly, many confidently', () => {
    const favs = sampleProfile('alex').favorites;
    const sitcoms = favs.filter((f) => f.keywords.includes('sitcom'));
    expect(sitcoms.length).toBeGreaterThanOrEqual(4);
    const withFavs = (n: number): Profile => ({ ...blankProfile('kit'), favorites: sitcoms.slice(0, n) });
    const liked = (n: number) => engine.describeTaste(withFavs(n), C).filter((l) => l.strength > 0);

    // One favourite is not a pattern: nothing positive is claimed.
    expect(liked(1)).toEqual([]);
    // Two or three: what they share is stated, but never as "You love".
    for (const n of [2, 3]) {
      const lines = liked(n);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.find((l) => l.key === 'genre:comedy')).toBeDefined();
      for (const l of lines) {
        expect(l.text, `${n}: ${l.text}`).toMatch(/^You(’|')re drawn to |^You lean towards /);
        expect(l.source).toBe('favorites');
      }
    }
    expect(liked(2).every((l) => l.text.startsWith('You lean towards '))).toBe(true);
    // The full list speaks plainly.
    expect(engine.describeTaste(sampleProfile('alex'), C).find((l) => l.key === 'genre:comedy')!.text).toBe('You love comedies');
    // Every stage is well-formed.
    for (const n of [0, 1, 2, 3, 4]) {
      const lines = engine.describeTaste(withFavs(n), C);
      expect(lines.length).toBeLessThanOrEqual(16);
      expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
      for (const l of lines) expect(l.text).toMatch(/^[A-Z]/);
    }
  });

  it('a blank profile that has only swiped is described by its swipes', () => {
    let p = blankProfile('kit');
    p = swipe(p, PLANET_EARTH, 'yes', 8);
    const docs = engine.describeTaste(p, C).find((l) => l.key === 'genre:documentary')!;
    expect(docs.source).toBe('learned');
    expect(docs.text).toMatch(/saying yes to documentaries/);
  });

  it('is deterministic', () => {
    const p = swipe(sampleProfile('sam'), PLANET_EARTH, 'yes', 4);
    expect(engine.describeTaste(p, C)).toEqual(engine.describeTaste(p, C));
  });
});

describe('correctTaste (manual corrections)', () => {
  it('sets and clears a correction, returning a copy', () => {
    const base = sampleProfile('sam');
    const less = engine.correctTaste(base, 'genre:reality', 'less');
    expect(base.taste.corrections).toEqual({});
    expect(less.taste.corrections).toEqual({ 'genre:reality': 'less' });
    const more = engine.correctTaste(less, 'genre:reality', 'more');
    expect(more.taste.corrections).toEqual({ 'genre:reality': 'more' });
    const cleared = engine.correctTaste(more, 'genre:reality', null);
    expect(cleared.taste.corrections).toEqual({});
    expect(engine.describeTaste(cleared, C)).toEqual(engine.describeTaste(base, C));
  });

  it('shows on the taste page as a corrected line that outranks what was learned', () => {
    let p = sampleProfile('sam');
    p = swipe(p, BAKE_OFF, 'yes', 10); // learning says she loves reality...
    p = engine.correctTaste(p, 'genre:reality', 'less'); // ...but she says less
    const line = engine.describeTaste(p, C).find((l) => l.key === 'genre:reality')!;
    expect(line.correction).toBe('less');
    expect(line.source).toBe('corrected');
    expect(line.strength).toBeLessThanOrEqual(-0.9);
    expect(line.text).toBe('Less reality TV, as you asked');

    const up = engine.describeTaste(engine.correctTaste(p, 'genre:western', 'more'), C).find((l) => l.key === 'genre:western')!;
    expect(up).toMatchObject({ correction: 'more', source: 'corrected', text: 'More westerns, as you asked' });
    expect(up.strength).toBeGreaterThanOrEqual(0.9);
  });

  it('"less" visibly pushes matching titles down the deck, and outranks learning', () => {
    // v2: same checks, on reality shows she has NOT seen. The sample catalog's reality shows are all
    // Sam's favourites, and an 'either' deck now deals only about one seen title in ten, so the old
    // version (which compared her favourites' positions in an 'either' deck) no longer has them to compare.
    const catalog = syntheticCatalog(200); // the sample catalog plus look-alikes nobody has seen
    const genresOf = (id: string) => catalog.items.find((i) => i.id === id)!.genres;
    const r = req({ who: SAM, mood: 'brainoff', viewing: 'background', time: 60, novelty: 'either' });
    const before = engine.buildDeck(r, makeCtx({ catalog }), { limit: 100 });
    const reality = before.filter((c) => genresOf(c.itemId).includes('reality')).slice(0, 3).map((c) => c.itemId);
    expect(reality).toHaveLength(3);
    expect(rank(before, reality[0])).toBeLessThan(6);

    const ctx = makeCtx({ catalog });
    let p = swipe(ctx.state.profiles.sam, BAKE_OFF, 'yes', 10);
    p = engine.correctTaste(p, 'genre:reality', 'less');
    ctx.state.profiles.sam = p;
    const after = engine.buildDeck(r, ctx, { limit: 100 });
    for (const id of reality) {
      expect(rank(after, id), id).toBeGreaterThan(rank(before, id) + 3);
    }
    // Nothing reality in the top five any more.
    for (const c of after.slice(0, 5)) expect(genresOf(c.itemId)).not.toContain('reality');
  });

  it('"more" visibly pulls matching titles up, and says so in the reasons', () => {
    const r = req({ who: ALEX, mood: 'gripped', time: 60, novelty: 'new' });
    const before = engine.buildDeck(r, makeCtx(), { limit: 100 });
    const ctx = makeCtx();
    ctx.state.profiles.alex = engine.correctTaste(ctx.state.profiles.alex, 'genre:western', 'more');
    const after = engine.buildDeck(r, ctx, { limit: 100 });
    expect(rank(before, 'tv-73586')).toBeGreaterThan(3); // Yellowstone
    expect(rank(after, 'tv-73586')).toBeLessThanOrEqual(1);
    expect(after.find((c) => c.itemId === 'tv-73586')!.reasons).toContain('You asked for more westerns');
  });

  it('works for keywords and traits too', () => {
    const r = req({ who: ALEX, mood: 'laugh', novelty: 'new' });
    const before = engine.buildDeck(r, makeCtx(), { limit: 100 });
    const kw = makeCtx();
    kw.state.profiles.alex = engine.correctTaste(kw.state.profiles.alex, 'keyword:mockumentary', 'less');
    const afterKw = engine.buildDeck(r, kw, { limit: 100 });
    expect(rank(afterKw, 'tv-2316')).toBeGreaterThan(rank(before, 'tv-2316')); // The Office
    const tr = makeCtx();
    tr.state.profiles.alex = engine.correctTaste(tr.state.profiles.alex, 'trait:kind:movie', 'more');
    const afterTr = engine.buildDeck(r, tr, { limit: 100 });
    expect(rank(afterTr, 'movie-8363')).toBeLessThan(rank(before, 'movie-8363')); // Superbad
    expect(engine.describeTaste(tr.state.profiles.alex, C).find((l) => l.key === 'trait:kind:movie')?.text).toBe('More films, as you asked');
  });

  it('an acquired taste that was held back (anime) can be switched on from the taste page', () => {
    const alex = sampleProfile('alex');
    const held = engine.describeTaste(alex, C).find((l) => l.key === 'keyword:anime');
    // The line exists so there is something to tap "more" on.
    expect(held === undefined || held.strength < 0).toBe(true);
    const on = engine.correctTaste(alex, 'keyword:anime', 'more');
    expect(engine.describeTaste(on, C).find((l) => l.key === 'keyword:anime')).toMatchObject({ correction: 'more', text: 'More anime, as you asked' });
  });
});
