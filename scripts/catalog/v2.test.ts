import { describe, expect, it } from 'vitest';
import type { CatalogItem, TitleIndexEntry } from '../../src/contracts/catalog';
import { FIXTURE_CATALOG } from '../../src/contracts/fixtures/catalog';
import { parseDetail, pickLatestSeason, rawAlts, toCatalogItem } from './parse';
import { buildTitleIndex, cleanAka, rowToEntry, titleListJobs, toListRow, trimIndexToBytes, validateTitleIndex } from './titles';
import { findSpinoffs, KnownTitles, normTitle, shareFranchiseWords, type KnownTv, type SpinoffChild } from './spinoff';

describe('latestSeason', () => {
  const today = '2026-10-11';
  it('picks the highest season that has started', () => {
    expect(pickLatestSeason([{ season: 1, airDate: '2022-06-23' }, { season: 2, airDate: '2023-06-22' }, { season: 3, airDate: '2024-06-26' }], today)).toEqual({ number: 3, airDate: '2024-06-26' });
  });
  it('ignores seasons that have not aired yet', () => {
    expect(pickLatestSeason([{ season: 1, airDate: '2025-01-01' }, { season: 2, airDate: '2027-01-01' }], today)).toEqual({ number: 1, airDate: '2025-01-01' });
    expect(pickLatestSeason([{ season: 1, airDate: '2026-10-11' }], today)).toEqual({ number: 1, airDate: '2026-10-11' });
    expect(pickLatestSeason([{ season: 1, airDate: '2026-10-12' }], today)).toBeUndefined();
  });
  it('ignores specials (season 0) and undated seasons', () => {
    expect(pickLatestSeason([{ season: 0, airDate: '2026-01-01' }, { season: 1, airDate: '' }], today)).toBeUndefined();
    expect(pickLatestSeason([{ season: 0, airDate: '2026-01-01' }, { season: 2, airDate: '2020-01-01' }], today)).toEqual({ number: 2, airDate: '2020-01-01' });
  });
  it('is set by toCatalogItem for TV only, from a real-shaped detail', () => {
    const d = {
      id: 1, name: 'Show', first_air_date: '2020-01-01', genres: [{ id: 35 }], episode_run_time: [30], number_of_seasons: 3, vote_average: 8, vote_count: 900, popularity: 50,
      seasons: [{ season_number: 0, air_date: '2021-01-01' }, { season_number: 1, air_date: '2020-01-01' }, { season_number: 2, air_date: '2021-02-01' }, { season_number: 3, air_date: '2099-01-01' }],
      original_name: 'Show',
    };
    const p = parseDetail('tv', d)!;
    expect(toCatalogItem(p, '2026-10-11').latestSeason).toEqual({ number: 2, airDate: '2021-02-01' });
    expect(toCatalogItem(p).latestSeason).toBeUndefined();
    const m = parseDetail('movie', { id: 2, title: 'Film', release_date: '2020-01-01', genres: [], runtime: 100, original_title: 'Film' })!;
    expect(toCatalogItem(m, '2026-10-11').latestSeason).toBeUndefined();
    expect(p.originalTitle).toBe('Show');
  });
});

describe('title index', () => {
  const item = (FIXTURE_CATALOG.items.find((i) => i.kind === 'tv') as CatalogItem)!;
  const row = (id: number, title: string, date: string, pop: number, original = title) =>
    ({ kind: 'tv' as const, row: { id, title, original, date, genreIds: [35], poster: '/p.jpg', popularity: pop } });

  it('converts list rows and drops unusable ones', () => {
    expect(toListRow('tv', { id: 1, name: 'X', original_name: 'Y', first_air_date: '2010-05-01', genre_ids: [18], poster_path: '/a.jpg', popularity: 3.456 })).toMatchObject({ id: 1, title: 'X', original: 'Y', popularity: 3.46 });
    expect(toListRow('tv', { id: 1, name: 'X', first_air_date: '' })).toBeNull();
    expect(toListRow('movie', { id: 1, title: 'X', release_date: '2010-01-01', adult: true })).toBeNull();
    expect(toListRow('movie', { id: 1, title: ' ', release_date: '2010-01-01' })).toBeNull();
  });
  it('adds the original title as aka only when it differs, and always has genres and keywords arrays', () => {
    const e = rowToEntry('movie', { id: 5, title: 'Parasite', original: '기생충', date: '2019-05-30', genreIds: [53, 18], poster: null, popularity: 100 });
    expect(e.aka).toEqual(['기생충']);
    expect(e.year).toBe(2019);
    expect(e.keywords).toEqual([]);
    expect(e.genres.length).toBeGreaterThan(0);
    expect('aka' in rowToEntry('tv', { id: 6, title: 'Same', original: 'same', date: '2019-01-01', genreIds: [], poster: null, popularity: 1 })).toBe(false);
  });
  it('de-duplicates by id: catalog item wins, aka merged, list rows only fill the gaps', () => {
    const idx = buildTitleIndex({
      items: [item],
      originals: new Map([[item.id, 'Original Name']]),
      listRows: [
        { kind: 'tv', row: { id: item.tmdbId, title: item.title, original: 'Another Name', date: `${item.year}-01-01`, genreIds: [], poster: '/x.jpg', popularity: 1 } },
        row(777, 'Taste Only', '2001-01-01', 40),
        row(900, 'Fresh', '2010-01-01', 5),
        row(900, 'Fresh', '2010-01-01', 5),
      ],
    });
    expect(new Set(idx.map((e) => e.id)).size).toBe(idx.length);
    const mine = idx.find((e) => e.id === item.id)!;
    expect(mine.keywords).toEqual(item.keywords.slice(0, 6));
    expect(mine.aka).toEqual(expect.arrayContaining(['Original Name', 'Another Name']));
    const taste = idx.find((e) => e.id === 'tv-777')!;
    expect(taste.keywords).toEqual([]);
    expect(taste.popularity).toBe(40);
    expect(taste.poster).toBe('/p.jpg');
    expect(idx.filter((e) => e.id === 'tv-900')).toHaveLength(1);
    // most popular first
    for (let i = 1; i < idx.length; i++) expect(idx[i - 1].popularity).toBeGreaterThanOrEqual(idx[i].popularity);
  });
  it('keeps same-named titles of different kinds and years apart', () => {
    const idx = buildTitleIndex({ items: [], listRows: [row(1, 'The Office', '2005-03-24', 80), row(2, 'The Office', '2001-07-09', 20), { kind: 'movie', row: { id: 1, title: 'The Office', original: 'The Office', date: '1999-01-01', genreIds: [], poster: null, popularity: 1 } }] });
    expect(idx.map((e) => e.id).sort()).toEqual(['movie-1', 'tv-1', 'tv-2']);
    expect(idx[0].id).toBe('tv-1');
  });
  it('trims the least popular entries to fit, never the protected ones', () => {
    const many: TitleIndexEntry[] = Array.from({ length: 3000 }, (_, i) => ({ id: `tv-${i}`, kind: 'tv', title: `Title number ${i}`, year: 2000, genres: [], keywords: [], popularity: 3000 - i }));
    const keep = new Set(['tv-2999', 'tv-2998']);
    const out = trimIndexToBytes(many, keep, '2026-01-01T00:00:00Z', 60_000);
    expect(Buffer.byteLength(JSON.stringify({ schema: 1, builtAt: '2026-01-01T00:00:00Z', titles: out }))).toBeLessThanOrEqual(60_000);
    expect(out.length).toBeLessThan(3000);
    expect(out.some((e) => e.id === 'tv-2999')).toBe(true);
    expect(out[0].id).toBe('tv-0');
  });
  it('validation fails when too small, duplicated, or missing catalog titles', () => {
    const base = { schema: 1 as const, builtAt: 'x', titles: Array.from({ length: 9000 }, (_, i): TitleIndexEntry => ({ id: `tv-${i}`, kind: 'tv', title: `T${i}`, year: 2000, genres: [], keywords: [], popularity: 1 })) };
    expect(validateTitleIndex(base, 1_000_000, ['tv-5'])).toEqual([]);
    expect(validateTitleIndex({ ...base, titles: base.titles.slice(0, 100) }, 1000, [])[0]).toMatch(/only 100/);
    expect(validateTitleIndex(base, 1_000_000, ['tv-99999'])[0]).toMatch(/missing/);
    expect(validateTitleIndex(base, 9_000_000, [])[0]).toMatch(/bytes/);
  });
  it('plans a few hundred pages per kind, no more than ~1,700 calls in all', () => {
    const jobs = titleListJobs();
    const pages = jobs.reduce((n, j) => n + j.pages, 0);
    expect(pages).toBeGreaterThan(800);
    expect(pages).toBeLessThan(1700);
    expect(jobs.every((j) => j.pages <= 500)).toBe(true);
  });
});

describe('spinoff links', () => {
  let n = 0;
  const tv = (id: number, title: string, year: number, popularity = 50): KnownTv => ({ id: `tv-${id}`, title, year, popularity });
  const known = new KnownTitles([
    tv(1399, 'Game of Thrones', 2011, 300),
    tv(94997, 'House of the Dragon', 2022, 200),
    tv(1416, "Grey's Anatomy", 2005, 200),
    tv(79744, 'Station 19', 2018),
    tv(1668, 'Friends', 1994, 100),
    tv(1403, 'Marvels Agents of S.H.I.E.L.D.', 2013),
    tv(2316, 'The Office', 2005, 90),
    tv(2996, 'The Office', 2001, 40),
    tv(1402, 'The Walking Dead', 2010, 300),
    tv(62286, 'Fear the Walking Dead', 2015),
    tv(2734, 'Law & Order: Special Victims Unit', 1999, 100),
    tv(549, 'Law & Order', 1990, 100),
    tv(253, 'Star Trek', 1966, 40),
    tv(85, 'Star Trek: Picard', 2020),
    tv(4, 'The Mandalorian', 2019, 100),
    tv(5, 'Andor', 2022, 100),
    tv(6, 'Squid Game', 2021, 200),
    tv(7, 'Squid Game: The Challenge', 2023, 60),
    tv(8, 'Love Island', 2015, 80),
    tv(9, 'Love Island USA', 2019, 70),
    tv(10, 'Love Island Games', 2023, 40),
    tv(11, 'Obscure', 2000, 1),
    tv(12, 'Obscure: Returns', 2010, 5),
    tv(13, 'Parent Show', 2000, 50),
    tv(14, 'Parent Show: Season Two', 2010, 5),
    tv(15, 'Dark', 2017, 80),
    tv(16, 'Dark Matter', 2024, 30),
  ]);
  const child = (id: string, title: string, year: number, keywords: string[] = [], related: string[] = []): SpinoffChild => ({ id, title, year, keywords, related });
  const run = (c: SpinoffChild[]) => Object.fromEntries(findSpinoffs(c, known).map((l) => [l.childId, l.parentIds]));
  void n;

  it('normalises titles', () => {
    expect(normTitle("Grey's Anatomy")).toBe('greys anatomy');
    expect(normTitle('Law & Order: SVU')).toBe('law and order svu');
  });
  it('curated: famous cases resolve, parents may be outside the catalog', () => {
    const r = run([child('tv-94997', 'House of the Dragon', 2022), child('tv-79744', 'Station 19', 2018), child('tv-3', 'Joey', 2004)]);
    expect(r['tv-94997']).toEqual(['tv-1399']);
    expect(r['tv-79744']).toEqual(['tv-1416']);
    expect(r['tv-3']).toEqual(['tv-1668']);
  });
  it('curated: parent year disambiguates same-named shows (Love Island)', () => {
    const r = run([child('tv-10', 'Love Island Games', 2023), child('tv-9', 'Love Island USA', 2019)]);
    expect(r['tv-10']).toEqual(['tv-9', 'tv-8']);
    expect(r['tv-9']).toEqual(['tv-8']);
  });
  it('subtitle pattern: "X: Subtitle" where X is another well-known show', () => {
    const r = run([child('tv-62286', 'Fear the Walking Dead', 2015), child('tv-7', 'Squid Game: The Challenge', 2023), child('tv-2734', 'Law & Order: Special Victims Unit', 1999)]);
    expect(r['tv-7']).toEqual(['tv-6']);
    expect(r['tv-2734']).toEqual(['tv-549']);
  });
  it('subtitle pattern: no link for umbrella names, ambiguous names, obscure parents, season labels, or older children', () => {
    const r = run([
      child('tv-85', 'Star Trek: Picard', 2020),
      child('tv-x1', 'The Office: Superfans', 2020),
      child('tv-12', 'Obscure: Returns', 2010),
      child('tv-14', 'Parent Show: Season Two', 2010),
      child('tv-x2', 'Friends: The Early Years', 1990),
      child('tv-x3', 'Dark: Revelations', 2020),
    ]);
    expect(r['tv-85']).toBeUndefined();
    expect(r['tv-x1']).toBeUndefined(); // two shows named The Office, both popular
    expect(r['tv-12']).toBeUndefined();
    expect(r['tv-14']).toBeUndefined();
    expect(r['tv-x2']).toBeUndefined(); // parent is newer than the child
    expect(r['tv-x3']).toEqual(['tv-15']); // single well-known "Dark": links
  });
  it('subtitle pattern: no link for behind-the-scenes extras, international editions and superhero heads', () => {
    const k2 = new KnownTitles([tv(21, 'Cobra Kai', 2018, 90), tv(22, 'Too Hot to Handle', 2020, 60), tv(23, 'Batman', 1966, 40), tv(24, 'Narcos', 2015, 80)]);
    const go = (title: string, year: number) => findSpinoffs([child('tv-z', title, year)], k2).map((l) => l.parentIds);
    expect(go('Cobra Kai: Inside the Dojo', 2024)).toEqual([]);
    expect(go('Too Hot to Handle: Brazil', 2021)).toEqual([]);
    expect(go('Batman: The Animated Series', 1992)).toEqual([]);
    expect(go('Narcos: Mexico', 2018)).toEqual([['tv-24']]);
  });
  it('keyword signal needs a spinoff keyword AND a recommended parent with shared franchise words', () => {
    const rel = ['tv-1402'];
    expect(run([child('tv-p1', 'Tales of the Walking Dead', 2022, ['spin off'], rel)])['tv-p1']).toEqual(['tv-1402']);
    expect(run([child('tv-p1', 'Tales of the Walking Dead', 2022, ['zombie'], rel)])['tv-p1']).toBeUndefined();
    // keyword, but the recommended show shares no franchise words
    expect(run([child('tv-p', 'Something Else', 2020, ['spin off'], ['tv-1399'])])['tv-p']).toBeUndefined();
    // franchise words but not recommended
    expect(run([child('tv-p1', 'Tales of the Walking Dead', 2022, ['prequel'], [])])['tv-p1']).toBeUndefined();
  });
  it('does not link whole universes to each other', () => {
    const r = run([
      child('tv-4', 'The Mandalorian', 2019, ['spin off'], ['tv-5']),
      child('tv-5', 'Andor', 2022, ['spin off', 'prequel'], ['tv-4']),
      child('tv-1403', 'Marvels Agents of S.H.I.E.L.D.', 2013, ['spin off'], ['tv-4']),
    ]);
    expect(r).toEqual({});
  });
  it('shareFranchiseWords is conservative with generic single words', () => {
    expect(shareFranchiseWords('The Walking Dead', 'Fear the Walking Dead')).toBe(true);
    expect(shareFranchiseWords('Power', 'Power Book II: Ghost')).toBe(true);
    expect(shareFranchiseWords('Love', 'Love Island')).toBe(false);
    expect(shareFranchiseWords('Dark', 'Dark Matter')).toBe(false);
    expect(shareFranchiseWords('Star Wars', 'Star Wars Rebels')).toBe(false);
  });
  it('never links a title to itself', () => {
    expect(run([child('tv-8', 'Love Island', 2015)])['tv-8']).toBeUndefined();
  });
});

describe('alternate names (aka)', () => {
  const a = (country: string, title: string, type = '') => ({ country, title, type });
  it('puts the original first, then US names, then other English names', () => {
    expect(cleanAka('The Great British Bake Off', undefined, [a('GB', 'Bake Off'), a('US', 'The Great British Baking Show'), a('DE', 'Das große Backen')])).toEqual(['The Great British Baking Show', 'Bake Off']);
    expect(cleanAka('Squid Game', ['오징어 게임'], [a('US', 'Squid Game: Season 1'), a('US', 'Round Six')])).toEqual(['오징어 게임', 'Round Six']);
  });
  it('de-duplicates case-insensitively and drops names equal to the title', () => {
    expect(cleanAka('The Office', ['the office'], [a('US', 'THE OFFICE'), a('US', 'The Office (U.S.)'), a('GB', 'The Office (U.S.)')])).toEqual(['The Office (U.S.)']);
  });
  it('skips junk: seasons, working titles, long names, non-English countries', () => {
    const long = 'x'.repeat(81);
    expect(cleanAka('T', undefined, [a('US', 'T Season 1'), a('US', 'Untitled Working Title'), a('US', 'Fine Name', 'working title'), a('US', long), a('FR', 'Titre'), a('US', 'Good One')])).toEqual(['Good One']);
  });
  it('caps at five', () => {
    const alts = Array.from({ length: 10 }, (_, i) => a('US', `Name ${i}`));
    expect(cleanAka('T', ['Orig'], alts)).toHaveLength(5);
  });
  it('rawAlts reads both the movie and the tv shape', () => {
    expect(rawAlts({ titles: [{ iso_3166_1: 'US', title: 'A', type: '' }] })).toEqual([{ country: 'US', title: 'A', type: '' }]);
    expect(rawAlts({ results: [{ iso_3166_1: 'GB', title: 'B' }] })).toEqual([{ country: 'GB', title: 'B', type: '' }]);
    expect(rawAlts(undefined)).toEqual([]);
    expect(parseDetail('tv', { id: 1, name: 'Show', first_air_date: '2020-01-01', alternative_titles: { results: [{ iso_3166_1: 'US', title: 'Alt' }] } })!.altTitles).toHaveLength(1);
  });
  it('is merged into the index for catalog items and other entries', () => {
    const item = FIXTURE_CATALOG.items.find((i) => i.kind === 'tv')!;
    const alternates = new Map([[item.id, [a('US', 'US Name')]], ['tv-900', [a('US', 'Baking Show')]]]);
    const idx = buildTitleIndex({
      items: [item],
      alternates,
      listRows: [{ kind: 'tv', row: { id: 900, title: 'Bake Off', original: 'Bake Off', date: '2010-01-01', genreIds: [], poster: null, popularity: 5 } }],
    });
    expect(idx.find((e) => e.id === item.id)!.aka).toEqual(['US Name']);
    expect(idx.find((e) => e.id === 'tv-900')!.aka).toEqual(['Baking Show']);
  });
});

describe('hand-checked extra names', () => {
  it('adds the Baking Show name to the Channel 4 listing', () => {
    const idx = buildTitleIndex({ items: [], listRows: [{ kind: 'tv', row: { id: 87012, title: 'The Great British Bake Off', original: 'The Great British Bake Off', date: '2017-08-29', genreIds: [], poster: null, popularity: 20 } }] });
    expect(idx[0].aka).toEqual(['The Great British Baking Show']);
  });
});
