/**
 * Daily catalog build: TMDB -> public/data/catalog.json, new.json (+ pool.json for the next diff).
 * Run with `npm run catalog`. Needs env TMDB_TOKEN (a GitHub Actions secret; never on a PC).
 * Exits non-zero (so nothing is deployed) when the result looks broken.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Catalog, CatalogItem, NewArrivals, ServiceId, TasteRef, TitleKind } from '../../src/contracts/catalog';
import { ALL_PROVIDER_IDS, SEED_FAVORITE_TITLES, SERVICES } from '../../src/contracts/catalog';
import { fetchJsonOptional, TmdbClient } from './tmdb';
import { DETAIL_APPEND_MOVIE, DETAIL_APPEND_TV, parseDetail, toCatalogItem, toCore, type Parsed } from './parse';
import { DEFAULT_PROVIDERS, passesFloor, selectItems, servicesOf, SERVICE_PROVIDERS, trimTo } from './select';
import { pickStandouts, seasonsToFetch, type RawEpisode } from './standout';
import { diffArrivals, prevFromPool, type Pool, type SeedInfo } from './diff';
import { allSeedTitles, chooseSearchResult, SEED_IDS, type SeedTitle } from './seeds';
import { countByDefaultService, validateCatalog, LIMITS } from './validate';
import { isoDate, median, pMap, sleep } from './util';

const SITE = process.env.SITE_URL ?? 'https://harrisonglantz.github.io/what-to-watch';
const OUT_DIR = path.resolve('public/data');
const CACHE_DIR = path.resolve('.cache/catalog');
const TARGET = { perService: Number(process.env.PER_SERVICE ?? 620), cap: Number(process.env.CAP ?? 3400), minPerService: 380 };
const MAX_BYTES = 2_500_000;
const STANDOUT_SHOWS = 160;
const log = (...a: unknown[]) => console.log(...a);

interface Candidate {
  kind: TitleKind;
  id: number;
}

// ---------------------------------------------------------------------------
// 1. Discover candidates per provider
// ---------------------------------------------------------------------------

async function discover(tmdb: TmdbClient, today: string): Promise<Map<string, Candidate>> {
  const found = new Map<string, Candidate>();
  let skippedByFloor = 0;
  type Job = { kind: TitleKind; provider: number; sort: string; pages: number; extra: Record<string, string | number> };
  const jobs: Job[] = [];
  for (const provider of ALL_PROVIDER_IDS) {
    for (const kind of ['movie', 'tv'] as const) {
      const dateField = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
      jobs.push({ kind, provider, sort: 'popularity.desc', pages: 12, extra: {} });
      jobs.push({ kind, provider, sort: 'vote_count.desc', pages: 12, extra: {} });
      jobs.push({ kind, provider, sort: 'vote_average.desc', pages: 6, extra: { 'vote_count.gte': kind === 'movie' ? 500 : 250 } });
      const genreJobs = kind === 'tv' ? [10764, 10767, 99, 10749] : [99, 10749];
      for (const gid of genreJobs) jobs.push({ kind, provider, sort: 'popularity.desc', pages: 4, extra: { with_genres: gid, 'vote_count.gte': 20 } });
      jobs.push({ kind, provider, sort: `${dateField}.desc`, pages: 5, extra: { 'vote_count.gte': 5, [`${dateField}.lte`]: today } });
    }
  }
  const pageTasks: { job: Job; page: number }[] = jobs.flatMap((job) => Array.from({ length: job.pages }, (_, i) => ({ job, page: i + 1 })));
  const lastPage = new Map<Job, number>();
  let failed = 0;
  await pMap(
    pageTasks,
    async ({ job, page }) => {
      if ((lastPage.get(job) ?? Infinity) < page) return;
      try {
        const res = await tmdb.get<any>(`/discover/${job.kind}`, {
          watch_region: 'US',
          with_watch_providers: job.provider,
          with_watch_monetization_types: 'flatrate|ads',
          sort_by: job.sort,
          include_adult: false,
          language: 'en-US',
          page,
          ...job.extra,
        });
        if (page >= (res.total_pages ?? 1)) lastPage.set(job, res.total_pages ?? 1);
        for (const r of res.results ?? []) {
          if (r.adult) continue;
          const date = (job.kind === 'movie' ? r.release_date : r.first_air_date) || undefined;
          if (!passesFloor({ kind: job.kind, votes: r.vote_count ?? 0, rating: r.vote_average ?? 0, genreIds: r.genre_ids ?? [], date, today })) {
            skippedByFloor++;
            continue;
          }
          found.set(`${job.kind}-${r.id}`, { kind: job.kind, id: r.id });
        }
      } catch (e) {
        failed++;
        if (failed <= 5) console.warn(`discover page failed (${job.kind} provider ${job.provider} ${job.sort} p${page}): ${(e as Error).message}`);
      }
    },
    24,
  );
  log(`Discover: ${pageTasks.length} pages requested, ${failed} failed; ${found.size} candidates (${skippedByFloor} rows under the quality floor)`);
  return found;
}

// ---------------------------------------------------------------------------
// 2. Details
// ---------------------------------------------------------------------------

async function fetchParsed(tmdb: TmdbClient, kind: TitleKind, id: number): Promise<Parsed | null> {
  try {
    const d = await tmdb.get<any>(`/${kind}/${id}`, {
      language: 'en-US',
      append_to_response: kind === 'movie' ? DETAIL_APPEND_MOVIE : DETAIL_APPEND_TV,
    });
    return parseDetail(kind, d);
  } catch (e) {
    console.warn(`skip ${kind}-${id}: ${(e as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Seeds
// ---------------------------------------------------------------------------

async function resolveSeed(tmdb: TmdbClient, s: SeedTitle): Promise<number | null> {
  const fixed = SEED_IDS[s.key];
  if (fixed) return fixed;
  try {
    const res = await tmdb.get<any>(`/search/${s.kind}`, {
      query: s.hint.query ?? s.title,
      language: 'en-US',
      include_adult: false,
      ...(s.hint.year ? (s.kind === 'movie' ? { year: s.hint.year } : { first_air_date_year: s.hint.year }) : {}),
    });
    let choice = chooseSearchResult(res.results ?? [], s.kind, s.hint);
    if (!choice) {
      const retry = await tmdb.get<any>(`/search/${s.kind}`, { query: s.hint.query ?? s.title, language: 'en-US' });
      choice = chooseSearchResult(retry.results ?? [], s.kind, s.hint);
    }
    if (!choice) return null;
    const h = choice.hit;
    log(`SEED RESOLVED ${JSON.stringify(s.key)}: ${h.id}  // ${h.title ?? h.name} (${(h.release_date ?? h.first_air_date ?? '').slice(0, 4)})${choice.confident ? '' : '  [LOW CONFIDENCE]'}`);
    return h.id;
  } catch (e) {
    console.warn(`seed search failed for ${s.title}: ${(e as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4. Standout episodes
// ---------------------------------------------------------------------------

async function readCache(file: string, maxAgeDays: number): Promise<any | null> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (Date.now() - raw.at < maxAgeDays * 86_400_000) return raw.data;
  } catch {
    /* no cache */
  }
  return null;
}
async function writeCache(file: string, data: unknown) {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* cache is optional */
  }
}

async function fetchEpisodes(tmdb: TmdbClient, item: CatalogItem, maxSeasons: number): Promise<RawEpisode[] | null> {
  const total = item.seasons ?? 1;
  const file = path.join(CACHE_DIR, 'episodes', `${item.id}-s${total}-m${maxSeasons}.json`);
  const cached = await readCache(file, 30);
  if (cached) return cached;
  const wanted = seasonsToFetch(total, maxSeasons);
  const episodes: RawEpisode[] = [];
  try {
    for (let i = 0; i < wanted.length; i += 20) {
      const batch = wanted.slice(i, i + 20);
      const d = await tmdb.get<any>(`/tv/${item.tmdbId}`, { append_to_response: batch.map((n) => `season/${n}`).join(',') });
      for (const n of batch) for (const e of d[`season/${n}`]?.episodes ?? []) episodes.push(e);
    }
  } catch (e) {
    console.warn(`episodes failed for ${item.id}: ${(e as Error).message}`);
    return null;
  }
  await writeCache(file, episodes);
  return episodes;
}

async function addStandouts(tmdb: TmdbClient, items: CatalogItem[], anthologyIds: Set<string>, guessRuntime: Set<string>) {
  const shows = items
    .filter((i) => i.kind === 'tv' && (i.dropIn || anthologyIds.has(i.id)) && (i.seasons ?? 0) >= 1)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, STANDOUT_SHOWS);
  let withStandouts = 0;
  await pMap(
    shows,
    async (show) => {
      const eps = await fetchEpisodes(tmdb, show, 16);
      if (!eps) return;
      show.standout = pickStandouts(eps);
      if (show.standout.length) withStandouts++;
      if (guessRuntime.has(show.id)) fixRuntime(show, eps);
    },
    8,
  );
  // Everything else whose episode length is only a guess: sample a few seasons for the typical episode runtime.
  const others = items.filter((i) => i.kind === 'tv' && guessRuntime.has(i.id) && !shows.includes(i));
  let fixed = 0;
  await pMap(
    others,
    async (show) => {
      const eps = await fetchEpisodes(tmdb, show, 3);
      if (eps && fixRuntime(show, eps)) fixed++;
    },
    8,
  );
  log(`Episode runtimes: ${guessRuntime.size} shows had no typical length from TMDB; corrected ${fixed + shows.filter((s) => guessRuntime.has(s.id)).length}`);
  log(`Standout episodes: looked at ${shows.length} shows, ${withStandouts} have at least one`);
}

/** Typical episode length = median of real episode runtimes (ignores specials and double-length finales). */
function fixRuntime(show: CatalogItem, eps: RawEpisode[]): boolean {
  const rts = eps.filter((e) => e.season_number > 0 && (e.runtime ?? 0) > 0).map((e) => e.runtime as number);
  if (rts.length < 3) return false;
  show.runtime = Math.round(median(rts));
  return show.runtime > 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const token = process.env.TMDB_TOKEN;
  if (!token) throw new Error('TMDB_TOKEN is not set');
  const started = Date.now();
  const builtAt = new Date().toISOString();
  const today = isoDate(new Date());
  const tmdb = new TmdbClient({ token, concurrency: 14 });

  // Previous build, from the live site. 404 (first run) is fine; other errors fail the build.
  const [prevCatalog, prevNew, prevPool] = await Promise.all([
    fetchJsonOptional<Catalog>(`${SITE}/data/catalog.json`),
    fetchJsonOptional<NewArrivals>(`${SITE}/data/new.json`),
    fetchJsonOptional<Pool>(`${SITE}/data/pool.json`),
  ]);
  log(`Previous build: catalog ${prevCatalog ? prevCatalog.items.length + ' titles' : 'none (first run)'}, new.json ${prevNew ? prevNew.entries.length + ' entries' : 'none'}, pool ${prevPool ? Object.keys(prevPool.titles).length : 'none'}`);

  // Candidates and seeds
  const candidates = await discover(tmdb, today);
  const seeds = allSeedTitles();
  const seedIds = new Map<string, number | null>();
  await pMap(seeds, async (s) => void seedIds.set(s.key, await resolveSeed(tmdb, s)), 6);
  const unresolved = seeds.filter((s) => !seedIds.get(s.key));
  if (unresolved.length) console.warn(`WARNING: could not resolve seeds: ${unresolved.map((s) => s.title).join(', ')}`);

  const want = new Map<string, Candidate>(candidates);
  for (const s of seeds) {
    const id = seedIds.get(s.key);
    if (id) want.set(`${s.kind}-${id}`, { kind: s.kind, id });
  }

  // Recommendations of every seed favourite join the candidate pool (kept only if on our plans and above the floor).
  const seedRecs: Candidate[] = [];
  for (const s of seeds) {
    const id = seedIds.get(s.key);
    if (!id) continue;
    try {
      const d = await tmdb.get<any>(`/${s.kind}/${id}/recommendations`, { language: 'en-US' });
      for (const r of d.results ?? []) if (!r.adult) seedRecs.push({ kind: s.kind, id: r.id });
    } catch {
      /* optional */
    }
  }
  for (const c of seedRecs) if (!want.has(`${c.kind}-${c.id}`)) want.set(`${c.kind}-${c.id}`, c);

  // Details
  log(`Fetching details for ${want.size} titles...`);
  const parsedAll = new Map<string, Parsed>();
  let done = 0;
  await pMap(
    [...want.entries()],
    async ([key, c]) => {
      const p = await fetchParsed(tmdb, c.kind, c.id);
      if (p) parsedAll.set(key, p);
      if (++done % 1000 === 0) log(`  ${done}/${want.size} details (${Math.round((Date.now() - started) / 1000)}s)`);
    },
    40,
  );
  log(`Details: ${parsedAll.size} ok, ${want.size - parsedAll.size} skipped; ${tmdb.stats.requests} requests, ${tmdb.stats.retries} retries`);

  // Seed taste references (on our services or not)
  const tasteRefs: TasteRef[] = [];
  const seedFavorites = { HG: [] as string[], BG: [] as string[] };
  const seedKeys = new Set<string>();
  const seedOnService = new Set<string>();
  for (const s of seeds) {
    const id = seedIds.get(s.key);
    const p = id ? parsedAll.get(`${s.kind}-${id}`) : undefined;
    if (!p) continue;
    const core = toCore(p);
    if (!tasteRefs.some((r) => r.id === core.id)) tasteRefs.push(core);
    seedKeys.add(core.id);
    if (p.providers.length) seedOnService.add(core.id);
  }
  for (const who of ['HG', 'BG'] as const)
    for (const s of SEED_FAVORITE_TITLES[who]) {
      const id = seedIds.get(`${s.kind}|${s.title}`);
      if (id && seedKeys.has(`${s.kind}-${id}`)) seedFavorites[who].push(`${s.kind}-${id}`);
    }

  // Pool = everything on our providers (for the next build's diff), then the catalog is chosen from it
  const pool: Pool = { schema: 1, builtAt, titles: {} };
  const items: CatalogItem[] = [];
  const info = new Map<string, SeedInfo>();
  const anthologyIds = new Set<string>();
  const guessRuntime = new Set<string>();
  for (const [key, p] of parsedAll) {
    if (!p.providers.length || p.adult) continue;
    pool.titles[key] = { p: p.providers, ...(p.seasons ? { s: p.seasons } : {}) };
    const isSeed = seedKeys.has(key);
    // reality / talk shows get the lower rating bar
    const lenient = p.genres.includes('reality') || p.genres.includes('talk');
    const ok = passesFloor({ kind: p.kind, votes: p.votes, rating: p.rating, genreIds: lenient ? [10764] : [], date: p.releaseDate, today });
    if (!ok && !isSeed) continue;
    const item = toCatalogItem(p);
    items.push(item);
    info.set(item.id, { releaseDate: p.releaseDate, seasonPremieres: p.seasonPremieres });
    if (p.allKeywords.includes('anthology')) anthologyIds.add(item.id);
    if (p.runtimeGuess) guessRuntime.add(item.id);
  }
  log(`Eligible after quality floor: ${items.length} titles on our providers`);

  let chosen = selectItems(items, { ...TARGET, mustKeep: seedOnService });
  await addStandouts(tmdb, chosen, anthologyIds, guessRuntime);

  // Assemble, trimming until under the size budget
  const assemble = (list: CatalogItem[]): Catalog => ({ schema: 1, builtAt, items: list, tasteRefs, seedFavorites });
  let catalog = assemble(chosen);
  let json = JSON.stringify(catalog);
  while (Buffer.byteLength(json) > MAX_BYTES && chosen.length > 1200) {
    chosen = trimTo(chosen, Math.floor(chosen.length * 0.97), 300, seedOnService);
    catalog = assemble(chosen);
    json = JSON.stringify(catalog);
  }
  const bytes = Buffer.byteLength(json);

  // New arrivals
  const prev = prevFromPool(prevPool, prevCatalog);
  const diff = diffArrivals({ items: chosen, prev, prevNew, today, builtAt, info });

  // Validate BEFORE writing anything
  const problems = validateCatalog(catalog, bytes, prevCatalog?.items.length ?? null);
  printSummary(catalog, diff, bytes, started, tmdb);
  if (problems.length) {
    console.error('\nCATALOG BUILD FAILED SANITY CHECKS:\n - ' + problems.join('\n - '));
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'catalog.json'), json);
  await writeFile(path.join(OUT_DIR, 'new.json'), JSON.stringify(diff.arrivals));
  await writeFile(path.join(OUT_DIR, 'pool.json'), JSON.stringify(pool));
  log('\nWrote public/data/catalog.json, new.json, pool.json');
}

function printSummary(c: Catalog, diff: ReturnType<typeof diffArrivals>, bytes: number, started: number, tmdb: TmdbClient) {
  const count = <T,>(xs: T[], f: (x: T) => string) => {
    const m: Record<string, number> = {};
    for (const x of xs) m[f(x)] = (m[f(x)] ?? 0) + 1;
    return m;
  };
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k}=${v}`).join('  ');
  log('\n================ CATALOG SUMMARY ================');
  log(`Titles: ${c.items.length}   tasteRefs: ${c.tasteRefs.length}   size: ${bytes} bytes (${(bytes / 1_048_576).toFixed(2)} MB)`);
  log('Per service (default plan):  ' + fmt(countByDefaultService(c)));
  const anyPlan: Record<string, number> = {};
  for (const s of SERVICES) anyPlan[s.id] = c.items.filter((i) => servicesOf(i.providers, SERVICE_PROVIDERS).includes(s.id as ServiceId)).length;
  log('Per service (any plan):      ' + fmt(anyPlan));
  const perProvider: Record<string, number> = {};
  for (const p of ALL_PROVIDER_IDS) perProvider[String(p)] = c.items.filter((i) => i.providers.includes(p)).length;
  log('Per provider id:             ' + fmt(perProvider));
  log('Per kind:                    ' + fmt(count(c.items, (i) => i.kind)));
  log('Attention:                   ' + fmt(count(c.items, (i) => i.attention)));
  log(
    `Flags: horror=${c.items.filter((i) => i.flags.horror).length} trueCrime=${c.items.filter((i) => i.flags.trueCrime).length} scary=${c.items.filter((i) => i.flags.scary).length}`,
  );
  const tv = c.items.filter((i) => i.kind === 'tv');
  log(`TV: ${tv.length}  dropIn=${tv.filter((i) => i.dropIn).length}  with standout episodes=${tv.filter((i) => i.standout.length).length}`);
  log(`Seed favourites resolved: HG ${c.seedFavorites.HG.length}/14, BG ${c.seedFavorites.BG.length}/22; in catalog: ${[...new Set([...c.seedFavorites.HG, ...c.seedFavorites.BG])].filter((id) => c.items.some((i) => i.id === id)).length}`);
  log(
    `New arrivals: ${diff.arrivals.entries.length} entries in window (+${diff.addedTitles} titles, +${diff.addedSeasons} seasons this build)${diff.seeded ? ' [first build: seeded from release dates]' : ''}${diff.suspicious ? ' [WARNING: unusually many new titles; title arrivals ignored]' : ''}`,
  );
  log(`Time: ${Math.round((Date.now() - started) / 1000)}s   requests: ${tmdb.stats.requests}   retries: ${tmdb.stats.retries}   limits: min ${LIMITS.minTitles} titles, ${LIMITS.minPerDefaultService}/service`);
  log('Default-plan providers: ' + Object.entries(DEFAULT_PROVIDERS).map(([k, v]) => `${k}:[${[...v]}]`).join(' '));
  log('=================================================');
  void sleep;
}

main().catch((e) => {
  console.error('Catalog build crashed:', e);
  process.exit(1);
});
