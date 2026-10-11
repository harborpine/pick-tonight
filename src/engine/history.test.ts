/**
 * Watch-history import: reading files, matching names to titles, learning taste
 * from the result, and the title search for adding a watched title by hand.
 */
import { describe, expect, it } from 'vitest';
import type { ImportedTitle, ParsedHistory, TitleIndex, TitleIndexEntry } from '../contracts';
import { FIXTURE_CATALOG, FIXTURE_NETFLIX_CSV, FIXTURE_TITLE_INDEX } from '../contracts/fixtures/catalog';
import { sampleNetflixHistory } from './dev/sampleHistory';
import { IMPORT_MAX_GENRE, IMPORT_MAX_KEYWORD, IMPORT_MAX_KEYWORDS, IMPORT_MAX_TRAIT, titleWeight } from './history/learnImport';
import { nameKey } from './history/normalize';
import { parseDate } from './history/parse';
import { createEngine } from './index';
import { makeCtx, req } from './testkit';

const engine = createEngine();
const C = FIXTURE_CATALOG;
const IDX = FIXTURE_TITLE_INDEX;
const day = (d: string) => Date.parse(`${d}T12:00:00Z`);
const raws = (p: ParsedHistory) => p.rows.map((r) => r.raw);
const list = (...names: string[]): ParsedHistory => ({ format: 'list', rows: names.map((raw) => ({ raw })) });
const netflix = (...names: string[]): ParsedHistory => ({ format: 'netflix', rows: names.map((raw) => ({ raw })) });
const entry = (id: string, title: string, over: Partial<TitleIndexEntry> = {}): TitleIndexEntry => ({
  id, kind: id.startsWith('movie') ? 'movie' : 'tv', title, year: 2015, genres: ['drama'], keywords: [], popularity: 10, ...over,
});
const indexOf = (...titles: TitleIndexEntry[]): TitleIndex => ({ schema: 1, builtAt: '2026-10-10T00:00:00.000Z', titles });
const matchedIds = (p: ParsedHistory, index: TitleIndex) => engine.matchWatchHistory(p, index).matched.map((m) => `${m.entry.id} x${m.plays}`);

// ---------------------------------------------------------------------------
describe('parseWatchHistory: Netflix', () => {
  it("reads Netflix's viewing-activity file (the sample in the fixture)", () => {
    const p = engine.parseWatchHistory(FIXTURE_NETFLIX_CSV, 'NetflixViewingHistory.csv');
    expect(p.format).toBe('netflix');
    expect(p.rows).toHaveLength(15);
    expect(p.rows[0]).toEqual({ raw: 'The Office (U.S.): Season 4: Dinner Party', at: day('2026-10-02') });
    expect(p.rows[9]).toEqual({ raw: 'Paddington 2', at: day('2026-06-15') });
    expect(p.rows[14]).toEqual({ raw: 'Completely Unknown Home Movie', at: day('2026-01-01') });
    for (const r of p.rows) expect(typeof r.at).toBe('number');
  });

  it('copes with a byte-order mark, Windows line endings, no quotes, and no final newline', () => {
    const text = '﻿Title,Date\r\nParasite,5/5/26\r\n"Paddington 2","6/15/26"';
    expect(engine.parseWatchHistory(text)).toEqual({
      format: 'netflix',
      rows: [{ raw: 'Parasite', at: day('2026-05-05') }, { raw: 'Paddington 2', at: day('2026-06-15') }],
    });
  });

  it('copes with commas, doubled quotes and line breaks inside quoted titles', () => {
    const text = 'Title,Date\n"Love, Death & Robots: Volume 1: Sonnie\'s Edge",1/2/26\n"The ""Real"" Thing",1/3/26\n"Two\nLines",1/4/26\nPlain,1/5/26\n';
    const p = engine.parseWatchHistory(text);
    expect(raws(p)).toEqual(["Love, Death & Robots: Volume 1: Sonnie's Edge", 'The "Real" Thing', 'Two\nLines', 'Plain']);
    expect(p.rows.map((r) => r.at)).toEqual([day('2026-01-02'), day('2026-01-03'), day('2026-01-04'), day('2026-01-05')]);
  });

  it('keeps rows whose date is missing or unreadable (without a date), and skips rows with no title', () => {
    const p = engine.parseWatchHistory('Title,Date\nParasite,\nFriends,not a date\n,1/1/26\nSeinfeld,13/13/26\n');
    expect(p.rows).toEqual([{ raw: 'Parasite' }, { raw: 'Friends' }, { raw: 'Seinfeld' }]);
  });

  it("reads Netflix's full account export (ViewingActivity.csv) and skips trailers and previews", () => {
    const text = [
      'Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country',
      'HG,2026-10-02 01:15:44,00:21:40,,The Office (U.S.): Season 4: Dinner Party,,Apple TV,00:21:40,00:21:40,US (United States)',
      'HG,2026-10-01 23:02:10,00:00:31,Autoplayed: user action: None;,Season 2 Trailer: Wednesday,TRAILER,Apple TV,00:00:31,00:00:31,US (United States)',
      'HG,2026-09-30 00:10:00,01:43:02,,Paddington 2,,iPhone,01:43:02,01:43:02,US (United States)',
    ].join('\n');
    const p = engine.parseWatchHistory(text, 'ViewingActivity.csv');
    expect(p.format).toBe('netflix');
    expect(p.rows).toEqual([
      { raw: 'The Office (U.S.): Season 4: Dinner Party', at: day('2026-10-02') },
      { raw: 'Paddington 2', at: day('2026-09-30') },
    ]);
  });
});

describe('parseWatchHistory: dates', () => {
  it('understands the usual ways of writing a date', () => {
    for (const s of ['10/2/26', '10/02/2026', '2026-10-02', '2026-10-02T03:04:05Z', '2026-10-02 23:59:59', '2026/10/02', 'Oct 2, 2026', 'October 2nd, 2026', '2 October 2026', '2 Oct 2026', 'Fri, Oct 2, 2026']) {
      expect(parseDate(s), s).toBe(day('2026-10-02'));
    }
    expect(parseDate('25/12/2026')).toBe(day('2026-12-25')); // can only be day-first
    expect(parseDate('12/25/2026')).toBe(day('2026-12-25'));
    expect(parseDate('25.12.2026')).toBe(day('2026-12-25'));
    expect(parseDate('1/2/99')).toBe(day('1999-01-02'));
    for (const s of ['', 'yesterday', '13/13/2026', '2/30/2026', '0/0/00', '2026', 'Season 2']) expect(parseDate(s), s).toBeUndefined();
  });

  it('AMBIGUITY RULE: month-first (Netflix US) unless the file itself shows it is day-first', () => {
    // Nothing in the file settles it -> month first.
    const us = engine.parseWatchHistory('Title,Date\nA,02/10/2026\nB,03/04/2026\n');
    expect(us.rows.map((r) => r.at)).toEqual([day('2026-02-10'), day('2026-03-04')]);
    // One row can only be day-first (25/12) -> the whole file is read day-first.
    const eu = engine.parseWatchHistory('Title,Date\nA,02/10/2026\nB,25/12/2026\n');
    expect(eu.rows.map((r) => r.at)).toEqual([day('2026-10-02'), day('2026-12-25')]);
    // A file with a row that can only be month-first stays month-first.
    const us2 = engine.parseWatchHistory('Title,Date\nA,02/10/2026\nB,12/25/2026\n');
    expect(us2.rows.map((r) => r.at)).toEqual([day('2026-02-10'), day('2026-12-25')]);
    // ISO dates are never ambiguous.
    expect(engine.parseWatchHistory('Title,Date\nA,2026-10-02\n').rows[0].at).toBe(day('2026-10-02'));
  });
});

describe('parseWatchHistory: other tables', () => {
  it('finds the title and date columns in a generic CSV, whatever the order and capitalisation', () => {
    const text = 'Watched On,Device,TITLE,Minutes\n2026-03-01,TV,Seinfeld,22\n2026-03-02,Phone,"Parasite",132\n';
    expect(engine.parseWatchHistory(text, 'history.csv')).toEqual({
      format: 'csv',
      rows: [{ raw: 'Seinfeld', at: day('2026-03-01') }, { raw: 'Parasite', at: day('2026-03-02') }],
    });
  });

  it('reads tab- and semicolon-separated files', () => {
    expect(engine.parseWatchHistory('Name\tDate Watched\nTed Lasso\t4/1/26\nSeinfeld\t4/2/26\n', 'export.tsv')).toEqual({
      format: 'csv',
      rows: [{ raw: 'Ted Lasso', at: day('2026-04-01') }, { raw: 'Seinfeld', at: day('2026-04-02') }],
    });
    expect(raws(engine.parseWatchHistory('title;year\nKnives Out;2019\nParasite;2019\n'))).toEqual(['Knives Out', 'Parasite']);
  });

  it('prefers a show / series column, and never mistakes an episode-title column for the show', () => {
    const text = 'Episode Title,Series Title,Season,Date\nDinner Party,The Office,4,10/2/26\nPilot,Breaking Bad,1,8/1/26\n';
    const p = engine.parseWatchHistory(text);
    expect(p.format).toBe('csv');
    // Rebuilt in Netflix's shape so the matcher knows these were episodes of a series.
    expect(raws(p)).toEqual(['The Office: Season 4: Dinner Party', 'Breaking Bad: Season 1: Pilot']);
    expect(matchedIds(p, IDX).sort()).toEqual(['tv-1396 x1', 'tv-2316 x1']);
    // An "episode" column alone is not a title column.
    expect(engine.parseWatchHistory('Episode Name,Date\nPilot,1/1/26\n').format).not.toBe('csv');
  });

  it('a table with a title column and an episode column treats the title as the show; films have no episode', () => {
    // The layout of a community Prime Video exporter (not an official export).
    const text = 'Date Watched,Type,Title,Episode Title\n2026-05-01,Series,Ted Lasso,Biscuits\n2026-05-02,Movie,Parasite,\n';
    expect(raws(engine.parseWatchHistory(text))).toEqual(['Ted Lasso: Biscuits', 'Parasite']);
  });

  it('ignores columns that only sound like titles (profile name, device name...)', () => {
    const text = 'Profile Name,Device Name,Program Title,Start Time\nHG,Living Room,Seinfeld,2026-01-05T20:00:00Z\n';
    expect(engine.parseWatchHistory(text).rows).toEqual([{ raw: 'Seinfeld', at: day('2026-01-05') }]);
  });

  it('a headerless table is accepted only when one column is plainly dates', () => {
    expect(engine.parseWatchHistory('"Paddington 2",6/15/26\n"Parasite",5/5/26\n').rows).toEqual([
      { raw: 'Paddington 2', at: day('2026-06-15') },
      { raw: 'Parasite', at: day('2026-05-05') },
    ]);
  });
});

describe('parseWatchHistory: JSON', () => {
  it('reads an array of objects with a title-like field and an optional date', () => {
    const text = JSON.stringify([
      { title: 'Seinfeld', watchedAt: '2026-02-03T10:00:00Z' },
      { title: 'Parasite', watchedAt: 1767268800000 }, // 1 Jan 2026 (milliseconds)
      { title: 'Friends' },
      { id: 5 },
    ]);
    expect(engine.parseWatchHistory(text, 'history.json')).toEqual({
      format: 'json',
      rows: [{ raw: 'Seinfeld', at: day('2026-02-03') }, { raw: 'Parasite', at: day('2026-01-01') }, { raw: 'Friends' }],
    });
  });

  it('finds the records inside a wrapper object, uses the series name, and understands other field spellings', () => {
    const text = JSON.stringify({
      account: { profileName: 'BG' },
      viewingHistory: [
        { seriesTitle: 'Breaking Bad', episodeTitle: 'Ozymandias', seasonNumber: 5, date_watched: '2026-09-20' },
        { series_name: 'Ted Lasso', episode_name: 'Biscuits', timestamp: 1775044800 }, // seconds
        { name: 'Parasite', type: 'movie' },
      ],
    });
    const p = engine.parseWatchHistory(text);
    expect(p.format).toBe('json');
    expect(raws(p)).toEqual(['Breaking Bad: Season 5: Ozymandias', 'Ted Lasso: Biscuits', 'Parasite']);
    expect(p.rows[0].at).toBe(day('2026-09-20'));
    expect(typeof p.rows[1].at).toBe('number');
    expect(matchedIds(p, IDX).sort()).toEqual(['movie-496243 x1', 'tv-1396 x1', 'tv-97546 x1']);
  });

  it('reads one JSON object per line, and a plain array of names', () => {
    expect(raws(engine.parseWatchHistory('{"title":"Seinfeld"}\n{"title":"Friends"}\n'))).toEqual(['Seinfeld', 'Friends']);
    expect(engine.parseWatchHistory('["Seinfeld", "Friends"]')).toEqual({ format: 'json', rows: [{ raw: 'Seinfeld' }, { raw: 'Friends' }] });
  });

  it('JSON with nothing title-like in it is unknown', () => {
    expect(engine.parseWatchHistory('{"a":1,"b":[1,2,3]}')).toEqual({ format: 'unknown', rows: [] });
    expect(engine.parseWatchHistory('[]')).toEqual({ format: 'unknown', rows: [] });
    expect(engine.parseWatchHistory('[{"id":1},{"id":2}]')).toEqual({ format: 'unknown', rows: [] });
  });
});

describe('parseWatchHistory: pasted lists and rubbish', () => {
  it('reads plain text with one title per line, tidying bullets, numbering and quotes', () => {
    const text = '\n  Seinfeld \n- Friends\n• Parasite\n3. Knives Out\n4) "Paddington 2"\n\nLove, Death & Robots\n';
    expect(engine.parseWatchHistory(text)).toEqual({
      format: 'list',
      rows: ['Seinfeld', 'Friends', 'Parasite', 'Knives Out', 'Paddington 2', 'Love, Death & Robots'].map((raw) => ({ raw })),
    });
    expect(engine.parseWatchHistory('Seinfeld')).toEqual({ format: 'list', rows: [{ raw: 'Seinfeld' }] });
    // Titles that look odd are still titles.
    expect(raws(engine.parseWatchHistory('[REC]\n9-1-1\n1917\n{not json'))).toEqual(['[REC]', '9-1-1', '1917', '{not json']);
  });

  it('never throws: unreadable input gives format "unknown" and no rows', () => {
    const unknown = { format: 'unknown', rows: [] };
    const junk: unknown[] = ['', '   \n\t ', '﻿', 'PK\u0003\u0004\u0014\u0000\u0008\u0000binary', '%PDF-1.7 ...', '<!DOCTYPE html><html><body>Sign in</body></html>', '\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007', '��������', null, undefined, 42, {}, []];
    for (const j of junk) expect(engine.parseWatchHistory(j as string), JSON.stringify(j)).toEqual(unknown);
    // Awkward but harmless input must not throw either.
    for (const s of ['"', '""', ',', ',,,\n,,,', 'Title,Date', 'Title,Date\n', '{', '[', '{"title":', '"unterminated\nquote,1/1/26\nmore', 'a'.repeat(5000), '\n'.repeat(1000)]) {
      expect(() => engine.parseWatchHistory(s)).not.toThrow();
    }
    expect(engine.parseWatchHistory('Title,Date')).toEqual({ format: 'netflix', rows: [] });
    expect(engine.matchWatchHistory(engine.parseWatchHistory('Title,Date'), IDX)).toEqual({ matched: [], unmatched: [] });
  });

  it('the result is the same every time', () => {
    expect(engine.parseWatchHistory(FIXTURE_NETFLIX_CSV)).toEqual(engine.parseWatchHistory(FIXTURE_NETFLIX_CSV));
  });
});

// ---------------------------------------------------------------------------
describe('matchWatchHistory', () => {
  it('collapses the fixture Netflix file exactly as its comment says', () => {
    const res = engine.matchWatchHistory(engine.parseWatchHistory(FIXTURE_NETFLIX_CSV), IDX);
    const got = Object.fromEntries(res.matched.map((m) => [m.entry.id, m.plays]));
    expect(got).toEqual({
      'tv-2316': 4, // The Office — the US one
      'tv-1396': 3, // Breaking Bad
      'tv-66732': 2, // Stranger Things
      'movie-346648': 1, // Paddington 2
      'movie-496243': 1, // Parasite
      'tv-97546': 1, // Ted Lasso
      'tv-42009': 1, // Black Mirror
    });
    // Most-played first.
    expect(res.matched.slice(0, 3).map((m) => m.entry.title)).toEqual(['The Office', 'Breaking Bad', 'Stranger Things']);
    // The latest date wins, whatever the order of the rows.
    const when = Object.fromEntries(res.matched.map((m) => [m.entry.id, m.lastWatched]));
    expect(when['tv-2316']).toBe(day('2026-10-02'));
    expect(when['tv-1396']).toBe(day('2026-09-21')); // Felina (9/21) is listed after Ozymandias (9/20)
    expect(when['tv-66732']).toBe(day('2026-07-04'));
    expect(when['movie-496243']).toBe(day('2026-05-05'));
    // And the two rows that must NOT match.
    expect(res.unmatched).toEqual([
      { name: 'Completely Unknown Home Movie', plays: 1 },
      { name: 'Zzyzx Road Trip Diaries', plays: 1 },
    ]);
  });

  it('understands every way an episode row is written', () => {
    const rows = netflix(
      'Breaking Bad: Season 2: Episode 4',
      'Breaking Bad: Limited Series: Part 1',
      'Breaking Bad: Part 2: Something',
      'Breaking Bad: Volume 1: Something',
      'Breaking Bad: Collection 3: Something',
      'Breaking Bad: Series 2: Episode 1',
      'Breaking Bad: Book One: Something',
      'Breaking Bad: Breaking Bad 2: Chapter One: Something: With: Colons',
      'Breaking Bad: Chapter Two: Something',
      'Breaking Bad: Just an Episode Name',
      'Breaking Bad (U.S.): Season 1: Pilot',
      'Breaking Bad (US): Season 1: Pilot',
      'Breaking Bad (2008): Season 1: Pilot',
    );
    expect(engine.matchWatchHistory(rows, IDX)).toEqual({ matched: [expect.objectContaining({ plays: 13 })], unmatched: [] });
    expect(engine.matchWatchHistory(rows, IDX).matched[0].entry.id).toBe('tv-1396');
  });

  it('the longest name that matches wins: "Black Mirror: Bandersnatch" is the film when the lookup has it, else the show', () => {
    expect(matchedIds(netflix('Black Mirror: Bandersnatch'), IDX)).toEqual(['tv-42009 x1']);
    const withFilm = indexOf(...IDX.titles, entry('movie-569547', 'Black Mirror: Bandersnatch', { year: 2018 }));
    expect(matchedIds(netflix('Black Mirror: Bandersnatch', 'Black Mirror: Season 3: San Junipero'), withFilm).sort()).toEqual(['movie-569547 x1', 'tv-42009 x1']);
    // A film whose name ends in something that looks like a season marker is still the film.
    const dune = indexOf(entry('movie-1', 'Dune', { year: 2021 }), entry('movie-2', 'Dune: Part Two', { year: 2024 }), entry('tv-3', 'Dune', { year: 2000, popularity: 1 }));
    expect(matchedIds(netflix('Dune: Part Two'), dune)).toEqual(['movie-2 x1']);
    expect(matchedIds(netflix('Dune'), dune)).toEqual(['movie-1 x1']);
  });

  it('tidies names: case, accents, punctuation, "&" / "and", leading articles, (U.S.) / (2019), and aka names', () => {
    const index = indexOf(
      entry('tv-1', "Grey's Anatomy"),
      entry('movie-2', 'Amélie'),
      entry('tv-3', 'Love, Death & Robots'),
      entry('tv-4', 'The Crown'),
      entry('movie-5', 'Spider-Man: Into the Spider-Verse'),
      entry('tv-6', 'Money Heist', { aka: ['La Casa de Papel'] }),
      entry('movie-7', 'WALL·E'),
      entry('tv-8', 'Marvel’s Daredevil'),
    );
    const ok = (name: string, id: string) => expect(matchedIds(list(name), index), name).toEqual([`${id} x1`]);
    ok('greys anatomy', 'tv-1');
    ok('GREY’S ANATOMY', 'tv-1');
    ok('Amelie', 'movie-2');
    ok('AMÉLIE', 'movie-2');
    ok('Love Death and Robots', 'tv-3');
    ok('love, death + robots'.replace('+', '&'), 'tv-3');
    ok('Crown', 'tv-4');
    ok('The Crown (2016)', 'tv-4');
    ok('The Crown (U.S.)', 'tv-4');
    ok('Spider Man - Into the Spider Verse', 'movie-5');
    ok('la casa de papel', 'tv-6');
    ok('Wall-E', 'movie-7');
    ok("Marvel's Daredevil", 'tv-8');
    // Korean aka from the fixture.
    expect(matchedIds(list('기생충'), IDX)).toEqual(['movie-496243 x1']);
    expect(nameKey('  The   Office (U.S.) ')).toBe('office u s');
  });

  it('same-name titles: episodes go to the series, a bare Netflix row to the film, then popularity decides', () => {
    // The fixture has the series Dark (2017) and an obscure film Dark (1999).
    expect(matchedIds(netflix('Dark: Season 1: Secrets'), IDX)).toEqual(['tv-70523 x1']);
    expect(matchedIds(netflix('Dark'), IDX)).toEqual(['movie-2000001 x1']); // Netflix writes series with a colon, so this is the film
    expect(matchedIds(list('Dark'), IDX)).toEqual(['tv-70523 x1']); // a typed list says nothing: the popular one
    // Two series called The Office: the more popular (US) one, with or without "(U.S.)".
    expect(matchedIds(netflix('The Office: Season 1: Pilot'), IDX)).toEqual(['tv-2316 x1']);
    expect(matchedIds(list('The Office'), IDX)).toEqual(['tv-2316 x1']);
    // A year in brackets picks the one from that year.
    expect(matchedIds(list('The Office (2001)'), IDX)).toEqual(['tv-2996 x1']);
    expect(matchedIds(list('The Office (2005)'), IDX)).toEqual(['tv-2316 x1']);
    expect(matchedIds(list('Dark (1999)'), IDX)).toEqual(['movie-2000001 x1']);
    // "Hustle" and "The Hustle" are different films when the lookup has both.
    const hustles = indexOf(entry('movie-1', 'The Hustle', { popularity: 50 }), entry('movie-2', 'Hustle', { popularity: 5 }));
    expect(matchedIds(netflix('Hustle'), hustles)).toEqual(['movie-2 x1']);
    expect(matchedIds(netflix('The Hustle'), hustles)).toEqual(['movie-1 x1']);
  });

  it('NO LOOSE GUESSING: near misses, partial names and wrong-kind matches are left unmatched', () => {
    const index = indexOf(
      entry('movie-1', 'Avatar'),
      entry('tv-2', 'Star Trek'),
      entry('movie-3', 'Parasite'),
      entry('tv-4', 'Breaking Bad'),
      entry('tv-5', 'Friends'),
    );
    const none = (name: string) => expect(engine.matchWatchHistory(netflix(name), index).matched, name).toEqual([]);
    none('Avatar: The Last Airbender: Book 1: The Boy in the Iceberg'); // an episode can't be the film Avatar
    none('Star Trek: Picard: Season 1: Remembrance'); // the show is "Star Trek: Picard", not Star Trek
    none('Parasite: Season 1: Episode 1'); // a series we don't know, not the film
    none('Breaking Bat: Season 1: Pilot'); // a typo is not a match
    none('Breaking'); // nor a partial name
    none('Breaking Bad Things'); // nor a longer one
    none('Friends with Benefits');
    none('My Friends');
    none('');
    const res = engine.matchWatchHistory(netflix('Star Trek: Picard: Season 1: Remembrance', 'Star Trek: Picard: Season 1: Maps and Legends', 'Star Trek: Season 1: The Man Trap'), index);
    expect(res.matched.map((m) => [m.entry.id, m.plays])).toEqual([['tv-2', 1]]);
    expect(res.unmatched).toEqual([{ name: 'Star Trek: Picard', plays: 2 }]);
  });

  it('unmatched names are collapsed to the show and listed most-played first', () => {
    const res = engine.matchWatchHistory(
      netflix(
        'Unknown Show A: Season 1: One', 'Unknown Show A: Season 1: Two', 'Unknown Show A: Season 2: Three',
        'Unknown B: Ep One', 'Unknown B: Ep Two', // no season marker, but the same lead twice: a series
        'Some Special: Live at the Place', // a one-off with a colon keeps its whole name
        'Unknown Film',
        'unknown film',
      ),
      IDX,
    );
    expect(res.matched).toEqual([]);
    expect(res.unmatched).toEqual([
      { name: 'Unknown Show A', plays: 3 },
      { name: 'Unknown B', plays: 2 },
      { name: 'Unknown Film', plays: 2 },
      { name: 'Some Special: Live at the Place', plays: 1 },
    ]);
  });

  it('counts every row as a play and keeps the latest date; rows without dates are fine', () => {
    const parsed: ParsedHistory = {
      format: 'netflix',
      rows: [
        { raw: 'Friends: Season 1: Pilot', at: day('2026-01-05') },
        { raw: 'Friends: Season 1: Pilot', at: day('2026-03-05') },
        { raw: 'Friends: Season 1: Two' },
        { raw: 'Seinfeld: Season 1: One' },
      ],
    };
    const res = engine.matchWatchHistory(parsed, IDX);
    expect(res.matched).toEqual([
      { entry: expect.objectContaining({ id: 'tv-1668' }), plays: 3, lastWatched: day('2026-03-05') },
      { entry: expect.objectContaining({ id: 'tv-1400' }), plays: 1 },
    ]);
    expect('lastWatched' in res.matched[1]).toBe(false);
  });

  it('copes with empty or malformed input and an empty lookup', () => {
    expect(engine.matchWatchHistory({ format: 'unknown', rows: [] }, IDX)).toEqual({ matched: [], unmatched: [] });
    expect(engine.matchWatchHistory(list('Seinfeld'), indexOf())).toEqual({ matched: [], unmatched: [{ name: 'Seinfeld', plays: 1 }] });
    expect(() => engine.matchWatchHistory({ format: 'list', rows: [null, {}, { raw: 5 }] } as unknown as ParsedHistory, IDX)).not.toThrow();
    expect(() => engine.matchWatchHistory(list('Seinfeld'), { schema: 1, builtAt: '', titles: [null, { id: 'x' }] } as unknown as TitleIndex)).not.toThrow();
  });

  it('SPEED: 10,000 rows against a 20,000-title lookup in well under a second, and faster again once warm', () => {
    const words = ['Dark', 'Blue', 'River', 'Last', 'House', 'Night', 'Star', 'Lost', 'City', 'Winter', 'Glass', 'Iron', 'Secret', 'Wild', 'Red', 'Stone', 'Echo', 'North', 'Silver', 'Storm'];
    const name = (n: number) => `${n % 3 === 0 ? 'The ' : ''}${words[n % 20]} ${words[(n * 7 + 3) % 20]} ${words[(n * 13 + 5) % 20]} ${n}`;
    const titles: TitleIndexEntry[] = [];
    for (let n = 0; n < 20_000; n++) titles.push(entry(`${n % 4 === 0 ? 'movie' : 'tv'}-${n}`, name(n), { popularity: n % 500, aka: n % 5 === 0 ? [`Alt ${name(n)}`] : undefined }));
    const big = indexOf(...titles);
    const rows = [];
    for (let k = 0; k < 10_000; k++) {
      const n = (k * 37) % 26_000; // about a quarter of the rows are titles the lookup doesn't have
      rows.push({ raw: n % 4 === 0 ? name(n) : `${name(n)}: Season ${1 + (k % 6)}: Episode ${k}`, at: day('2026-01-01') + k });
    }
    const parsed: ParsedHistory = { format: 'netflix', rows };
    const t0 = performance.now();
    const res = engine.matchWatchHistory(parsed, big);
    const cold = performance.now() - t0;
    const t1 = performance.now();
    engine.matchWatchHistory(parsed, big);
    const warm = performance.now() - t1;
    expect(res.matched.reduce((s, m) => s + m.plays, 0)).toBeGreaterThan(7000);
    expect(res.unmatched.length).toBeGreaterThan(1000);
    expect(cold).toBeLessThan(1000);
    expect(warm).toBeLessThan(400);
    // And reading a 10,000-line file is quick too.
    const text = 'Title,Date\n' + rows.map((r) => `"${r.raw}",10/2/26`).join('\n');
    const t2 = performance.now();
    expect(engine.parseWatchHistory(text).rows).toHaveLength(10_000);
    expect(performance.now() - t2).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
describe('learnFromImport', () => {
  const base = engine.defaultProfile('BG', C);
  const imported = (id: string, plays: number): ImportedTitle => ({ entry: IDX.titles.find((t) => t.id === id)!, plays });
  // A history that is mostly films: romance and romantic comedy, a little action.
  const filmNight: ImportedTitle[] = [
    imported('movie-11036', 2), // The Notebook
    imported('movie-455207', 3), // Crazy Rich Asians
    imported('movie-13', 1), // Forrest Gump
    imported('movie-346648', 1), // Paddington 2
    imported('movie-505600', 1), // Booksmart
    imported('movie-8363', 1), // Superbad
    imported('movie-354912', 2), // Coco
    imported('tv-91239', 8), // Bridgerton
    imported('tv-89905', 12), // Normal People
  ];
  const impKeys = (p: typeof base) => Object.keys(p.taste.traits).filter((k) => k.startsWith('imp:'));

  it('returns an updated copy; the profile given, swipe learning and corrections are untouched', () => {
    let p = engine.correctTaste(base, 'genre:romance', 'less');
    p = engine.learnFromSwipe(p, C.items.find((i) => i.id === 'tv-68595')!, 'yes', C);
    const frozen = JSON.stringify(p);
    const next = engine.learnFromImport(p, filmNight, C);
    expect(JSON.stringify(p)).toBe(frozen);
    expect(next).not.toBe(p);
    expect(next.taste.corrections).toEqual({ 'genre:romance': 'less' });
    expect(next.taste.genres).toEqual(p.taste.genres);
    expect(next.taste.keywords).toEqual(p.taste.keywords);
    for (const [k, v] of Object.entries(p.taste.traits)) expect(next.taste.traits[k]).toBe(v);
    expect(next.favorites).toEqual(p.favorites);
    expect(next.dealbreakers).toEqual(p.dealbreakers);
    expect(impKeys(next).length).toBeGreaterThan(3);
  });

  it('learns what the history is full of, within bounds', () => {
    const p = engine.learnFromImport(base, filmNight, C);
    const t = p.taste.traits;
    expect(t['imp:g:romance']).toBeGreaterThan(0.1);
    expect(t['imp:g:comedy']).toBeGreaterThan(0.05);
    expect(t['imp:g:romance']).toBeGreaterThan(t['imp:g:action'] ?? 0);
    expect(t['imp:g:horror']).toBeUndefined(); // nothing is learned about what isn't there — and nothing negative, ever
    expect(t['imp:t:kind:movie']).toBeGreaterThan(0.05); // she watches films too (her favourites are all series)
    expect(t['imp:k:based on novel']).toBeGreaterThan(0.03); // a theme several of them share
    for (const k of impKeys(p)) {
      const max = k.startsWith('imp:g:') ? IMPORT_MAX_GENRE : k.startsWith('imp:k:') ? IMPORT_MAX_KEYWORD : IMPORT_MAX_TRAIT;
      expect(t[k], k).toBeGreaterThan(0);
      expect(t[k], k).toBeLessThanOrEqual(max);
    }
    expect(impKeys(p).filter((k) => k.startsWith('imp:k:')).length).toBeLessThanOrEqual(IMPORT_MAX_KEYWORDS);
  });

  it('IMPORTING THE SAME FILE TWICE changes nothing at all', () => {
    const once = engine.learnFromImport(base, filmNight, C);
    const twice = engine.learnFromImport(once, filmNight, C);
    expect(twice).toEqual(once);
    expect(engine.learnFromImport(twice, filmNight, C)).toEqual(once);
    // ...and the decks are identical too.
    const deck = (p: typeof base) => {
      const ctx = makeCtx();
      ctx.state.profiles.BG = p;
      return engine.buildDeck(req({ who: 'BG', mood: 'romantic', novelty: 'new' }), ctx, { limit: 100 });
    };
    expect(deck(twice)).toEqual(deck(once));
  });

  it('a second, different history adds its strong points without wiping or stacking the first', () => {
    const realityBinge: ImportedTitle[] = [imported('tv-91768', 30), imported('tv-69478', 20), imported('tv-14658', 25), imported('tv-205715', 9), imported('tv-87012', 40)];
    const a = engine.learnFromImport(base, filmNight, C);
    const ab = engine.learnFromImport(a, realityBinge, C);
    const ba = engine.learnFromImport(engine.learnFromImport(base, realityBinge, C), filmNight, C);
    expect(ab).toEqual(ba); // the order of imports does not matter
    expect(ab.taste.traits['imp:g:romance']).toBe(a.taste.traits['imp:g:romance']); // the first is kept
    expect(ab.taste.traits['imp:g:reality']).toBeGreaterThan(0.1); // the second is added
    for (const k of impKeys(ab)) expect(ab.taste.traits[k]).toBeLessThanOrEqual(0.5); // nothing stacked past the bound
  });

  it('plays count with diminishing returns: one long binge cannot swamp everything else', () => {
    expect(titleWeight(1)).toBe(1);
    expect(titleWeight(3)).toBe(2);
    expect(titleWeight(7)).toBe(3);
    expect(titleWeight(31)).toBe(5);
    expect(titleWeight(200)).toBe(5);
    expect(titleWeight(200_000)).toBe(5);
    expect(titleWeight(0)).toBe(1);
    expect(titleWeight(Number.NaN)).toBe(1);
    // Ten romance films, then the same with a 500-episode reality binge on top: romance is still clearly there.
    const films = ['movie-11036', 'movie-455207', 'movie-13', 'tv-91239', 'tv-89905'].map((id) => imported(id, 1));
    const plain = engine.learnFromImport(base, films, C).taste.traits;
    const binged = engine.learnFromImport(base, [...films, imported('tv-91768', 500)], C).taste.traits;
    expect(binged['imp:g:romance']).toBeGreaterThan(plain['imp:g:romance'] * 0.6);
    // And 500 plays teach no more than 31 do.
    expect(engine.learnFromImport(base, [...films, imported('tv-91768', 31)], C)).toEqual(engine.learnFromImport(base, [...films, imported('tv-91768', 500)], C));
  });

  it('a few titles teach little; a long history teaches a lot', () => {
    const few = engine.learnFromImport(base, filmNight.slice(0, 3), C).taste.traits['imp:g:romance'] ?? 0;
    const many = engine.learnFromImport(base, filmNight, C).taste.traits['imp:g:romance'] ?? 0;
    expect(many).toBeGreaterThan(few);
    const huge: ImportedTitle[] = Array.from({ length: 150 }, (_, k) => ({
      entry: { id: `movie-${9000 + k}`, kind: 'movie', title: `Romance ${k}`, year: 2010, genres: ['romance', 'comedy'], keywords: [], popularity: 1 },
      plays: 1,
    }));
    const t = engine.learnFromImport(base, huge, C).taste.traits;
    expect(t['imp:g:romance']).toBeGreaterThan(0.4);
    expect(t['imp:g:romance']).toBeLessThanOrEqual(IMPORT_MAX_GENRE);
    expect(t['imp:t:kind:movie']).toBeGreaterThan(0.25);
  });

  it('titles with no keywords, and titles that are not in our catalog, still contribute genres and film-vs-series', () => {
    const offCatalog: ImportedTitle[] = Array.from({ length: 12 }, (_, k) => ({
      entry: { id: `movie-${7000 + k}`, kind: 'movie', title: `Western ${k}`, year: 1965, genres: ['western'], keywords: [], popularity: 1 },
      plays: 1,
    }));
    const t = engine.learnFromImport(engine.defaultProfile('HG', C), offCatalog, C).taste.traits;
    expect(t['imp:g:western']).toBeGreaterThan(0.2);
    expect(t['imp:t:kind:movie']).toBeGreaterThan(0.1);
    expect(Object.keys(t).filter((k) => k.startsWith('imp:k:'))).toEqual([]);
  });

  it('moves the deck meaningfully: BG (all-series favourites) starts getting the kind of films she watches', () => {
    const r = req({ who: 'BG', mood: 'romantic', time: 'any', novelty: 'new' });
    const before = engine.buildDeck(r, makeCtx(), { limit: 100 });
    const ctx = makeCtx();
    ctx.state.profiles.BG = engine.learnFromImport(base, filmNight, C);
    const after = engine.buildDeck(r, ctx, { limit: 100 });
    const score = (deck: typeof before, id: string) => deck.find((c) => c.itemId === id)!.score;
    for (const id of ['movie-11036', 'movie-455207']) expect(score(after, id), id).toBeGreaterThan(score(before, id) + 0.04);
    // ...by more than a single right-swipe would, but not so much that taste from favourites stops mattering.
    const swiped = makeCtx();
    swiped.state.profiles.BG = engine.learnFromSwipe(base, C.items.find((i) => i.id === 'movie-11036')!, 'yes', C);
    const afterSwipe = engine.buildDeck(r, swiped, { limit: 100 });
    expect(score(after, 'movie-455207') - score(before, 'movie-455207')).toBeGreaterThan(score(afterSwipe, 'movie-455207') - score(before, 'movie-455207'));
    expect(score(after, 'movie-455207') - score(before, 'movie-455207')).toBeLessThan(0.3);
  });

  it('a manual correction still outranks what an import taught', () => {
    const r = req({ who: 'BG', mood: 'romantic', time: 'any', novelty: 'new' });
    const ctx = makeCtx();
    ctx.state.profiles.BG = engine.learnFromImport(base, filmNight, C);
    const liked = engine.buildDeck(r, ctx, { limit: 100 });
    ctx.state.profiles.BG = engine.correctTaste(ctx.state.profiles.BG, 'genre:romance', 'less');
    const corrected = engine.buildDeck(r, ctx, { limit: 100 });
    const score = (deck: typeof liked, id: string) => deck.find((c) => c.itemId === id)!.score;
    expect(score(corrected, 'movie-11036')).toBeLessThan(score(liked, 'movie-11036') - 0.2);
    const line = engine.describeTaste(ctx.state.profiles.BG, C).find((l) => l.key === 'genre:romance')!;
    expect(line).toMatchObject({ correction: 'less', source: 'corrected', text: 'Less romance, as you asked' });
  });

  it('swipes after an import do not wear the import away, and swipe learning still works on top', () => {
    let p = engine.learnFromImport(base, filmNight, C);
    const imp = Object.fromEntries(impKeys(p).map((k) => [k, p.taste.traits[k]]));
    for (let k = 0; k < 200; k++) p = engine.learnFromSwipe(p, C.items[k % C.items.length], k % 3 ? 'yes' : 'never', C);
    for (const [k, v] of Object.entries(imp)) expect(p.taste.traits[k], k).toBe(v);
    expect(Object.keys(p.taste.genres).length).toBeGreaterThan(3);
  });

  it('describeTaste reads sensibly afterwards', () => {
    const p = engine.learnFromImport(base, filmNight, C);
    const lines = engine.describeTaste(p, C);
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines.length).toBeLessThanOrEqual(16);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
    expect(new Set(lines.map((l) => l.text)).size).toBe(lines.length);
    for (let k = 1; k < lines.length; k++) expect(Math.abs(lines[k].strength)).toBeLessThanOrEqual(Math.abs(lines[k - 1].strength));
    for (const l of lines) {
      expect(l.key).toMatch(/^(genre|keyword|trait):.+/);
      expect(l.key).not.toMatch(/imp:/); // the storage namespace never leaks onto the page
      expect(l.text).toMatch(/^[A-Z]/);
      expect(l.text).not.toMatch(/\d|undefined|NaN|:|_|imp/);
      expect(l.strength).toBeGreaterThanOrEqual(-1);
      expect(l.strength).toBeLessThanOrEqual(1);
    }
    // Romance was not something her favourites showed strongly; the history now says so in history words, not swipe words.
    const romance = lines.find((l) => l.key === 'genre:romance')!;
    expect(romance.strength).toBeGreaterThan(engine.describeTaste(base, C).find((l) => l.key === 'genre:romance')?.strength ?? 0);
    const fromHistory = lines.filter((l) => /^You (watch a lot of|often watch|often go for) /.test(l.text));
    expect(fromHistory.length).toBeGreaterThanOrEqual(1);
    for (const l of fromHistory) expect(l.source).toBe('learned');
    expect(lines.some((l) => /saying yes to/.test(l.text))).toBe(false); // she hasn't swiped at all
    // The lines can be corrected like any other.
    const fixed = engine.describeTaste(engine.correctTaste(p, fromHistory[0].key, 'less'), C).find((l) => l.key === fromHistory[0].key)!;
    expect(fixed.correction).toBe('less');
  });

  it('a history full of an acquired taste (anime) switches that taste on', () => {
    const anime: ImportedTitle[] = Array.from({ length: 8 }, (_, k) => ({
      entry: { id: `tv-${6000 + k}`, kind: 'tv', title: `Anime ${k}`, year: 2015, genres: ['animation', 'action'], keywords: ['anime', 'based on manga'], popularity: 1 },
      plays: 12,
    }));
    const hg = engine.defaultProfile('HG', C);
    expect(engine.describeTaste(hg, C).find((l) => l.key === 'keyword:anime')?.strength ?? -1).toBeLessThan(0);
    const after = engine.learnFromImport(hg, anime, C);
    expect(after.taste.traits['imp:k:anime']).toBeGreaterThan(0.15);
    // The taste page no longer says he avoids it (the line turns positive, or makes way for stronger ones).
    expect(engine.describeTaste(after, C).find((l) => l.key === 'keyword:anime')?.strength ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('copes with nothing to learn from', () => {
    expect(engine.learnFromImport(base, [], C)).toEqual(base);
    expect(engine.learnFromImport(base, [null, {}, { plays: 3 }] as unknown as ImportedTitle[], C)).toEqual(base);
    expect(engine.learnFromImport(base, [], C)).not.toBe(base);
  });

  it('end to end: file -> rows -> titles -> taste, on the sample Netflix history', () => {
    const res = engine.matchWatchHistory(engine.parseWatchHistory(sampleNetflixHistory()), IDX);
    expect(res.matched.length).toBeGreaterThan(15);
    const p = engine.learnFromImport(engine.defaultProfile('HG', C), res.matched, C);
    expect(impKeys(p).length).toBeGreaterThan(3);
    expect(engine.learnFromImport(p, res.matched, C)).toEqual(p);
    expect(JSON.stringify(p.taste).length).toBeLessThan(4000); // stays small enough to sync
  });
});

// ---------------------------------------------------------------------------
describe('searchTitles', () => {
  const titles = (q: string, limit = 10) => engine.searchTitles(q, IDX, limit).map((e) => `${e.title} (${e.year})`);

  it('finds by the start of the name, ignoring a leading The, best-known first', () => {
    expect(titles('off')).toEqual(['The Office (2005)', 'The Office (2001)']);
    expect(titles('the off')).toEqual(['The Office (2005)', 'The Office (2001)']);
    expect(titles('THE OFFICE')).toEqual(['The Office (2005)', 'The Office (2001)']);
    expect(titles('break')).toEqual(['Breaking Bad (2008)']);
  });

  it('an exact name beats names that merely start with it, which beat later-word and inside matches', () => {
    const index = indexOf(
      entry('tv-1', 'You', { popularity: 5 }),
      entry('tv-2', 'Younger', { popularity: 500 }),
      entry('movie-3', 'Me Before You', { popularity: 900 }),
      entry('movie-4', 'Bayou Nights', { popularity: 999 }),
    );
    expect(engine.searchTitles('you', index, 10).map((e) => e.title)).toEqual(['You', 'Younger', 'Me Before You', 'Bayou Nights']);
    expect(engine.searchTitles('yo', index, 10).map((e) => e.title)).toEqual(['Younger', 'You', 'Me Before You']); // inside matches need 3+ letters
  });

  it('finds by a later word, by something inside the name, and by an aka name', () => {
    expect(titles('anatomy')).toEqual(["Grey's Anatomy (2005)"]);
    expect(titles('natom')).toEqual(["Grey's Anatomy (2005)"]);
    expect(titles('greys an')).toEqual(["Grey's Anatomy (2005)"]);
    expect(titles('gisaeng')).toEqual(['Parasite (2019)']);
    expect(titles('기생')).toEqual(['Parasite (2019)']);
    expect(titles('baking show')).toEqual(['The Great British Baking Show (2010)']);
  });

  it('ignores case, accents and punctuation, and finds titles that are not on our services', () => {
    expect(titles('SPIDER MAN into')).toEqual(['Spider-Man: Into the Spider-Verse (2018)']);
    expect(titles("bob's b")).toEqual(["Bob's Burgers (2011)"]);
    expect(titles('bobs b')).toEqual(["Bob's Burgers (2011)"]);
    expect(titles('ted')).toEqual(['Ted Lasso (2020)']);
    expect(titles('seinf')).toEqual(['Seinfeld (1989)']);
  });

  it('honours the limit, never repeats a title, and returns nothing for an empty or hopeless query', () => {
    const many = engine.searchTitles('the', IDX, 5);
    expect(many).toHaveLength(5);
    const all = engine.searchTitles('the', IDX, 500);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(8);
    for (const q of ['', '   ', '!!!', 'zzzzqqq']) expect(engine.searchTitles(q, IDX, 10), q).toEqual([]);
    expect(engine.searchTitles('office', IDX, 0)).toEqual([]);
    expect(engine.searchTitles('office', IDX, -3)).toEqual([]);
    expect(() => engine.searchTitles(undefined as unknown as string, IDX, 5)).not.toThrow();
    expect(engine.searchTitles('office', IDX, 10)).toEqual(engine.searchTitles('office', IDX, 10));
  });

  it('SPEED: quick enough to run on every keystroke against 20,000 titles', () => {
    const words = ['Dark', 'Blue', 'River', 'Last', 'House', 'Night', 'Star', 'Lost', 'City', 'Winter'];
    const titlesBig: TitleIndexEntry[] = [];
    for (let n = 0; n < 20_000; n++) titlesBig.push(entry(`tv-${n}`, `${words[n % 10]} ${words[(n * 7 + 3) % 10]} ${n}`, { popularity: n % 300, aka: n % 4 === 0 ? [`Alt ${n}`] : undefined }));
    const big = indexOf(...titlesBig);
    engine.searchTitles('d', big, 20); // builds the lookup once
    let worst = 0;
    for (const q of ['d', 'da', 'dar', 'dark', 'dark l', 'dark last', 'dark last 1', 'ver', 'zzz', 'the', 'alt 4']) {
      const t0 = performance.now();
      const res = engine.searchTitles(q, big, 20);
      worst = Math.max(worst, performance.now() - t0);
      expect(res.length).toBeLessThanOrEqual(20);
    }
    expect(worst).toBeLessThan(60);
    expect(engine.searchTitles('dark last', big, 20).length).toBeGreaterThan(0);
  });
});
