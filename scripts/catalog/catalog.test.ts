import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogItem } from '../../src/contracts/catalog';
import { ALL_PROVIDER_IDS } from '../../src/contracts/catalog';
import { FIXTURE_CATALOG } from '../../src/contracts/fixtures/catalog';
import { parseDetail, toCatalogItem } from './parse';
import { computeFlags, mapGenres, pickRuntime, tagTitle, type TagInput } from './tagging';
import { diffArrivals, prevFromPool } from './diff';
import { pickStandouts, seasonsToFetch } from './standout';
import { passesFloor, selectItems, servicesOf, trimTo } from './select';
import { chooseSearchResult } from './seeds';
import { TmdbClient, fetchJsonOptional } from './tmdb';
import { countByDefaultService, validateCatalog } from './validate';

// ---- hand-written TMDB-shaped responses -----------------------------------
const kw = (...names: string[]) => names.map((name, i) => ({ id: i + 1, name }));
function tvDetail(o: any) {
  const { keywords = [], providers = { flatrate: [{ provider_id: 8 }] }, genres = [], ...rest } = o;
  return {
    id: 1, adult: false, poster_path: '/p.jpg', backdrop_path: '/b.jpg', overview: 'An overview. '.repeat(30), original_language: 'en',
    vote_average: 8, vote_count: 3000, popularity: 100, number_of_seasons: 3, episode_run_time: [], first_air_date: '2011-04-17',
    genres, keywords: { results: kw(...keywords) },
    'watch/providers': { results: { US: providers } },
    recommendations: { results: [{ id: 5 }, { id: 6 }] },
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    seasons: [{ season_number: 0 }, { season_number: 1, air_date: '2011-04-17' }],
    ...rest,
  };
}
function movieDetail(o: any) {
  const { keywords = [], providers = { flatrate: [{ provider_id: 8 }] }, genres = [], ...rest } = o;
  return {
    id: 1, adult: false, poster_path: '/p.jpg', backdrop_path: null, overview: 'Short.', original_language: 'en', runtime: 100,
    vote_average: 7.5, vote_count: 5000, popularity: 50, release_date: '2015-12-25', genres, keywords: { keywords: kw(...keywords) },
    'watch/providers': { results: { US: providers } }, recommendations: { results: [] },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, certification: 'R' }] }] },
    ...rest,
  };
}
const G = { action: 10759, drama: 18, fantasy: 10765, comedy: 35, animation: 16, reality: 10764, doc: 99, crime: 80, mystery: 9648, thriller: 53, horror: 27, scifi: 878, family: 10751, talk: 10767 };
const genres = (...ids: number[]) => ids.map((id) => ({ id }));
const tvItem = (o: any) => toCatalogItem(parseDetail('tv', tvDetail(o))!);
const movieItem = (o: any) => toCatalogItem(parseDetail('movie', movieDetail(o))!);

describe('genre mapping', () => {
  it('folds TMDB movie + TV genres into slugs', () => {
    expect(mapGenres([10759, 10765, 10770, 10763, 10768])).toEqual(['action', 'adventure', 'scifi', 'fantasy', 'war']);
    expect(mapGenres([878])).toEqual(['scifi']);
  });
});

describe('providers', () => {
  it('keeps only flatrate + ads providers on our ids, never rent/buy/channels', () => {
    const p = parseDetail('tv', tvDetail({ name: 'X', providers: { flatrate: [{ provider_id: 8 }, { provider_id: 9999 }], ads: [{ provider_id: 15 }], rent: [{ provider_id: 337 }], buy: [{ provider_id: 386 }] } }))!;
    expect(p.providers).toEqual([8, 15]);
    expect(p.providers.every((x) => ALL_PROVIDER_IDS.includes(x))).toBe(true);
  });
  it('has no providers when none apply', () => {
    expect(parseDetail('tv', tvDetail({ name: 'X', providers: { rent: [{ provider_id: 8 }] } }))!.providers).toEqual([]);
  });
});

describe('tagging of famous titles', () => {
  it('Game of Thrones is high attention', () => {
    const i = tvItem({ id: 1399, name: 'Game of Thrones', genres: genres(G.drama, G.fantasy, G.action), keywords: ['dragon', 'political intrigue', 'kingdom'], episode_run_time: [60] });
    expect(i.attention).toBe('high');
    expect(i.dropIn).toBe(false);
  });
  it('heuristics alone put serialized fantasy drama with intrigue at high (no override)', () => {
    const p = parseDetail('tv', tvDetail({ id: 1, name: 'Some Throne Show', genres: genres(G.drama, G.fantasy), keywords: ['political intrigue'] }))!;
    expect(tagTitle({ kind: 'tv', tmdbId: 1, title: p.title, year: p.year, genres: p.genres, keywords: p.allKeywords, originalLanguage: 'en', runtime: 55, rating: 8, votes: 3000 }, undefined).attention).toBe('high');
  });
  it('Family Guy is low attention + dropIn + laugh', () => {
    const i = tvItem({ id: 1434, name: 'Family Guy', first_air_date: '1999-01-31', genres: genres(G.animation, G.comedy), keywords: ['adult animation', 'sitcom', 'satire'], episode_run_time: [22] });
    expect(i.attention).toBe('low');
    expect(i.dropIn).toBe(true);
    expect(i.moods.laugh).toBeGreaterThan(0.8);
    expect(i.flags.scary).toBe(false);
  });
  it('a subtitled show is high attention', () => {
    expect(tvItem({ name: 'Foreign', original_language: 'ko', genres: genres(G.drama) }).attention).toBe('high');
  });
  it('baking show: low, dropIn, cozy', () => {
    const i = tvItem({ id: 1, name: 'The Great British Bake Off', first_air_date: '2010-08-17', genres: genres(G.reality), keywords: ['baking', 'competition'], episode_run_time: [60] });
    expect(i.attention).toBe('low');
    expect(i.dropIn).toBe(true);
    expect(i.moods.cozy).toBeGreaterThanOrEqual(0.9);
  });
  it('strategy competition reality is not drop-in and medium', () => {
    const i = tvItem({ name: 'Some Survivor', genres: genres(G.reality), keywords: ['competition', 'elimination', 'strategy'] });
    expect(i.dropIn).toBe(false);
    expect(i.attention).toBe('medium');
  });
  it('horror movie is flagged horror + scary with scared mood', () => {
    const i = movieItem({ id: 9, title: 'Scary Thing', genres: genres(G.horror, G.thriller), keywords: ['haunted house'] });
    expect(i.flags).toEqual({ horror: true, trueCrime: false, scary: true });
    expect(i.moods.scared).toBeGreaterThan(0.8);
  });
  it('TV horror (no horror genre on TMDB TV) is caught by keywords', () => {
    const i = tvItem({ name: 'Creepy', genres: genres(G.drama, G.mystery), keywords: ['slasher', 'gore'] });
    expect(i.flags.horror).toBe(true);
  });
  it('Squid Game and Killing Eve are not scary even with dark keywords', () => {
    const sq = tvItem({ id: 93405, name: 'Squid Game', first_air_date: '2021-09-17', original_language: 'ko', genres: genres(G.drama, G.mystery), keywords: ['survival', 'gore', 'death game'] });
    expect(sq.flags.scary).toBe(false);
    expect(sq.flags.horror).toBe(false);
    expect(sq.attention).toBe('high');
    const ke = tvItem({ id: 72750, name: 'Killing Eve', first_air_date: '2018-04-08', genres: genres(G.drama, G.thriller, G.crime), keywords: ['assassin', 'serial killer', 'psychopath'] });
    expect(ke.flags.scary).toBe(false);
  });
  it('tense thrillers are NOT flagged scary', () => {
    const f = computeFlags({ kind: 'movie', tmdbId: 1, title: 'Heist', year: 2020, genres: ['thriller', 'crime'], keywords: ['heist', 'double cross', 'conspiracy'], originalLanguage: 'en', runtime: 110, rating: 7, votes: 1000 });
    expect(f.scary).toBe(false);
  });
  it('supernatural comedies (vampires, ghosts) are not scary', () => {
    const f = computeFlags({ kind: 'tv', tmdbId: 1, title: 'Shadows', year: 2019, genres: ['comedy'], keywords: ['vampire', 'supernatural', 'mockumentary'], originalLanguage: 'en', runtime: 22, rating: 8, votes: 1000 });
    expect(f.scary).toBe(false);
    expect(f.horror).toBe(false);
  });
  it('monster / supernatural sci-fi is scary but not horror', () => {
    const f = computeFlags({ kind: 'tv', tmdbId: 1, title: 'Strange', year: 2016, genres: ['drama', 'scifi', 'mystery'], keywords: ['supernatural', 'monster'], originalLanguage: 'en', runtime: 50, rating: 8, votes: 1000 });
    expect(f).toEqual({ horror: false, trueCrime: false, scary: true });
  });
  it('true crime docuseries and news magazines are flagged', () => {
    expect(tvItem({ name: 'Making a Murderer', genres: genres(G.doc, G.crime), keywords: ['murder', 'trial'] }).flags.trueCrime).toBe(true);
    expect(tvItem({ name: 'Dateline NBC', genres: genres(G.doc), keywords: [] }).flags.trueCrime).toBe(true);
    expect(tvItem({ name: 'Some Show', genres: genres(G.drama), keywords: ['true crime'] }).flags.trueCrime).toBe(true);
    expect(tvItem({ name: 'Planet Earth', genres: genres(G.doc), keywords: ['nature'] }).flags.trueCrime).toBe(false);
  });
  it('light rom-com is low attention, romantic mood', () => {
    const i = movieItem({ title: 'Meet Cute', genres: genres(35, 10749), keywords: ['romantic comedy'] });
    expect(i.attention).toBe('low');
    expect(i.moods.romantic).toBeGreaterThan(0.8);
  });
  it('nature documentary series is low + dropIn', () => {
    const i = tvItem({ name: 'Planet', genres: genres(G.doc), keywords: ['nature', 'wildlife'] });
    expect(i.attention).toBe('low');
    expect(i.dropIn).toBe(true);
  });
  it('anthology counts as drop-in', () => {
    expect(tvItem({ name: 'Anth', genres: genres(G.drama, G.scifi), keywords: ['anthology'] }).dropIn).toBe(true);
  });
  it('serialized drama is not drop-in and never has dropIn on movies', () => {
    expect(tvItem({ name: 'Serial', genres: genres(G.drama), keywords: ['family'] }).dropIn).toBe(false);
    expect(movieItem({ title: 'Movie', genres: genres(35) }).dropIn).toBe(false);
  });
  it('moods stay within 0..1 and tiny values are dropped', () => {
    const i = tvItem({ name: 'A', genres: genres(G.comedy, G.family), keywords: ['sitcom', 'wholesome', 'friendship', 'small town'] });
    for (const v of Object.values(i.moods)) {
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('parsing', () => {
  it('trims overview, caps keywords/related, omits undefined fields, runtime > 0', () => {
    const i = tvItem({ name: 'Long', genres: genres(G.drama), keywords: Array.from({ length: 40 }, (_, n) => `k${n}`), recommendations: { results: Array.from({ length: 30 }, (_, n) => ({ id: n + 100 })) } });
    expect(i.overview.length).toBeLessThanOrEqual(171);
    expect(i.keywords.length).toBe(10);
    expect(i.related.length).toBe(8);
    expect(i.runtime).toBeGreaterThan(0);
    expect(i.id).toBe(`tv-${i.tmdbId}`);
    const json = JSON.parse(JSON.stringify(movieItem({ title: 'M', release_dates: { results: [] } })));
    expect('certification' in json).toBe(false);
    expect('seasons' in json).toBe(false);
  });
  it('reads certifications', () => {
    expect(tvItem({ name: 'A' }).certification).toBe('TV-MA');
    expect(movieItem({ title: 'A' }).certification).toBe('R');
  });
  it('runtime fallbacks', () => {
    expect(pickRuntime('tv', { episode_run_time: [20, 22, 45] }, ['comedy'])).toBe(22);
    expect(pickRuntime('tv', { episode_run_time: [], last: 47 }, ['drama'])).toBe(47);
    expect(pickRuntime('tv', {}, ['reality'])).toBe(45);
    expect(pickRuntime('movie', { runtime: 0 }, [])).toBe(100);
  });
  it('rejects titles without a date', () => {
    expect(parseDetail('tv', tvDetail({ name: 'No date', first_air_date: '' }))).toBeNull();
  });
});

// ---- selection ------------------------------------------------------------
const fx = (id: string, providers: number[], over: Partial<CatalogItem> = {}): CatalogItem => ({ ...FIXTURE_CATALOG.items[0], kind: id.startsWith('tv') ? 'tv' : 'movie', id, tmdbId: Number(id.replace(/\D/g, '')) || 1, providers, ...over });

describe('selection', () => {
  it('quality floor', () => {
    const base = { kind: 'movie' as const, genreIds: [], today: '2026-10-10' };
    expect(passesFloor({ ...base, votes: 1000, rating: 7, date: '2010-01-01' })).toBe(true);
    expect(passesFloor({ ...base, votes: 50, rating: 7, date: '2010-01-01' })).toBe(false);
    expect(passesFloor({ ...base, votes: 50, rating: 7, date: '2026-05-01' })).toBe(true);
    expect(passesFloor({ ...base, votes: 1000, rating: 4.9, date: '2010-01-01' })).toBe(false);
    expect(passesFloor({ ...base, kind: 'tv', genreIds: [10764], votes: 60, rating: 5.8, date: '2018-01-01' })).toBe(true);
  });
  it('keeps every service represented instead of letting one crowd out the rest', () => {
    const pool: CatalogItem[] = [];
    for (let n = 0; n < 400; n++) pool.push(fx(`movie-${n}`, [8], { popularity: 500 - n, votes: 20000 }));
    for (let n = 0; n < 60; n++) pool.push(fx(`movie-${1000 + n}`, [2616], { popularity: 5, votes: 500 }));
    for (let n = 0; n < 60; n++) pool.push(fx(`movie-${2000 + n}`, [386], { popularity: 5, votes: 500 }));
    const out = selectItems(pool, { perService: 50, cap: 100, minPerService: 40, mustKeep: new Set() });
    const svc = (s: string) => out.filter((i) => servicesOf(i.providers).includes(s as any)).length;
    expect(svc('paramount')).toBeGreaterThanOrEqual(40);
    expect(svc('peacock')).toBeGreaterThanOrEqual(40);
    expect(out.length).toBeLessThanOrEqual(150);
  });
  it('trimTo respects the per-service minimum and mustKeep', () => {
    const items = [...Array.from({ length: 10 }, (_, n) => fx(`movie-${n}`, [8])), ...Array.from({ length: 5 }, (_, n) => fx(`movie-${100 + n}`, [386], { popularity: 1, votes: 10 }))];
    const out = trimTo(items, 8, 5, new Set(['movie-0']));
    expect(out.filter((i) => i.providers.includes(386)).length).toBe(5);
    expect(out.some((i) => i.id === 'movie-0')).toBe(true);
  });
});

// ---- standouts ------------------------------------------------------------
describe('standout episodes', () => {
  const eps = (): any[] => {
    const out: any[] = [];
    for (let s = 1; s <= 3; s++) for (let e = 1; e <= 10; e++) out.push({ season_number: s, episode_number: e, name: `Ep ${s}x${e}`, vote_average: 7.2, vote_count: 20, runtime: 22 });
    return out;
  };
  it('picks high-rated, well-voted, standalone episodes, best first, max 3', () => {
    const list = eps();
    list[5] = { ...list[5], name: 'Great One', vote_average: 9.1, vote_count: 80 };
    list[15] = { ...list[15], name: 'Good One', vote_average: 8.7, vote_count: 60 };
    list[0] = { ...list[0], name: 'Pilot', vote_average: 9.5, vote_count: 200 }; // S1E1 skipped
    list[8] = { ...list[8], name: 'Finale (Part 1)', vote_average: 9.4, vote_count: 200 };
    list[9] = { ...list[9], name: 'Few votes', vote_average: 9.9, vote_count: 2 };
    const out = pickStandouts(list);
    expect(out.map((o) => o.name)).toEqual(['Great One', 'Good One']);
    expect(out[0]).toEqual({ season: 1, episode: 6, name: 'Great One', runtime: 22 });
  });
  it('returns nothing for thin data', () => {
    expect(pickStandouts(eps().slice(0, 3))).toEqual([]);
    expect(pickStandouts(eps())).toEqual([]);
  });
  it('samples seasons evenly for long-runners', () => {
    expect(seasonsToFetch(5)).toEqual([1, 2, 3, 4, 5]);
    const s = seasonsToFetch(35);
    expect(s.length).toBe(16);
    expect(s[0]).toBe(1);
    expect(s.at(-1)).toBe(35);
  });
});

// ---- new arrivals -----------------------------------------------------------
describe('new arrivals diff', () => {
  const today = '2026-10-10';
  const a = fx('movie-1', [8]);
  const b = fx('tv-2', [15], { kind: 'tv', seasons: 3 });
  const c = fx('movie-3', [386]);
  const run = (items: CatalogItem[], prev: any, prevNew: any = null, info = new Map()) => diffArrivals({ items, prev, prevNew, today, builtAt: '2026-10-10T09:00:00Z', info });

  it('flags new titles and new seasons only', () => {
    const prev = new Map([['movie-1', { providers: [8] }], ['tv-2', { providers: [15], seasons: 2 }]]);
    const r = run([a, b, c], prev);
    const keys = r.arrivals.entries.map((e) => `${e.itemId}:${e.type}:${e.season ?? ''}`).sort();
    expect(keys).toEqual(['movie-3:title:', 'tv-2:season:3']);
    expect(r.arrivals.entries[0].date).toBe(today);
  });
  it('does not mark titles already seen in the pool (selection churn)', () => {
    const pool = { schema: 1 as const, builtAt: '', titles: { 'movie-3': { p: [386] }, 'movie-1': { p: [8] } } };
    const prev = prevFromPool(pool, null);
    expect(run([a, c], prev).arrivals.entries).toEqual([]);
  });
  it('merges with the previous window, newest first, dropping stale and removed items', () => {
    const prev = new Map([['movie-1', { providers: [8] }], ['movie-3', { providers: [386] }]]);
    const prevNew = { schema: 1 as const, builtAt: '', entries: [
      { itemId: 'movie-1', type: 'title' as const, providers: [8], date: '2026-10-05' },
      { itemId: 'movie-3', type: 'title' as const, providers: [386], date: '2026-08-01' }, // older than 30 days
      { itemId: 'movie-999', type: 'title' as const, providers: [8], date: '2026-10-08' }, // no longer in catalog
    ] };
    const d = fx('movie-4', [15]);
    const r = run([a, c, d], prev, prevNew);
    expect(r.arrivals.entries.map((e) => e.itemId)).toEqual(['movie-4', 'movie-1']);
  });
  it('first build seeds from recent release / season dates instead of marking everything new', () => {
    const info = new Map([
      ['movie-1', { releaseDate: '2026-10-01', seasonPremieres: [] }],
      ['movie-3', { releaseDate: '2019-01-01', seasonPremieres: [] }],
      ['tv-2', { releaseDate: '2020-01-01', seasonPremieres: [{ season: 1, airDate: '2020-01-01' }, { season: 3, airDate: '2026-09-20' }] }],
    ]);
    const r = run([a, b, c], null, null, info);
    expect(r.seeded).toBe(true);
    expect(r.arrivals.entries.map((e) => `${e.itemId}:${e.type}`)).toEqual(['movie-1:title', 'tv-2:season']);
    expect(r.arrivals.entries[1].season).toBe(3);
  });
  it('ignores a flood of "new" titles (likely a data glitch) but keeps season bumps', () => {
    const many = Array.from({ length: 100 }, (_, n) => fx(`movie-${500 + n}`, [8]));
    const prev = new Map([['tv-2', { providers: [15], seasons: 2 }]]);
    const r = run([b, ...many], prev);
    expect(r.suspicious).toBe(true);
    expect(r.arrivals.entries.map((e) => e.itemId)).toEqual(['tv-2']);
  });
});

// ---- seeds ------------------------------------------------------------------
describe('seed resolution', () => {
  const shows = [
    { id: 1, name: 'The Traitors', first_air_date: '2022-11-29', origin_country: ['GB'], popularity: 90 },
    { id: 2, name: 'The Traitors', first_air_date: '2023-01-12', origin_country: ['US'], popularity: 70 },
    { id: 3, name: 'The Traitors', first_air_date: '2023-02-01', origin_country: ['AU'], popularity: 80 },
  ];
  it('picks by year, then country, then popularity', () => {
    expect(chooseSearchResult(shows, 'tv', { year: 2023, country: 'US' })!.hit.id).toBe(2);
    expect(chooseSearchResult(shows, 'tv', { year: 2023 })!.hit.id).toBe(3);
  });
  it('flags low confidence when nothing matches the hint', () => {
    const r = chooseSearchResult(shows, 'tv', { year: 1990 })!;
    expect(r.confident).toBe(false);
  });
});

// ---- client -------------------------------------------------------------------
describe('TMDB client', () => {
  const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
  it('retries 429 and 5xx then succeeds', async () => {
    const seq = [res(429, {}, { 'retry-after': '1' }), res(503), res(200, { ok: true })];
    const waits: number[] = [];
    const c = new TmdbClient({ token: 't', fetchImpl: (async () => seq.shift()!) as any, sleepImpl: async (ms) => void waits.push(ms) });
    expect(await c.get('/x')).toEqual({ ok: true });
    expect(waits.length).toBe(2);
    expect(c.stats.retries).toBe(2);
  });
  it('does not retry 404 and gives up after max attempts', async () => {
    let calls = 0;
    const c404 = new TmdbClient({ token: 't', fetchImpl: (async () => (calls++, res(404))) as any, sleepImpl: async () => {} });
    await expect(c404.get('/x')).rejects.toThrow(/404/);
    expect(calls).toBe(1);
    calls = 0;
    const c500 = new TmdbClient({ token: 't', maxAttempts: 3, fetchImpl: (async () => (calls++, res(500))) as any, sleepImpl: async () => {} });
    await expect(c500.get('/x')).rejects.toThrow(/500/);
    expect(calls).toBe(3);
  });
  it('sends the bearer token and tolerates 404 for previous files', async () => {
    let auth = '';
    const c = new TmdbClient({ token: 'secret', fetchImpl: (async (_u: any, init: any) => ((auth = init.headers.Authorization), res(200, {}))) as any });
    await c.get('/x', { a: 1, skip: undefined });
    expect(auth).toBe('Bearer secret');
    expect(await fetchJsonOptional('http://x/y.json', (async () => res(404)) as any, async () => {})).toBeNull();
  });
});

// ---- validation -----------------------------------------------------------------
describe('catalog validation', () => {
  const big = (): Catalog => {
    const items: CatalogItem[] = [];
    const prov = [8, 337, 15, 1899, 386, 2616];
    for (let n = 0; n < 2000; n++) items.push(fx(`movie-${n}`, [prov[n % 6]]));
    return { schema: 1, builtAt: '', items, tasteRefs: [], seedFavorites: { HG: [], BG: [] } };
  };
  it('passes a healthy catalog', () => {
    expect(validateCatalog(big(), 1_000_000, 2000)).toEqual([]);
  });
  it('fails when too small, a service is empty, or it shrank by half', () => {
    const c = big();
    expect(validateCatalog({ ...c, items: c.items.slice(0, 500) }, 1000, null).join()).toMatch(/only 500 titles/);
    const noPeacock = { ...c, items: c.items.filter((i) => !i.providers.includes(386)) };
    expect(validateCatalog(noPeacock, 1000, null).join()).toMatch(/Peacock has only 0/);
    expect(countByDefaultService(c).netflix).toBeGreaterThan(300);
    expect(validateCatalog(c, 1000, 5000).join()).toMatch(/shrank/);
    expect(validateCatalog(c, 9_000_000, null).join()).toMatch(/bytes/);
  });
});

// keep the unused-import checker honest
void ([] as TagInput[]);

describe('flag tuning', () => {
  it('anime with demons is not horror or scary; Riverdale-style murder mystery is not true crime', () => {
    const anime = tvItem({ name: 'Demon Fighters', genres: genres(G.animation, G.fantasy), keywords: ['demon', 'supernatural', 'exorcism', 'based on manga'] });
    expect(anime.flags).toEqual({ horror: false, trueCrime: false, scary: false });
    const teen = tvItem({ name: 'Teen Murder', genres: genres(G.drama, G.mystery, G.crime), keywords: ['murder investigation', 'cold case', 'high school'] });
    expect(teen.flags.trueCrime).toBe(false);
  });
  it('a dramatised true story of a serial killer is true crime', () => {
    expect(tvItem({ name: 'Monster', genres: genres(G.drama, G.crime), keywords: ['serial killer', 'true story', 'murder'] }).flags.trueCrime).toBe(true);
  });
  it('game show keyword alone does not make a drama drop-in', () => {
    expect(tvItem({ name: 'Deadly Games', genres: genres(G.drama), keywords: ['fictional game show', 'game show'] }).dropIn).toBe(false);
  });
});
