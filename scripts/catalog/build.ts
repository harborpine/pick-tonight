/**
 * Daily catalog build: TMDB -> public/data/manifest.json, catalog/<service>.json (one per service),
 * new.json, titles.json (+ pool.json for the next build's new-arrivals diff).
 * Run with `npm run catalog`. Needs env TMDB_TOKEN (a GitHub Actions secret; never on a PC).
 * Exits non-zero (so nothing is deployed) when the result looks broken.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import type { Catalog, CatalogItem, CatalogManifest, NewArrivals, ServiceId, TitleIndex, TitleKind } from '../../src/contracts/catalog';
import { fetchJsonOptional, TmdbClient } from './tmdb';
import { DETAIL_APPEND_MOVIE, DETAIL_APPEND_TV, parseDetail, rawAlts, toCatalogItem, type Parsed } from './parse';
import { passesFloor, selectAll, trimTo, type Selection } from './select';
import { pickStandouts, seasonsToFetch, type RawEpisode } from './standout';
import { diffArrivals, prevFromPool, prevUniverse, type DateInfo, type Pool } from './diff';
import { ALL_IDS, isBigService, isChannelAddOn, MIN_SERVICE_TITLES, onPlan, SERVICES_IN_USE, validateServiceTable } from './services';
import { LIMITS, validateBuild, distinctTitles, type BuiltService } from './validate';
import { isoDate, median, pMap } from './util';
import { buildTitleIndex, titleListJobs, toListRow, trimIndexToBytes, validateTitleIndex, type AltTitle, type ListRow } from './titles';
import { findSpinoffs, KnownTitles, knownFromIndex } from './spinoff';
import { isFresh, overlayProviders, pruneStore, type DetailStore } from './detailcache';

// Derived from the repo owner and name so an account rename can't break the previous-build lookup.
const REPO_NAME = (process.env.GITHUB_REPOSITORY ?? 'harborpine/pick-tonight').split('/')[1];
const SITE = process.env.SITE_URL ?? `https://${process.env.GITHUB_REPOSITORY_OWNER ?? 'harborpine'}.github.io/${REPO_NAME}`;
const OUT_DIR = path.resolve('public/data');
const CACHE_DIR = path.resolve('.cache/catalog');
/** Per-file size budget, a little under the validation limit so a late addition can't tip it over. */
const FILE_BUDGET = 1_450_000;
const STANDOUT_SHOWS = 400;
const log = (...a: unknown[]) => console.log(...a);

interface Candidate {
  kind: TitleKind;
  id: number;
}

// ---------------------------------------------------------------------------
// 1. Discover candidates per provider
// ---------------------------------------------------------------------------

async function discover(tmdb: TmdbClient, today: string) {
  const found = new Map<string, Candidate>();
  /** key -> provider ids discovery saw it on today. */
  const observed = new Map<string, Set<number>>();
  let skippedByFloor = 0;
  type Job = { kind: TitleKind; provider: number; sort: string; pages: number; extra: Record<string, string | number> };
  const jobs: Job[] = [];
  const bigProviders = new Set(SERVICES_IN_USE.filter((s) => isBigService(s.id)).flatMap((s) => s.plans.flatMap((p) => p.providerIds)));
  for (const provider of ALL_IDS) {
    const k = bigProviders.has(provider) ? 2 : 1;
    for (const kind of ['movie', 'tv'] as const) {
      const dateField = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
      jobs.push({ kind, provider, sort: 'popularity.desc', pages: 12 * k, extra: {} });
      jobs.push({ kind, provider, sort: 'vote_count.desc', pages: 12 * k, extra: {} });
      jobs.push({ kind, provider, sort: 'vote_average.desc', pages: 6 * k, extra: { 'vote_count.gte': kind === 'movie' ? 500 : 250 } });
      const genreJobs = kind === 'tv' ? [10764, 10767, 99, 10749] : [99, 10749];
      for (const gid of genreJobs) jobs.push({ kind, provider, sort: 'popularity.desc', pages: 6, extra: { with_genres: gid, 'vote_count.gte': 5 } });
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
          const key = `${job.kind}-${r.id}`;
          found.set(key, { kind: job.kind, id: r.id });
          let set = observed.get(key);
          if (!set) observed.set(key, (set = new Set()));
          set.add(job.provider);
        }
      } catch (e) {
        failed++;
        if (failed <= 5) console.warn(`discover page failed (${job.kind} provider ${job.provider} ${job.sort} p${page}): ${(e as Error).message}`);
      }
    },
    40,
  );
  log(`Discover: ${pageTasks.length} pages requested, ${failed} failed; ${found.size} candidates (${skippedByFloor} rows under the quality floor)`);
  return { found, observed };
}

// ---------------------------------------------------------------------------
// 2. Details (cached 3-6 days per title)
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

const DETAIL_FILE = path.join(CACHE_DIR, 'details.json.gz');
async function loadDetailStore(): Promise<DetailStore> {
  try {
    return JSON.parse(gunzipSync(await readFile(DETAIL_FILE)).toString('utf8')) as DetailStore;
  } catch {
    return {};
  }
}
async function saveDetailStore(store: DetailStore) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(DETAIL_FILE, gzipSync(JSON.stringify(store)));
  } catch {
    /* cache is optional */
  }
}

// ---------------------------------------------------------------------------
// 3. Standout episodes
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
  const inShows = new Set(shows.map((s) => s.id));
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
  const others = items.filter((i) => i.kind === 'tv' && guessRuntime.has(i.id) && !inShows.has(i.id));
  let fixed = 0;
  await pMap(
    others,
    async (show) => {
      const eps = await fetchEpisodes(tmdb, show, 3);
      if (eps && fixRuntime(show, eps)) fixed++;
    },
    8,
  );
  // Half-hour sitcoms whose episodes carry no runtime data: TMDB's "30" really means ~22 minutes.
  for (const i of items) if (i.kind === 'tv' && guessRuntime.has(i.id) && i.runtime >= 26 && i.runtime <= 32 && i.keywords.includes('sitcom') && !i.genres.includes('drama')) i.runtime = 24;
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
// 4. Title name lookup (titles.json): list pages only, no per-title calls
// ---------------------------------------------------------------------------

async function fetchTitleRows(tmdb: TmdbClient): Promise<{ kind: TitleKind; row: ListRow }[]> {
  const jobs = titleListJobs();
  const rows: { kind: TitleKind; row: ListRow }[] = [];
  const toFetch: typeof jobs = [];
  let cachedJobs = 0;
  for (const job of jobs) {
    const cached = await readCache(path.join(CACHE_DIR, 'lists', `${job.name}-${job.pages}.json`), 4);
    if (cached) {
      cachedJobs++;
      for (const row of cached as ListRow[]) rows.push({ kind: job.kind, row });
    } else toFetch.push(job);
  }
  const perJob = new Map<string, ListRow[]>();
  const failedJobs = new Set<string>();
  const lastPage = new Map<string, number>();
  const tasks = toFetch.flatMap((job) => Array.from({ length: job.pages }, (_, i) => ({ job, page: i + 1 })));
  let failed = 0;
  await pMap(
    tasks,
    async ({ job, page }) => {
      if ((lastPage.get(job.name) ?? Infinity) < page) return;
      try {
        const res = await tmdb.get<any>(job.path, { ...job.params, page });
        const total = Math.min(res.total_pages ?? 1, 500);
        if (page >= total) lastPage.set(job.name, total);
        const list = perJob.get(job.name) ?? [];
        for (const r of res.results ?? []) {
          const row = toListRow(job.kind, r);
          if (row) list.push(row);
        }
        perJob.set(job.name, list);
      } catch (e) {
        failed++;
        failedJobs.add(job.name);
        if (failed <= 5) console.warn(`title list page failed (${job.name} p${page}): ${(e as Error).message}`);
      }
    },
    40,
  );
  for (const job of toFetch) {
    const list = perJob.get(job.name) ?? [];
    for (const row of list) rows.push({ kind: job.kind, row });
    if (!failedJobs.has(job.name) && list.length) await writeCache(path.join(CACHE_DIR, 'lists', `${job.name}-${job.pages}.json`), list);
  }
  log(`Title lists: ${jobs.length} jobs (${cachedJobs} from cache), ${tasks.length} pages requested, ${failed} failed; ${rows.length} rows`);
  return rows;
}

/** Alternate names for the most popular non-catalog titles: one call each, cached 30 days per title. Failures are non-fatal. */
async function fetchAltNames(tmdb: TmdbClient, ids: string[]): Promise<Map<string, AltTitle[]>> {
  const file = path.join(CACHE_DIR, 'altnames', 'alts.json');
  const store: Record<string, { at: number; alts: AltTitle[] }> = (await readCache(file, 3650)) ?? {};
  const fresh = (id: string) => store[id] && Date.now() - store[id].at < 30 * 86_400_000;
  const todo = ids.filter((id) => !fresh(id));
  let failed = 0;
  await pMap(
    todo,
    async (id) => {
      const [kind, num] = id.split('-');
      try {
        const d = await tmdb.get<any>(`/${kind}/${num}/alternative_titles`);
        store[id] = { at: Date.now(), alts: rawAlts(d) };
      } catch {
        failed++;
      }
    },
    40,
  );
  // forget stale entries nobody asked for, so the cache cannot grow without bound
  const want = new Set(ids);
  for (const id of Object.keys(store)) if (!want.has(id) && !fresh(id)) delete store[id];
  await writeCache(file, store);
  log(`Alternate names: ${ids.length} wanted, ${todo.length} fetched (${failed} failed), ${ids.length - todo.length} from cache`);
  const out = new Map<string, AltTitle[]>();
  for (const id of ids) if (store[id]) out.set(id, store[id].alts);
  return out;
}

// ---------------------------------------------------------------------------
// 5. The previous build, from the live site
// ---------------------------------------------------------------------------

async function loadPrevious() {
  const [manifest, prevNew, prevPool] = await Promise.all([
    fetchJsonOptional<CatalogManifest>(`${SITE}/data/manifest.json`),
    fetchJsonOptional<NewArrivals>(`${SITE}/data/new.json`),
    fetchJsonOptional<Pool>(`${SITE}/data/pool.json`),
  ]);
  const catalogs: Catalog[] = [];
  const perService: Record<ServiceId, number> = {};
  if (manifest) {
    for (const [id, e] of Object.entries(manifest.services)) {
      perService[id] = e.titles;
      const c = await fetchJsonOptional<Catalog>(`${SITE}/${e.file}`);
      if (c) catalogs.push(c);
    }
  }
  const total = new Set(catalogs.flatMap((c) => c.items.map((i) => i.id))).size;
  log(`Previous build: ${manifest ? `${Object.keys(perService).length} services, ${total} distinct titles` : 'none (first run)'}, new.json ${prevNew ? prevNew.entries.length + ' entries' : 'none'}, pool ${prevPool ? Object.keys(prevPool.titles).length : 'none'}`);
  return { manifest, prevNew, prevPool, catalogs, prev: manifest ? { total, perService } : null };
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

  // The services table must match TMDB's real provider list (no stale ids, no channel add-ons).
  const names = new Map<number, string>();
  for (const kind of ['movie', 'tv'] as const) {
    const res = await tmdb.get<any>(`/watch/providers/${kind}`, { watch_region: 'US', language: 'en-US' });
    for (const p of res.results ?? []) names.set(p.provider_id, p.provider_name);
  }
  const tableProblems = validateServiceTable(SERVICES_IN_USE, names);
  if (tableProblems.length) {
    console.error('SERVICES TABLE PROBLEMS:\n - ' + tableProblems.join('\n - '));
    process.exit(1);
  }
  void isChannelAddOn;

  const previous = await loadPrevious();

  // Candidates and details
  const { found: want, observed } = await discover(tmdb, today);
  log(`Fetching details for ${want.size} titles...`);
  const store = await loadDetailStore();
  const now = Date.now();
  const parsedAll = new Map<string, Parsed>();
  let done = 0;
  let fetchedCount = 0;
  await pMap(
    [...want.entries()],
    async ([key, c]) => {
      const cached = store[key];
      let p: Parsed | null = null;
      if (isFresh(cached, key, now)) p = cached.parsed;
      else {
        p = await fetchParsed(tmdb, c.kind, c.id);
        fetchedCount++;
        if (p) store[key] = { at: Date.now(), parsed: p };
      }
      if (p) parsedAll.set(key, overlayProviders(p, observed.get(key)));
      if (++done % 2000 === 0) log(`  ${done}/${want.size} details (${Math.round((Date.now() - started) / 1000)}s)`);
    },
    40,
  );
  const dropped = pruneStore(store, new Set(want.keys()), now);
  await saveDetailStore(store);
  log(`Details: ${parsedAll.size} ok, ${want.size - parsedAll.size} skipped; ${fetchedCount} fetched, ${want.size - fetchedCount} from cache (${dropped} stale cache entries dropped); ${tmdb.stats.requests} requests, ${tmdb.stats.retries} retries`);

  // Pool = everything on our providers (for the next build's diff), then each service's titles are chosen from it
  const pool: Pool = { schema: 1, builtAt, ids: ALL_IDS, titles: {} };
  const eligible: CatalogItem[] = [];
  const info = new Map<string, DateInfo>();
  const anthologyIds = new Set<string>();
  const guessRuntime = new Set<string>();
  for (const [key, p] of parsedAll) {
    if (!p.providers.length || p.adult) continue;
    pool.titles[key] = { p: p.providers, ...(p.seasons ? { s: p.seasons } : {}) };
    const lenient = p.genres.includes('reality') || p.genres.includes('talk');
    if (!passesFloor({ kind: p.kind, votes: p.votes, rating: p.rating, genreIds: lenient ? [10764] : [], date: p.releaseDate, today })) continue;
    const item = toCatalogItem(p, today);
    eligible.push(item);
    info.set(item.id, { releaseDate: p.releaseDate, seasonPremieres: p.seasonPremieres });
    if (p.allKeywords.includes('anthology')) anthologyIds.add(item.id);
    if (p.runtimeGuess) guessRuntime.add(item.id);
  }
  log(`Eligible after quality floor: ${eligible.length} titles on our providers`);

  // Per-service selection
  const selections = selectAll(eligible, SERVICES_IN_USE.map((s) => s.id));
  const published = new Map<ServiceId, Selection>();
  const left: string[] = [];
  for (const [id, sel] of selections) {
    if (sel.items.length >= MIN_SERVICE_TITLES) published.set(id, sel);
    else left.push(`${id} (${sel.items.length})`);
  }
  if (left.length) log(`Left out (under ${MIN_SERVICE_TITLES} titles): ${left.join(', ')}`);
  const unionMap = new Map<string, CatalogItem>();
  for (const sel of published.values()) for (const i of sel.items) unionMap.set(i.id, i);
  const union = [...unionMap.values()];
  log(`Selected ${union.length} distinct titles over ${published.size} services`);

  await addStandouts(tmdb, union, anthologyIds, guessRuntime);

  // Title name lookup rows (cached), then spinoff links (which use the lookup as their list of well-known shows)
  const listRows = await fetchTitleRows(tmdb);
  const originals = new Map<string, string>();
  for (const [key, p] of parsedAll) if (p.originalTitle) originals.set(key, p.originalTitle);
  const wideIndex = buildTitleIndex({ items: union, originals, listRows });
  const known = new KnownTitles(knownFromIndex(wideIndex));
  const children = union
    .filter((i) => i.kind === 'tv')
    .map((i) => ({ id: i.id, title: i.title, year: i.year, keywords: parsedAll.get(i.id)?.allKeywords ?? i.keywords, related: parsedAll.get(i.id)?.related ?? i.related }));
  const curatedNotes: string[] = [];
  const spinLinks = findSpinoffs(children, known, 3, curatedNotes);
  for (const n of curatedNotes) log(`  CURATED NOTE: ${n}`);
  for (const l of spinLinks) unionMap.get(l.childId)!.spinoffOf = l.parentIds;
  log(`Spinoff links: ${spinLinks.length}`);

  // Per-service files, each trimmed (lowest priority first) to its size budget
  const files = new Map<ServiceId, BuiltService & { json: string }>();
  const manifest: CatalogManifest = { schema: 1, builtAt, services: {} };
  for (const s of SERVICES_IN_USE) {
    const sel = published.get(s.id);
    if (!sel) continue;
    let items = sel.items;
    let json = JSON.stringify({ schema: 1, builtAt, items } satisfies Catalog);
    while (Buffer.byteLength(json) > FILE_BUDGET && items.length > MIN_SERVICE_TITLES) {
      items = trimTo(items, Math.floor(items.length * 0.96), sel.reserved);
      json = JSON.stringify({ schema: 1, builtAt, items } satisfies Catalog);
    }
    const bytes = Buffer.byteLength(json);
    files.set(s.id, { catalog: { schema: 1, builtAt, items }, bytes, json });
    manifest.services[s.id] = { file: `data/catalog/${s.id}.json`, titles: items.length, bytes };
  }
  const finalIds = new Set<string>();
  for (const f of files.values()) for (const i of f.catalog.items) finalIds.add(i.id);
  const finalItems = union.filter((i) => finalIds.has(i.id));

  // New arrivals
  const prevState = prevFromPool(previous.prevPool, previous.catalogs.length ? previous.catalogs : null);
  const diff = diffArrivals({ items: finalItems, prev: prevState, prevNew: previous.prevNew, today, builtAt, info, knownProviders: prevUniverse(previous.prevPool, prevState) });

  // Title index: every catalog item of every service, plus the wide net
  const alternates = new Map<string, AltTitle[]>();
  for (const id of finalIds) {
    const p = parsedAll.get(id);
    if (p?.altTitles.length) alternates.set(id, p.altTitles);
  }
  const bare = buildTitleIndex({ items: finalItems, originals, listRows }).filter((e) => !finalIds.has(e.id));
  const wantAlt = [...bare.filter((e) => e.kind === 'tv').slice(0, 2000), ...bare.filter((e) => e.kind === 'movie').slice(0, 1000)].map((e) => e.id);
  for (const [id, alts] of await fetchAltNames(tmdb, wantAlt)) alternates.set(id, alts);
  const titleEntries = trimIndexToBytes(buildTitleIndex({ items: finalItems, originals, listRows, alternates }), finalIds, builtAt);
  const titleIndex: TitleIndex = { schema: 1, builtAt, titles: titleEntries };
  const titlesJson = JSON.stringify(titleIndex);
  const titlesBytes = Buffer.byteLength(titlesJson);

  // Validate BEFORE writing anything
  const problems = [...validateBuild(manifest, files, previous.prev), ...validateTitleIndex(titleIndex, titlesBytes, [...finalIds])];
  printSummary(files, manifest, finalItems, diff, titleEntries.length, titlesBytes, started, tmdb);
  if (problems.length) {
    console.error('\nCATALOG BUILD FAILED SANITY CHECKS:\n - ' + problems.join('\n - '));
    process.exit(1);
  }

  await rm(path.join(OUT_DIR, 'catalog'), { recursive: true, force: true });
  await rm(path.join(OUT_DIR, 'catalog.json'), { force: true });
  await mkdir(path.join(OUT_DIR, 'catalog'), { recursive: true });
  for (const [id, f] of files) await writeFile(path.join(OUT_DIR, 'catalog', `${id}.json`), f.json);
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(OUT_DIR, 'new.json'), JSON.stringify(diff.arrivals));
  await writeFile(path.join(OUT_DIR, 'pool.json'), JSON.stringify(pool));
  await writeFile(path.join(OUT_DIR, 'titles.json'), titlesJson);
  log(`\nWrote public/data/manifest.json, catalog/*.json (${files.size} files), new.json, pool.json, titles.json`);
}

function printSummary(
  files: Map<ServiceId, BuiltService>,
  manifest: CatalogManifest,
  items: CatalogItem[],
  diff: ReturnType<typeof diffArrivals>,
  titleCount: number,
  titlesBytes: number,
  started: number,
  tmdb: TmdbClient,
) {
  const mb = (n: number) => (n / 1_048_576).toFixed(2);
  const count = <T,>(xs: T[], f: (x: T) => string) => {
    const m: Record<string, number> = {};
    for (const x of xs) m[f(x)] = (m[f(x)] ?? 0) + 1;
    return Object.entries(m).map(([k, v]) => `${k}=${v}`).join('  ');
  };
  log('\n================ CATALOG SUMMARY ================');
  log(`Distinct titles: ${distinctTitles(files.values())}   services published: ${files.size}`);
  let totalBytes = 0;
  for (const s of SERVICES_IN_USE) {
    const f = files.get(s.id);
    if (!f) continue;
    totalBytes += f.bytes;
    const plans = s.plans.map((p) => `${p.id}=${f.catalog.items.filter((i) => onPlan(i.providers, p)).length}`).join(' ');
    log(`  ${s.id.padEnd(13)} ${String(f.catalog.items.length).padStart(5)} titles  ${String(f.bytes).padStart(8)} B (${mb(f.bytes)} MB)   plans: ${plans}`);
  }
  log(`All service files together: ${mb(totalBytes)} MB raw (limit per file ${LIMITS.maxFileBytes} B)`);
  log(`Per kind:   ${count(items, (i) => i.kind)}`);
  log(`Attention:  ${count(items, (i) => i.attention)}`);
  log(`Language:   ${count(items, (i) => i.lang).split('  ').slice(0, 8).join('  ')} ...`);
  log(`Flags: horror=${items.filter((i) => i.flags.horror).length} trueCrime=${items.filter((i) => i.flags.trueCrime).length} scary=${items.filter((i) => i.flags.scary).length}`);
  const tv = items.filter((i) => i.kind === 'tv');
  log(`TV: ${tv.length}  dropIn=${tv.filter((i) => i.dropIn).length}  with standout episodes=${tv.filter((i) => i.standout.length).length}  latestSeason set=${tv.filter((i) => i.latestSeason).length}  spinoffOf=${items.filter((i) => i.spinoffOf).length}`);
  log(`titles.json: ${titleCount} entries, ${titlesBytes} bytes (${mb(titlesBytes)} MB)`);
  log(`New arrivals: ${diff.arrivals.entries.length} entries in window (+${diff.addedTitles} titles, +${diff.addedSeasons} seasons this build)${diff.fromDates ? ' [first build: from release dates]' : ''}${diff.suspicious ? ' [WARNING: unusually many new titles; title arrivals ignored]' : ''}`);
  log(`Time: ${Math.round((Date.now() - started) / 1000)}s   requests: ${tmdb.stats.requests}   retries: ${tmdb.stats.retries}`);
  log('=================================================');
  void manifest;
}

main().catch((e) => {
  console.error('Catalog build crashed:', e);
  process.exit(1);
});
