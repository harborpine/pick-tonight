/**
 * A small hand-made catalog in the exact shape the daily build produces.
 * Used by unit tests, development (?catalog=fixture) and the end-to-end tests.
 * Posters are null on purpose (no network needed); the UI must show a placeholder.
 * Data is realistic but not authoritative — do not treat ids/providers as truth.
 *
 * Deliberate edge cases (keep these when editing):
 *  - tv-1100 (How I Met Your Mother): on Hulu (ads) AND Netflix (ad-free)  -> ad-free must win.
 *  - tv-2190 (South Park): on Paramount+ and HBO Max, both with ads.
 *  - tv-120998 (Poker Face): only on Peacock Premium Plus (387)            -> not on our plan.
 *  - tv-117488 (Yellowjackets): only on Paramount+ Premium (2303)          -> not on our plan.
 *  - movie-661374 (Glass Onion): Netflix ad-free and Netflix-with-ads.
 *  - Horror / true crime / scary titles for the dealbreaker rule.
 *  - High-attention titles (Game of Thrones, Dark, Succession, Inception).
 *  - Standout episodes (Scrubs, Black Mirror, Community, The Office).
 *  - Follow-ups: recent seasons (Abbott Elementary S4, The Traitors S3, The Bear S3, Grey's Anatomy S21)
 *    and a spinoff (tv-94997 House of the Dragon, spinoff of Game of Thrones).
 *  - FIXTURE_TITLE_INDEX has two shows called "The Office" (US is more popular) and titles
 *    that are not on our services (Breaking Bad, Ted Lasso, Seinfeld, Parasite).
 */
import type { FavoriteTitle, Member, PlanSelection as Plans } from '../index';
import type {
  Attention,
  Catalog,
  CatalogItem,
  GenreId,
  MoodId,
  NewArrivals,
  StandoutEpisode,
  TitleIndex,
  TitleIndexEntry,
  TitleKind,
} from '../catalog';

interface Extra {
  dropIn?: boolean;
  standout?: StandoutEpisode[];
  horror?: boolean;
  trueCrime?: boolean;
  scary?: boolean;
  related?: string[];
  seasons?: number;
  rating?: number;
  votes?: number;
  popularity?: number;
  certification?: string;
  latestSeason?: { number: number; airDate: string };
  spinoffOf?: string[];
  lang?: string;
}

function make(
  kind: TitleKind,
  tmdbId: number,
  title: string,
  year: number,
  genres: GenreId[],
  keywords: string[],
  runtime: number,
  providers: number[],
  attention: Attention,
  moods: Partial<Record<MoodId, number>>,
  x: Extra = {},
): CatalogItem {
  return {
    id: `${kind}-${tmdbId}`,
    tmdbId,
    kind,
    title,
    year,
    genres,
    keywords,
    related: x.related ?? [],
    poster: null,
    backdrop: null,
    overview: `${title} (${year}).`,
    lang: x.lang ?? 'en',
    runtime,
    ...(kind === 'tv' ? { seasons: x.seasons ?? 5 } : {}),
    ...(x.latestSeason ? { latestSeason: x.latestSeason } : {}),
    ...(x.spinoffOf ? { spinoffOf: x.spinoffOf } : {}),
    ...(x.certification ? { certification: x.certification } : {}),
    rating: x.rating ?? 7.8,
    votes: x.votes ?? 3000,
    popularity: x.popularity ?? 60,
    providers,
    attention,
    moods,
    dropIn: x.dropIn ?? false,
    standout: x.standout ?? [],
    flags: { horror: x.horror ?? false, trueCrime: x.trueCrime ?? false, scary: x.scary ?? false },
  };
}
const tv = (...a: Parameters<typeof make> extends [unknown, ...infer R] ? R : never) => make('tv', ...a);
const movie = (...a: Parameters<typeof make> extends [unknown, ...infer R] ? R : never) => make('movie', ...a);

// Provider ids: Netflix 8, Netflix-with-ads 1796, Disney+ 337, Hulu 15, HBO Max 1899,
// Peacock Premium 386, Peacock Premium Plus 387, Paramount+ Essential 2616, Paramount+ Premium 2303.
const items: CatalogItem[] = [
  // ---- sitcoms / easy comedy (low attention, drop-in) ----
  tv(4556, 'Scrubs', 2001, ['comedy', 'drama'], ['hospital', 'sitcom', 'friendship', 'workplace comedy', 'doctor', 'surreal humor'], 22, [15], 'low',
    { laugh: 0.9, cozy: 0.8, feelgood: 0.6, brainoff: 0.6, cry: 0.3 },
    { dropIn: true, seasons: 9, rating: 8.0, votes: 2100, popularity: 120, related: ['tv-1100', 'tv-18347', 'tv-2316'], latestSeason: { number: 9, airDate: '2009-12-01' },
      standout: [{ season: 3, episode: 14, name: 'My Screw Up', runtime: 22 }] }),
  tv(1100, 'How I Met Your Mother', 2005, ['comedy', 'romance'], ['sitcom', 'friendship', 'new york city', 'dating', 'bar', 'hangout comedy'], 22, [15, 8], 'low',
    { laugh: 0.9, cozy: 0.8, romantic: 0.5, feelgood: 0.6, brainoff: 0.7 },
    { dropIn: true, seasons: 9, rating: 8.1, votes: 5200, popularity: 180, related: ['tv-1668', 'tv-4556', 'tv-18347'] }),
  tv(1434, 'Family Guy', 1999, ['animation', 'comedy'], ['adult animation', 'sitcom', 'satire', 'dysfunctional family', 'cutaway gags'], 22, [15], 'low',
    { laugh: 0.95, brainoff: 0.9, cozy: 0.5 },
    { dropIn: true, seasons: 22, rating: 7.4, votes: 4500, popularity: 400, related: ['tv-456', 'tv-2190', 'tv-32726'] }),
  tv(456, 'The Simpsons', 1989, ['animation', 'comedy', 'family'], ['adult animation', 'sitcom', 'satire', 'family', 'small town'], 22, [337], 'low',
    { laugh: 0.9, brainoff: 0.8, cozy: 0.7 },
    { dropIn: true, seasons: 35, rating: 8.0, votes: 9800, popularity: 500, related: ['tv-1434', 'tv-2190', 'tv-32726'] }),
  tv(2190, 'South Park', 1997, ['animation', 'comedy'], ['adult animation', 'satire', 'crude humor', 'small town', 'social commentary'], 22, [2616, 1899], 'low',
    { laugh: 0.95, brainoff: 0.8 },
    { dropIn: true, seasons: 26, rating: 8.4, votes: 4300, popularity: 300, related: ['tv-1434', 'tv-456'] }),
  tv(32726, "Bob's Burgers", 2011, ['animation', 'comedy', 'family'], ['adult animation', 'sitcom', 'family', 'restaurant', 'wholesome'], 22, [15], 'low',
    { laugh: 0.8, cozy: 0.9, feelgood: 0.7, brainoff: 0.8 },
    { dropIn: true, seasons: 14, rating: 8.0, votes: 1100, popularity: 150, related: ['tv-1434', 'tv-456'] }),
  tv(1668, 'Friends', 1994, ['comedy', 'romance'], ['sitcom', 'friendship', 'new york city', 'hangout comedy', 'dating'], 22, [1899], 'low',
    { laugh: 0.9, cozy: 0.95, feelgood: 0.7, brainoff: 0.8, romantic: 0.4 },
    { dropIn: true, seasons: 10, rating: 8.4, votes: 8200, popularity: 350, related: ['tv-1100', 'tv-2316'] }),
  tv(18347, 'Community', 2009, ['comedy'], ['sitcom', 'community college', 'friendship', 'meta humor', 'parody', 'ensemble cast'], 22, [8, 15, 386], 'low',
    { laugh: 0.9, cozy: 0.7, feelgood: 0.5, brainoff: 0.5 },
    { dropIn: true, seasons: 6, rating: 8.0, votes: 2300, popularity: 110, related: ['tv-4556', 'tv-8592', 'tv-2316'],
      standout: [{ season: 2, episode: 14, name: 'Advanced Dungeons & Dragons', runtime: 22 }, { season: 1, episode: 23, name: 'Modern Warfare', runtime: 22 }] }),
  tv(2316, 'The Office', 2005, ['comedy'], ['sitcom', 'workplace comedy', 'mockumentary', 'office', 'cringe comedy'], 22, [386], 'low',
    { laugh: 0.95, cozy: 0.9, brainoff: 0.8, feelgood: 0.6 },
    { dropIn: true, seasons: 9, rating: 8.6, votes: 4600, popularity: 380, related: ['tv-8592', 'tv-18347', 'tv-48891'],
      standout: [{ season: 4, episode: 13, name: 'Dinner Party', runtime: 22 }] }),
  tv(8592, 'Parks and Recreation', 2009, ['comedy'], ['sitcom', 'workplace comedy', 'mockumentary', 'small town', 'wholesome', 'politics'], 22, [386], 'low',
    { laugh: 0.9, cozy: 0.9, feelgood: 0.9, brainoff: 0.7 },
    { dropIn: true, seasons: 7, rating: 8.0, votes: 1800, popularity: 130, related: ['tv-2316', 'tv-48891', 'tv-18347'] }),
  tv(48891, 'Brooklyn Nine-Nine', 2013, ['comedy', 'crime'], ['sitcom', 'workplace comedy', 'police', 'ensemble cast', 'wholesome'], 22, [386], 'low',
    { laugh: 0.9, cozy: 0.8, feelgood: 0.8, brainoff: 0.8 },
    { dropIn: true, seasons: 8, rating: 8.2, votes: 2600, popularity: 160, related: ['tv-2316', 'tv-8592'] }),
  tv(125935, 'Abbott Elementary', 2021, ['comedy'], ['sitcom', 'workplace comedy', 'mockumentary', 'school', 'teacher', 'wholesome'], 22, [15, 1899], 'low',
    { laugh: 0.85, cozy: 0.85, feelgood: 0.9, brainoff: 0.7 },
    { dropIn: true, seasons: 4, rating: 7.6, votes: 420, popularity: 90, related: ['tv-2316', 'tv-8592'], latestSeason: { number: 4, airDate: '2026-10-07' } }),
  tv(61662, "Schitt's Creek", 2015, ['comedy'], ['sitcom', 'small town', 'riches to rags', 'family', 'wholesome', 'lgbt'], 22, [15], 'low',
    { laugh: 0.85, cozy: 0.9, feelgood: 0.95, romantic: 0.4 },
    { dropIn: false, seasons: 6, rating: 8.2, votes: 900, popularity: 80, related: ['tv-8592', 'tv-125935'] }),
  tv(1437, 'Curb Your Enthusiasm', 2000, ['comedy'], ['cringe comedy', 'improvisation', 'los angeles', 'social awkwardness', 'satire'], 30, [1899], 'low',
    { laugh: 0.95, brainoff: 0.6 },
    { dropIn: true, seasons: 12, rating: 8.1, votes: 1000, popularity: 70, related: ['tv-2316', 'tv-1400'] }),
  tv(73021, 'Disenchantment', 2018, ['animation', 'comedy', 'fantasy'], ['adult animation', 'princess', 'medieval', 'fantasy world', 'satire'], 28, [8], 'low',
    { laugh: 0.7, brainoff: 0.7, cozy: 0.5 },
    { seasons: 5, rating: 7.6, votes: 1500, popularity: 60, related: ['tv-456', 'tv-1434'] }),
  tv(82728, 'Bluey', 2018, ['animation', 'family', 'kids'], ['family', 'dog', 'wholesome', 'childhood', 'imagination'], 8, [337], 'low',
    { cozy: 0.9, feelgood: 0.95, laugh: 0.5 },
    { dropIn: true, seasons: 3, rating: 8.6, votes: 700, popularity: 200 }),

  // ---- reality / competition ----
  tv(87012, 'The Great British Baking Show', 2010, ['reality'], ['baking', 'competition', 'cooking', 'wholesome', 'british'], 58, [8], 'low',
    { cozy: 0.95, feelgood: 0.9, brainoff: 0.9 },
    { dropIn: true, seasons: 14, rating: 8.5, votes: 380, popularity: 70, related: ['tv-14658', 'tv-205715'] }),
  tv(14658, 'Survivor', 2000, ['reality'], ['competition', 'survival', 'strategy', 'island', 'social game', 'elimination'], 43, [2616], 'medium',
    { gripped: 0.7, brainoff: 0.6, hyped: 0.4 },
    { seasons: 46, rating: 7.4, votes: 420, popularity: 140, related: ['tv-205715', 'tv-222317'] }),
  tv(205715, 'The Traitors', 2023, ['reality'], ['competition', 'strategy', 'social game', 'deception', 'castle', 'elimination'], 55, [386], 'medium',
    { gripped: 0.85, brainoff: 0.5, hyped: 0.4 },
    { seasons: 3, rating: 8.0, votes: 190, popularity: 100, related: ['tv-14658', 'tv-222317'], latestSeason: { number: 3, airDate: '2026-10-05' } }),
  tv(91768, 'Love Island', 2019, ['reality', 'romance'], ['dating show', 'competition', 'villa', 'romance', 'summer'], 55, [386], 'low',
    { brainoff: 0.95, romantic: 0.5, cozy: 0.4 },
    { dropIn: true, seasons: 7, rating: 6.2, votes: 120, popularity: 160, related: ['tv-69478'] }),
  tv(69478, 'Summer House', 2017, ['reality'], ['friendship', 'summer', 'hamptons', 'dating', 'drama among friends', 'docusoap'], 43, [386], 'low',
    { brainoff: 0.95, cozy: 0.5 },
    { dropIn: true, seasons: 9, rating: 6.6, votes: 60, popularity: 55, related: ['tv-91768'] }),

  // ---- drama / gripping ----
  tv(1416, "Grey's Anatomy", 2005, ['drama', 'romance'], ['hospital', 'doctor', 'medical drama', 'romance', 'workplace drama', 'soap'], 43, [8, 15], 'medium',
    { gripped: 0.6, cry: 0.8, romantic: 0.7, cozy: 0.5 },
    { seasons: 21, rating: 8.2, votes: 10500, popularity: 600, related: ['tv-39269', 'tv-61056', 'tv-4556'], latestSeason: { number: 21, airDate: '2026-10-01' } }),
  tv(1399, 'Game of Thrones', 2011, ['drama', 'fantasy', 'action'], ['based on novel', 'dragon', 'political intrigue', 'medieval', 'war', 'epic'], 57, [1899], 'high',
    { gripped: 0.95, hyped: 0.8, think: 0.4 },
    { seasons: 8, rating: 8.5, votes: 24000, popularity: 700, certification: 'TV-MA', related: ['tv-76331', 'tv-70523'] }),
  tv(94997, 'House of the Dragon', 2022, ['drama', 'fantasy', 'action'], ['based on novel', 'dragon', 'political intrigue', 'medieval', 'civil war', 'prequel'], 60, [1899], 'high',
    { gripped: 0.9, hyped: 0.8 },
    { seasons: 2, rating: 8.4, votes: 5200, popularity: 400, certification: 'TV-MA', related: ['tv-1399'], spinoffOf: ['tv-1399'], latestSeason: { number: 2, airDate: '2024-06-16' } }),
  tv(76331, 'Succession', 2018, ['drama'], ['family business', 'power struggle', 'dark comedy', 'media empire', 'wealth', 'satire'], 60, [1899], 'high',
    { gripped: 0.9, think: 0.7, laugh: 0.3 },
    { seasons: 4, rating: 8.3, votes: 1900, popularity: 150, certification: 'TV-MA', related: ['tv-1399', 'tv-136315'] }),
  tv(136315, 'The Bear', 2022, ['drama', 'comedy'], ['restaurant', 'chef', 'chicago', 'family', 'stress', 'grief'], 30, [15], 'medium',
    { gripped: 0.8, cry: 0.5, think: 0.4 },
    { seasons: 3, rating: 8.2, votes: 1300, popularity: 170, certification: 'TV-MA', related: ['tv-76331'], latestSeason: { number: 3, airDate: '2026-09-25' } }),
  tv(93405, 'Squid Game', 2021, ['drama', 'thriller', 'mystery'], ['survival game', 'deadly game', 'korea', 'social commentary', 'debt', 'elimination'], 55, [8], 'high',
    { gripped: 0.95, hyped: 0.7, think: 0.5 },
    { seasons: 3, rating: 7.8, votes: 15000, popularity: 800, certification: 'TV-MA', related: ['tv-222317', 'tv-70523'], lang: 'ko' }),
  tv(72750, 'Killing Eve', 2018, ['drama', 'thriller', 'crime'], ['assassin', 'spy', 'cat and mouse', 'obsession', 'dark comedy', 'female lead'], 42, [8], 'medium',
    { gripped: 0.9, hyped: 0.5, laugh: 0.3 },
    { seasons: 4, rating: 8.0, votes: 1700, popularity: 90, related: ['tv-78191', 'tv-39269'] }),
  tv(91239, 'Bridgerton', 2020, ['drama', 'romance'], ['regency', 'period drama', 'romance', 'high society', 'based on novel', 'gossip'], 60, [8], 'medium',
    { romantic: 0.95, cozy: 0.6, gripped: 0.4 },
    { seasons: 3, rating: 8.1, votes: 2900, popularity: 300, related: ['tv-1395', 'tv-4586'] }),
  tv(89905, 'Normal People', 2020, ['drama', 'romance'], ['romance', 'ireland', 'coming of age', 'based on novel', 'first love', 'melancholy'], 30, [15], 'medium',
    { romantic: 0.9, cry: 0.9, think: 0.4 },
    { seasons: 1, rating: 8.1, votes: 900, popularity: 60, related: ['tv-91239'] }),
  tv(4586, 'Gilmore Girls', 2000, ['comedy', 'drama'], ['mother daughter relationship', 'small town', 'fast talking', 'coming of age', 'wholesome', 'romance'], 44, [8], 'low',
    { cozy: 0.98, feelgood: 0.8, romantic: 0.5, laugh: 0.5 },
    { seasons: 7, rating: 8.1, votes: 1700, popularity: 130, related: ['tv-1395', 'tv-61662'] }),
  tv(73586, 'Yellowstone', 2018, ['drama', 'western'], ['ranch', 'family', 'montana', 'power struggle', 'land dispute'], 50, [386], 'medium',
    { gripped: 0.8, hyped: 0.5 },
    { seasons: 5, rating: 8.2, votes: 2400, popularity: 250, certification: 'TV-MA', related: ['tv-76331'] }),
  tv(42009, 'Black Mirror', 2011, ['drama', 'scifi', 'thriller'], ['anthology', 'technology', 'dystopia', 'satire', 'twist ending', 'near future'], 60, [8], 'high',
    { think: 0.95, gripped: 0.8 },
    { seasons: 7, rating: 8.3, votes: 5200, popularity: 200, certification: 'TV-MA', related: ['tv-70523'],
      standout: [{ season: 3, episode: 4, name: 'San Junipero', runtime: 61 }] }),
  tv(70523, 'Dark', 2017, ['drama', 'scifi', 'mystery'], ['time travel', 'germany', 'missing child', 'small town', 'subtitled', 'complex plot'], 55, [8], 'high',
    { think: 0.9, gripped: 0.9 },
    { seasons: 3, rating: 8.4, votes: 6800, popularity: 140, certification: 'TV-MA', scary: true, related: ['tv-42009', 'tv-66732'], lang: 'de' }),

  // ---- scary / horror / true crime (dealbreaker fodder) ----
  tv(66732, 'Stranger Things', 2016, ['drama', 'scifi', 'mystery'], ['1980s', 'supernatural', 'monster', 'small town', 'friendship', 'kids on bikes'], 50, [8], 'medium',
    { gripped: 0.9, scared: 0.7, hyped: 0.6 },
    { seasons: 5, rating: 8.6, votes: 18000, popularity: 600, scary: true, related: ['tv-70523'] }),
  tv(72844, 'The Haunting of Hill House', 2018, ['drama', 'horror', 'mystery'], ['haunted house', 'ghost', 'family', 'grief', 'supernatural'], 55, [8], 'high',
    { scared: 0.95, gripped: 0.8, cry: 0.4 },
    { seasons: 1, rating: 8.1, votes: 2600, popularity: 80, certification: 'TV-MA', horror: true, scary: true }),
  tv(64439, 'Making a Murderer', 2015, ['documentary', 'crime'], ['true crime', 'wrongful conviction', 'murder', 'trial', 'docuseries'], 60, [8], 'medium',
    { gripped: 0.85, think: 0.7 },
    { seasons: 2, rating: 8.0, votes: 600, popularity: 40, trueCrime: true }),
  tv(4601, 'Dateline NBC', 1992, ['documentary', 'crime'], ['true crime', 'murder', 'investigation', 'news magazine'], 43, [386], 'low',
    { gripped: 0.6, brainoff: 0.5 },
    { dropIn: true, seasons: 32, rating: 7.0, votes: 90, popularity: 50, trueCrime: true }),

  // ---- documentary / learn ----
  tv(68595, 'Planet Earth II', 2016, ['documentary'], ['nature', 'wildlife', 'animals', 'bbc', 'narration'], 50, [1899], 'low',
    { think: 0.8, cozy: 0.7, feelgood: 0.5, brainoff: 0.5 },
    { dropIn: true, seasons: 1, rating: 8.8, votes: 1400, popularity: 60 }),

  // ---- not on our plans (must never be suggested with the default plans) ----
  tv(120998, 'Poker Face', 2023, ['crime', 'drama', 'mystery'], ['case of the week', 'human lie detector', 'road trip', 'murder mystery'], 55, [387], 'medium',
    { gripped: 0.8, laugh: 0.4 },
    { dropIn: true, seasons: 2, rating: 7.8, votes: 500, popularity: 90 }),
  tv(117488, 'Yellowjackets', 2021, ['drama', 'horror', 'mystery'], ['plane crash', 'survival', 'cult', 'teenage girls', 'dual timeline'], 58, [2303], 'high',
    { gripped: 0.9, scared: 0.7 },
    { seasons: 3, rating: 7.7, votes: 900, popularity: 100, certification: 'TV-MA', horror: true, scary: true }),

  // ---- movies ----
  movie(13, 'Forrest Gump', 1994, ['comedy', 'drama', 'romance'], ['based on novel', 'vietnam war', 'historical fiction', 'love of one\'s life', 'optimism', 'american history'], 142, [2616], 'medium',
    { feelgood: 0.9, cry: 0.8, cozy: 0.6 },
    { rating: 8.5, votes: 27000, popularity: 150, certification: 'PG-13' }),
  movie(70160, 'The Hunger Games', 2012, ['scifi', 'adventure', 'action'], ['dystopia', 'based on young adult novel', 'deadly game', 'survival game', 'female lead', 'revolution'], 142, [386], 'medium',
    { hyped: 0.85, gripped: 0.85 },
    { rating: 7.2, votes: 22000, popularity: 180, certification: 'PG-13', related: ['tv-93405'] }),
  movie(546554, 'Knives Out', 2019, ['comedy', 'crime', 'mystery'], ['whodunit', 'murder mystery', 'detective', 'wealthy family', 'ensemble cast', 'twist ending'], 130, [8], 'medium',
    { gripped: 0.85, laugh: 0.6, think: 0.6 },
    { rating: 7.8, votes: 12500, popularity: 110, certification: 'PG-13', related: ['movie-661374'] }),
  movie(661374, 'Glass Onion: A Knives Out Mystery', 2022, ['comedy', 'crime', 'mystery'], ['whodunit', 'murder mystery', 'detective', 'greek island', 'ensemble cast'], 139, [8, 1796], 'medium',
    { gripped: 0.8, laugh: 0.6, think: 0.5 },
    { rating: 7.0, votes: 6000, popularity: 90, certification: 'PG-13', related: ['movie-546554'] }),
  movie(346648, 'Paddington 2', 2017, ['family', 'comedy', 'adventure'], ['bear', 'london', 'wholesome', 'kindness', 'prison'], 104, [8], 'low',
    { feelgood: 0.98, cozy: 0.95, laugh: 0.7 },
    { rating: 7.5, votes: 2300, popularity: 50, certification: 'PG' }),
  movie(76341, 'Mad Max: Fury Road', 2015, ['action', 'adventure', 'scifi'], ['post-apocalyptic', 'car chase', 'desert', 'dystopia', 'female lead'], 120, [1899], 'medium',
    { hyped: 0.98, gripped: 0.8 },
    { rating: 7.6, votes: 22500, popularity: 120, certification: 'R' }),
  movie(11036, 'The Notebook', 2004, ['romance', 'drama'], ['love of one\'s life', 'based on novel', 'summer romance', 'memory', 'tearjerker'], 123, [1899], 'medium',
    { romantic: 0.98, cry: 0.95 },
    { rating: 7.9, votes: 11500, popularity: 90, certification: 'PG-13' }),
  movie(455207, 'Crazy Rich Asians', 2018, ['comedy', 'romance'], ['romantic comedy', 'wealth', 'singapore', 'wedding', 'based on novel', 'family disapproval'], 121, [1899], 'low',
    { romantic: 0.9, feelgood: 0.85, laugh: 0.7, cozy: 0.6 },
    { rating: 7.0, votes: 6500, popularity: 60, certification: 'PG-13' }),
  movie(419430, 'Get Out', 2017, ['horror', 'mystery', 'thriller'], ['racism', 'psychological horror', 'hypnosis', 'social commentary', 'twist ending'], 104, [386], 'high',
    { scared: 0.9, gripped: 0.9, think: 0.7 },
    { rating: 7.6, votes: 17000, popularity: 80, certification: 'R', horror: true, scary: true }),
  movie(27205, 'Inception', 2010, ['action', 'scifi', 'adventure'], ['dream', 'heist', 'complex plot', 'subconscious', 'mind bending'], 148, [1899], 'high',
    { think: 0.9, gripped: 0.9, hyped: 0.8 },
    { rating: 8.4, votes: 36000, popularity: 160, certification: 'PG-13' }),
  movie(8363, 'Superbad', 2007, ['comedy'], ['high school', 'coming of age', 'party', 'friendship', 'crude humor', 'teen comedy'], 113, [8], 'low',
    { laugh: 0.95, brainoff: 0.8, feelgood: 0.5 },
    { rating: 7.2, votes: 7500, popularity: 70, certification: 'R' }),
  movie(324857, 'Spider-Man: Into the Spider-Verse', 2018, ['animation', 'action', 'adventure'], ['superhero', 'multiverse', 'coming of age', 'new york city', 'based on comic'], 117, [8], 'medium',
    { hyped: 0.9, feelgood: 0.8, laugh: 0.5 },
    { rating: 8.4, votes: 15500, popularity: 130, certification: 'PG' }),
  movie(354912, 'Coco', 2017, ['animation', 'family', 'music'], ['day of the dead', 'mexico', 'family', 'music', 'afterlife', 'tearjerker'], 105, [337], 'low',
    { cry: 0.9, feelgood: 0.9, cozy: 0.7 },
    { rating: 8.2, votes: 19500, popularity: 140, certification: 'PG' }),
  movie(505600, 'Booksmart', 2019, ['comedy'], ['high school', 'coming of age', 'party', 'friendship', 'female friendship', 'teen comedy'], 102, [15], 'low',
    { laugh: 0.9, feelgood: 0.8, brainoff: 0.6 },
    { rating: 7.0, votes: 2900, popularity: 40, certification: 'R' }),
  movie(531, 'Wallace & Gromit: The Wrong Trousers', 1993, ['animation', 'comedy', 'family'], ['stop motion', 'dog', 'penguin', 'british', 'heist', 'wholesome'], 30, [8], 'low',
    { laugh: 0.8, cozy: 0.9, feelgood: 0.8 },
    { rating: 7.8, votes: 1100, popularity: 25, certification: 'G' }),
];

function ref(kind: TitleKind, tmdbId: number, title: string, year: number, genres: GenreId[], keywords: string[]): FavoriteTitle {
  return { id: `${kind}-${tmdbId}`, kind, title, year, genres, keywords, poster: null };
}

const byId = new Map(items.map((i) => [i.id, i]));

/** Favourites that are NOT in the catalog (taste signals only — they carry their own genres and keywords). */
const offCatalog: FavoriteTitle[] = [
  ref('movie', 273248, 'The Hateful Eight', 2015, ['western', 'mystery', 'drama'], ['bounty hunter', 'blizzard', 'whodunit', 'dark comedy', 'ensemble cast', 'dialogue driven']),
  ref('tv', 222317, "The Devil's Plan", 2023, ['reality'], ['competition', 'strategy', 'social game', 'puzzle', 'korea', 'elimination']),
  ref('tv', 39269, 'Scandal', 2012, ['drama'], ['political intrigue', 'washington dc', 'fixer', 'affair', 'female lead', 'soap']),
  ref('tv', 61056, 'How to Get Away with Murder', 2014, ['drama', 'crime', 'mystery'], ['lawyer', 'law school', 'murder', 'twist ending', 'female lead', 'soap']),
  ref('tv', 62816, 'Crazy Ex-Girlfriend', 2015, ['comedy'], ['musical', 'romantic comedy', 'obsession', 'female lead', 'mental health', 'satire']),
  ref('tv', 87783, 'Why Women Kill', 2019, ['comedy', 'drama', 'crime'], ['dark comedy', 'infidelity', 'marriage', 'female lead', 'soap', 'period drama']),
  ref('tv', 245927, 'Paradise', 2025, ['drama', 'thriller', 'mystery'], ['conspiracy', 'secret service', 'political intrigue', 'twist ending', 'murder mystery']),
  ref('tv', 34307, 'Shameless', 2011, ['drama', 'comedy'], ['dysfunctional family', 'chicago', 'working class', 'dark comedy', 'alcoholism']),
  ref('tv', 1395, 'Gossip Girl', 2007, ['drama', 'romance'], ['high society', 'new york city', 'gossip', 'teen drama', 'wealth', 'soap']),
  ref('tv', 78191, 'You', 2018, ['drama', 'thriller', 'crime'], ['stalker', 'obsession', 'narration', 'serial killer', 'dark romance']),
];

const offById = new Map(offCatalog.map((r) => [r.id, r]));
const fav = (id: string): FavoriteTitle => {
  const off = offById.get(id);
  if (off) return off;
  const i = byId.get(id);
  if (!i) throw new Error(`fixture: ${id} is neither a catalog item nor an off-catalog favourite`);
  return { id, kind: i.kind, title: i.title, year: i.year, genres: i.genres, keywords: i.keywords, poster: null };
};

export const FIXTURE_CATALOG: Catalog = {
  schema: 1,
  builtAt: '2026-10-10T06:00:00.000Z',
  items,
};

/**
 * A sample household for tests and development. Nothing here ships to users.
 *  - alex: comedy / adult-animation / fantasy fan, no dealbreakers.
 *  - sam:  drama / reality / competition fan; never horror, true crime or anything scary.
 *  - kit:  brand new — no favourites, no history (the "cold start" case).
 */
export const FIXTURE_MEMBERS: Record<'alex' | 'sam' | 'kit', Member> = {
  alex: { id: 'alex', name: 'Alex', joinedAt: 1 },
  sam: { id: 'sam', name: 'Sam', joinedAt: 2 },
  kit: { id: 'kit', name: 'Kit', joinedAt: 3 },
};

export const FIXTURE_FAVORITES: Record<'alex' | 'sam' | 'kit', FavoriteTitle[]> = {
  alex: (['tv-4556', 'tv-1100', 'movie-273248', 'movie-13', 'tv-1434', 'tv-456', 'tv-1437', 'tv-1416', 'movie-70160', 'tv-2190', 'tv-73021', 'tv-222317', 'tv-69478', 'tv-1399'] as string[]).map(fav),
  sam: (['tv-39269', 'tv-1416', 'tv-87012', 'tv-14658', 'tv-205715', 'tv-18347', 'tv-61056', 'tv-1434', 'tv-69478', 'tv-91768', 'tv-222317', 'tv-93405', 'tv-1100', 'tv-1668', 'tv-62816', 'tv-72750', 'tv-87783', 'tv-245927', 'tv-34307', 'tv-1395', 'tv-4586', 'tv-78191'] as string[]).map(fav),
  kit: [],
};

/** The plans the sample household has (six services; several ad tiers). */
export const FIXTURE_PLANS: Plans = {
  netflix: 'standard',
  disney: 'premium',
  hulu: 'ads',
  hbo: 'ads',
  peacock: 'premium',
  paramount: 'essential',
};

export const FIXTURE_NEW_ARRIVALS: NewArrivals = {
  schema: 1,
  builtAt: '2026-10-10T06:00:00.000Z',
  entries: [
    { itemId: 'tv-125935', type: 'season', season: 4, providers: [15, 1899], date: '2026-10-09' },
    { itemId: 'movie-661374', type: 'title', providers: [8, 1796], date: '2026-10-08' },
    { itemId: 'tv-205715', type: 'season', season: 3, providers: [386], date: '2026-10-07' },
    { itemId: 'movie-419430', type: 'title', providers: [386], date: '2026-10-06' },
    { itemId: 'tv-136315', type: 'season', season: 3, providers: [15], date: '2026-10-05' },
    { itemId: 'movie-346648', type: 'title', providers: [8], date: '2026-10-03' },
    { itemId: 'tv-120998', type: 'title', providers: [387], date: '2026-10-02' },
  ],
};

// ---------------------------------------------------------------------------
// Title lookup + a sample Netflix export, for the watch-history import
// ---------------------------------------------------------------------------

const idx = (kind: TitleKind, tmdbId: number, title: string, year: number, genres: GenreId[], keywords: string[], popularity: number, aka?: string[]): TitleIndexEntry => ({
  id: `${kind}-${tmdbId}`,
  kind,
  title,
  year,
  genres,
  keywords,
  ...(aka ? { aka } : {}),
  poster: null,
  popularity,
});

export const FIXTURE_TITLE_INDEX: TitleIndex = {
  schema: 1,
  builtAt: '2026-10-10T06:00:00.000Z',
  titles: [
    ...items.map((i): TitleIndexEntry => ({ id: i.id, kind: i.kind, title: i.title, year: i.year, genres: i.genres, keywords: i.keywords.slice(0, 6), poster: null, popularity: i.popularity })),
    ...offCatalog.map((r): TitleIndexEntry => ({ id: r.id, kind: r.kind, title: r.title, year: r.year, genres: r.genres, keywords: r.keywords.slice(0, 6), poster: null, popularity: 50 })),
    // Not on our services at all:
    idx('tv', 1396, 'Breaking Bad', 2008, ['drama', 'crime', 'thriller'], ['drug dealer', 'teacher', 'cancer', 'crime boss'], 500),
    idx('tv', 97546, 'Ted Lasso', 2020, ['comedy', 'drama'], ['football', 'coach', 'wholesome', 'london'], 150),
    idx('tv', 1400, 'Seinfeld', 1989, ['comedy'], ['sitcom', 'new york city', 'observational comedy'], 200),
    idx('movie', 496243, 'Parasite', 2019, ['thriller', 'drama', 'comedy'], ['class differences', 'korea', 'dark comedy'], 120, ['기생충', 'Gisaengchung']),
    // Same name as tv-2316 (the US one), less popular: a bare "The Office" must resolve to the US show.
    idx('tv', 2996, 'The Office', 2001, ['comedy'], ['mockumentary', 'workplace comedy', 'british'], 60),
    // Same name, different kind and year.
    idx('movie', 2000001, 'Dark', 1999, ['thriller'], [], 2),
  ],
};

/**
 * A small file in the exact layout Netflix exports (Account > Profile > Viewing activity > Download all).
 * Collapses to: The Office x4 (US), Breaking Bad x3, Stranger Things x2, Paddington 2 x1, Parasite x1,
 * Ted Lasso x1, Black Mirror x1 — and two rows that must come out UNMATCHED.
 */
export const FIXTURE_NETFLIX_CSV = `Title,Date
"The Office (U.S.): Season 4: Dinner Party",10/2/26
"The Office (U.S.): Season 2: The Dundies",9/30/26
"The Office (U.S.): Season 2: Booze Cruise",9/29/26
"The Office (U.S.): Season 1: Pilot",9/28/26
"Breaking Bad: Season 5: Ozymandias",9/20/26
"Breaking Bad: Season 5: Felina",9/21/26
"Breaking Bad: Season 1: Pilot",8/1/26
"Stranger Things: Stranger Things 2: Chapter One: MADMAX",7/4/26
"Stranger Things: Chapter One: The Vanishing of Will Byers",7/1/26
"Paddington 2",6/15/26
"Parasite",5/5/26
"Ted Lasso: Season 1: Biscuits",4/1/26
"Black Mirror: Bandersnatch",3/3/26
"Zzyzx Road Trip Diaries: Limited Series: Part 1",2/2/26
"Completely Unknown Home Movie",1/1/26
`;
