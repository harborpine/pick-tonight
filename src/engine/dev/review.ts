/**
 * Prints the top of the deck for a spread of realistic requests and people, so
 * a human can judge whether the picks look right, and so weights can be tuned.
 *
 *   npx tsx src/engine/dev/review.ts                  real data in public/data when present, else the sample catalog
 *   npx tsx src/engine/dev/review.ts fixture          force the sample catalog
 *   npx tsx src/engine/dev/review.ts public/data 20   a data folder (holding manifest.json), 20 cards each
 *   npx tsx src/engine/dev/review.ts public/data 12 netflix=standard,hulu=ads     ...for a household with these plans
 *   npx tsx src/engine/dev/review.ts public/data 12 all                             ...or with every service in the manifest
 *
 * Who it prints decks for:
 *   (a) a blank person alone (cold start)        (d) sam
 *   (b) a person with three favourites           (e) alex + sam
 *   (c) alex                                     (f) alex + sam + kit (kit is blank)
 * then: how different two cold-start decks are, the taste pages, the first-run
 * grid, how "either" decks mix new and rewatch, the follow-ups, and a trial
 * import of a sample Netflix history.
 *
 * Development tool only; the app never loads this file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  SERVICES,
  subscribedServices,
  TITLE_INDEX_PATH,
  type Catalog,
  type CatalogItem,
  type CatalogManifest,
  type EngineContext,
  type MemberId,
  type PlanSelection,
  type SuggestRequest,
  type TitleIndex,
  type Who,
} from '../../contracts';
import { FIXTURE_CATALOG, FIXTURE_TITLE_INDEX } from '../../contracts/fixtures/catalog';
import { sampleNetflixHistory } from './sampleHistory';
import { createEngine } from '../index';
import { makeCtx, PLANS } from '../testkit';

// ---------------------------------------------------------------------------
// Loading: the per-service catalog files, merged for one household's plans
// ---------------------------------------------------------------------------

/**
 * What the phone does: read the manifest, load the file of every service the
 * household subscribes to, and merge them (a title on several services is in
 * several files, identical each time, so the first copy is kept).
 * `dataDir` is the folder holding manifest.json (public/data); the manifest's
 * file paths are relative to the site base, i.e. to its parent folder.
 */
export function loadHouseholdCatalog(dataDir: string, plans: PlanSelection): { catalog: Catalog; loaded: string[]; missing: string[] } {
  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as CatalogManifest;
  const base = dirname(resolve(dataDir));
  const items = new Map<string, CatalogItem>();
  const loaded: string[] = [];
  const missing: string[] = [];
  for (const service of subscribedServices(plans)) {
    const entry = manifest.services?.[service];
    const file = entry ? join(base, entry.file) : '';
    if (!entry || !existsSync(file)) {
      missing.push(service);
      continue;
    }
    const part = JSON.parse(readFileSync(file, 'utf8')) as Catalog;
    for (const item of part.items) if (!items.has(item.id)) items.set(item.id, item);
    loaded.push(`${service} (${part.items.length})`);
  }
  return { catalog: { schema: 1, builtAt: manifest.builtAt, items: [...items.values()] }, loaded, missing };
}

/** "netflix=standard,hulu=ads" -> a plan selection; "all" -> the first plan of every service in the manifest. */
function parsePlans(text: string | undefined, dataDir: string): PlanSelection {
  if (!text) return PLANS;
  if (text === 'all') {
    const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as CatalogManifest;
    return Object.fromEntries(SERVICES.filter((s) => manifest.services?.[s.id]).map((s) => [s.id, s.plans[0].id]));
  }
  return Object.fromEntries(text.split(',').map((pair) => pair.split('=') as [string, string]));
}

const arg = process.argv[2];
const top = Number(process.argv[3] ?? 12);
const defaultDir = 'public/data';
const dataDir = arg && arg !== 'fixture' ? arg : arg === 'fixture' ? '' : existsSync(join(defaultDir, 'manifest.json')) ? defaultDir : '';

let catalog: Catalog = FIXTURE_CATALOG;
let plans: PlanSelection = PLANS;
if (dataDir) {
  plans = parsePlans(process.argv[4], dataDir);
  const t0 = performance.now();
  const res = loadHouseholdCatalog(dataDir, plans);
  catalog = res.catalog;
  console.log(`Loaded ${res.loaded.join(', ') || 'nothing'} from ${dataDir} in ${(performance.now() - t0).toFixed(0)} ms${res.missing.length ? `; NOT in the manifest: ${res.missing.join(', ')}` : ''}`);
} else {
  console.log(arg === 'fixture' ? 'Using the sample catalog (asked for).' : `No ${defaultDir}/manifest.json yet: using the sample catalog.`);
}

const engine = createEngine();
const byId = new Map(catalog.items.map((i) => [i.id, i]));
console.log(`Catalog: ${catalog.items.length} titles, built ${catalog.builtAt}; plans ${JSON.stringify(plans)}\n`);

// ---------------------------------------------------------------------------
// The people
// ---------------------------------------------------------------------------

interface Persona {
  label: string;
  who: Who;
  ctx: EngineContext;
}
const household = (members: MemberId[]): EngineContext => makeCtx({ catalog, plans, members });
const soloNew = household(['kit']);
const soloFew = household(['dee']);
// (dee's sample never-show-me choices are about the rules, not about taste: leave them out here.)
soloFew.state.profiles.dee.dealbreakers = { horror: false, trueCrime: false, scary: false, genres: [], subtitled: false };
const pair = household(['alex', 'sam']);
const three = household(['alex', 'sam', 'kit']);

const PERSONAS: Persona[] = [
  { label: '(a) blank person, alone', who: ['kit'], ctx: soloNew },
  { label: `(b) three favourites (${soloFew.state.profiles.dee.favorites.map((f) => f.title).join(', ')})`, who: ['dee'], ctx: soloFew },
  { label: '(c) alex', who: ['alex'], ctx: pair },
  { label: '(d) sam', who: ['sam'], ctx: pair },
  { label: '(e) alex + sam', who: ['alex', 'sam'], ctx: pair },
  { label: '(f) alex + sam + kit', who: ['alex', 'kit', 'sam'], ctx: three },
];

type Ask = Omit<SuggestRequest, 'who'>;
const A = (viewing: Ask['viewing'], mood: Ask['mood'], time: Ask['time'], novelty: Ask['novelty'], genre: Ask['genre'] = null): Ask => ({ viewing, mood, time, novelty, genre });

const ASKS: Ask[] = [
  A('focused', 'laugh', 'any', 'either'),
  A('background', 'laugh', 20, 'either'),
  A('focused', 'gripped', 60, 'new'),
  A('focused', 'gripped', 120, 'new'),
  A('eating', 'cozy', 45, 'either'),
  A('focused', 'think', 120, 'new'),
  A('focused', 'romantic', 120, 'new'),
  A('focused', 'feelgood', 120, 'either'),
  A('background', 'brainoff', 45, 'either'),
  A('focused', 'hyped', 120, 'new', 'action'),
  A('focused', 'scared', 120, 'new'),
];

const pickText = (c: { pick: { type: string; season?: number; episode?: number; name?: string } }) =>
  c.pick.type === 'episode' ? `S${c.pick.season}E${c.pick.episode} "${c.pick.name}"` : c.pick.type === 'season' ? `season ${c.pick.season}` : c.pick.type;
const askText = (r: Ask) => `${r.viewing} | ${r.mood} | ${r.time === 'any' ? 'any length' : `${r.time} min`} | ${r.novelty}${r.genre ? ` | craving ${r.genre}` : ''}`;
const nameOf = (ctx: EngineContext, id: MemberId) => ctx.state.members[id]?.name ?? id;

let slowest = 0;
for (const p of PERSONAS) {
  console.log(`\n################ ${p.label}`);
  for (const ask of ASKS) {
    const r: SuggestRequest = { ...ask, who: p.who };
    if (!engine.availableMoods(p.who, p.ctx).includes(r.mood)) {
      console.log(`=== ${askText(ask)}   (mood not offered to this audience)\n`);
      continue;
    }
    engine.buildDeck(r, p.ctx, { limit: top, seed: 1 }); // warm
    const t0 = performance.now();
    const deck = engine.buildDeck(r, p.ctx, { limit: top, seed: 1 });
    const ms = performance.now() - t0;
    slowest = Math.max(slowest, ms);
    console.log(`=== ${askText(ask)}   (${ms.toFixed(1)} ms)`);
    if (!deck.length) console.log('   (nothing)');
    deck.forEach((c, k) => {
      const i = byId.get(c.itemId)!;
      const seen = p.who.filter((m) => engine.hasSeen(m, i.id, p.ctx)).map((m) => nameOf(p.ctx, m));
      console.log(
        `${String(k + 1).padStart(2)}. ${c.score.toFixed(3)}  ${i.title} (${i.year}) [${i.kind}, ${c.minutes}m, ${i.attention}, ${i.lang}, mood ${(i.moods[r.mood] ?? 0).toFixed(2)}, ${i.rating.toFixed(1)}/${i.votes}] ` +
          `${c.service.serviceId}${c.service.adFree ? '' : '(ads)'} -> ${pickText(c)}${seen.length ? `  {seen: ${seen.join('+')}}` : ''}\n` +
          `      ${i.genres.join(', ')} | ${c.reasons.join(' / ') || '-'}`,
      );
    });
    console.log('');
  }
}
console.log(`Slowest warm deck above: ${slowest.toFixed(1)} ms\n`);

// ---------------------------------------------------------------------------
// Cold start: variety within a deck, and difference between two new households
// ---------------------------------------------------------------------------
{
  console.log('=== Cold start: a blank person, 30-card decks. Spread within one deck, and how much two seeds share');
  for (const ask of ASKS.filter((a) => !a.genre)) {
    const r: SuggestRequest = { ...ask, who: ['kit'] };
    const decks = [1, 2, 3, 4].map((seed) => engine.buildDeck(r, soloNew, { seed }));
    const d = decks[0];
    if (!d.length) continue;
    const count = (f: (i: CatalogItem) => string) => {
      const m = new Map<string, number>();
      for (const c of d) m.set(f(byId.get(c.itemId)!), (m.get(f(byId.get(c.itemId)!)) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
    };
    let shared = 0;
    let pairs = 0;
    for (let a = 0; a < decks.length; a++) for (let b = a + 1; b < decks.length; b++) {
      shared += decks[a].filter((c) => decks[b].some((x) => x.itemId === c.itemId)).length / Math.max(1, decks[a].length);
      pairs++;
    }
    const firsts = new Set(decks.map((x) => x[0].itemId)).size;
    console.log(`   ${askText(ask)}: ${d.length} cards\n      first genre: ${count((i) => i.genres[0] ?? 'none')}\n      kind: ${count((i) => i.kind)}; service: ${count((i) => engine.chooseService(i, plans)?.serviceId ?? '?')}\n      two seeds share ${((100 * shared) / pairs).toFixed(0)}% of their cards; ${firsts} different first cards in 4 seeds`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Taste pages and the first-run grid
// ---------------------------------------------------------------------------
for (const [label, ctx, id] of [['a blank person', soloNew, 'kit'], ['a person with three favourites', soloFew, 'dee'], ['alex', pair, 'alex'], ['sam', pair, 'sam']] as const) {
  const lines = engine.describeTaste(ctx.state.profiles[id], catalog);
  console.log(`=== What it knows about ${label} (${lines.length} lines)`);
  for (const line of lines) console.log(`   ${line.strength >= 0 ? '+' : ''}${line.strength.toFixed(2)}  ${line.text}   [${line.key}, ${line.source}]`);
  console.log('');
}

console.log('=== First-run grid (first 24)');
console.log('   ' + engine.onboardingTitles(catalog, plans, 24).map((i) => i.title).join(' | ') + '\n');

// ---------------------------------------------------------------------------
// "Either": how much of each deck is a rewatch, and where the rewatches sit
// ---------------------------------------------------------------------------
{
  // A lived-in household: besides their favourites, each has seen a good slice of the well-known titles.
  const known = engine.onboardingTitles(catalog, plans, 400).map((i) => i.id);
  const lived = makeCtx({ catalog, plans, members: ['alex', 'sam', 'kit'], seen: { alex: known.filter((_, k) => k % 3 === 0), sam: known.filter((_, k) => k % 3 === 1), kit: known.filter((_, k) => k % 3 === 2) } });
  const either: SuggestRequest[] = [
    { ...A('background', 'laugh', 20, 'either'), who: ['alex'] },
    { ...A('focused', 'gripped', 60, 'either'), who: ['alex'] },
    { ...A('background', 'cozy', 60, 'either'), who: ['sam'] },
    { ...A('focused', 'romantic', 120, 'either'), who: ['sam'] },
    { ...A('focused', 'gripped', 120, 'either'), who: ['kit'] },
    { ...A('eating', 'cozy', 45, 'either'), who: ['alex', 'sam'] },
    { ...A('focused', 'gripped', 120, 'either'), who: ['alex', 'sam'] },
    { ...A('focused', 'laugh', 60, 'either'), who: ['alex', 'kit', 'sam'] },
    { ...A('focused', 'feelgood', 'any', 'either'), who: ['alex', 'kit', 'sam'] },
  ];
  for (const [label, c] of [['favourites only', three], ['lived-in (about 130 more seen each)', lived]] as const) {
    console.log(`=== "Either" mix, ${label}: 30-card decks, 20 seeds each`);
    let cards = 0;
    let rewatch = 0;
    for (const r of either) {
      const where = new Array<number>(30).fill(0);
      let n = 0;
      let rw = 0;
      const names = new Map<string, number>();
      for (let seed = 1; seed <= 20; seed++) {
        engine.buildDeck(r, c, { seed }).forEach((card, k) => {
          n++;
          if (r.who.some((p) => engine.hasSeen(p, card.itemId, c))) {
            rw++;
            where[k]++;
            const t = byId.get(card.itemId)!.title;
            names.set(t, (names.get(t) ?? 0) + 1);
          }
        });
      }
      cards += n;
      rewatch += rw;
      const most = [...names].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, k]) => `${t} x${k}`).join(', ');
      console.log(`   ${r.who.join('+')} | ${r.viewing} | ${r.mood} | ${r.time}: ${((100 * rw) / Math.max(1, n)).toFixed(1)}% rewatch   positions ${where.map((x) => (x ? Math.min(9, Math.ceil(x / 2)) : '.')).join('')}\n      ${most || '(no rewatch good enough)'}`);
    }
    console.log(`   overall: ${((100 * rewatch) / Math.max(1, cards)).toFixed(1)}% of ${cards} cards\n`);
  }
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------
{
  const today = (catalog.builtAt ?? '').slice(0, 10) || pair.today;
  const withSeasons = catalog.items.filter((i) => i.latestSeason).length;
  const withSpinoffs = catalog.items.filter((i) => i.spinoffOf?.length).length;
  console.log(`=== Follow-ups as of ${today} (catalog has ${withSeasons} titles with a latest season, ${withSpinoffs} marked as spinoffs)`);
  for (const p of PERSONAS) {
    const list = engine.followUps(p.who, { ...p.ctx, today });
    console.log(`   ${p.label}: ${list.length}`);
    for (const f of list.slice(0, 12)) {
      const i = byId.get(f.itemId)!;
      console.log(`      ${f.type.padEnd(10)} ${i.title} (${i.year}) — "${f.text}"  [${f.key}${f.date ? `, ${f.date}` : ''}] ${f.service.serviceId} -> ${pickText(f)}  ${f.score.toFixed(3)}`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Watch-history import
// ---------------------------------------------------------------------------
{
  const guess = dataDir ? join(dirname(resolve(dataDir)), TITLE_INDEX_PATH) : '';
  const indexPath = guess && existsSync(guess) ? guess : '';
  const titleIndex: TitleIndex = indexPath ? (JSON.parse(readFileSync(indexPath, 'utf8')) as TitleIndex) : FIXTURE_TITLE_INDEX;
  console.log(`=== Import trial: sample Netflix history against ${indexPath || 'the sample lookup (no titles.json found)'} (${titleIndex.titles.length} titles)`);
  const text = sampleNetflixHistory();
  let t0 = performance.now();
  const parsed = engine.parseWatchHistory(text, 'NetflixViewingHistory.csv');
  const parseMs = performance.now() - t0;
  t0 = performance.now();
  const result = engine.matchWatchHistory(parsed, titleIndex);
  const coldMs = performance.now() - t0;
  t0 = performance.now();
  engine.matchWatchHistory(parsed, titleIndex);
  const warmMs = performance.now() - t0;
  const matchedRows = result.matched.reduce((n, m) => n + m.plays, 0);
  const missedRows = result.unmatched.reduce((n, m) => n + m.plays, 0);
  console.log(`   format ${parsed.format}, ${parsed.rows.length} rows, ${parsed.rows.filter((r) => r.at !== undefined).length} with a date (parse ${parseMs.toFixed(1)} ms, match ${coldMs.toFixed(1)} ms cold / ${warmMs.toFixed(1)} ms warm)`);
  console.log(`   matched ${result.matched.length} titles covering ${matchedRows} rows (${((100 * matchedRows) / Math.max(1, matchedRows + missedRows)).toFixed(1)}% of rows); ${result.unmatched.length} names unmatched`);
  console.log(`   top matches: ${result.matched.slice(0, 12).map((m) => `${m.entry.title} (${m.entry.year}, ${m.entry.kind}) x${m.plays}`).join(' | ')}`);
  console.log(`   unmatched: ${result.unmatched.map((u) => `${u.name} x${u.plays}`).join(' | ') || '(none)'}`);
  // The case that matters most now: a blank person whose only signal is the import.
  const before = soloNew.state.profiles.kit;
  const after = engine.learnFromImport(before, result.matched, catalog);
  const twice = engine.learnFromImport(after, result.matched, catalog);
  console.log(`   What it knows about a blank person after importing it (importing twice changes nothing: ${JSON.stringify(after) === JSON.stringify(twice)})`);
  for (const line of engine.describeTaste(after, catalog)) console.log(`      ${line.strength >= 0 ? '+' : ''}${line.strength.toFixed(2)}  ${line.text}   [${line.key}, ${line.source}]`);
  const imported: EngineContext = { ...soloNew, state: { ...soloNew.state, profiles: { kit: after } } };
  for (const ask of [A('focused', 'laugh', 'any', 'new'), A('focused', 'gripped', 60, 'new')]) {
    const r: SuggestRequest = { ...ask, who: ['kit'] };
    const was = engine.buildDeck(r, soloNew, { limit: 8 }).map((c) => byId.get(c.itemId)!.title);
    const now = engine.buildDeck(r, imported, { limit: 8 }).map((c) => byId.get(c.itemId)!.title);
    console.log(`   ${askText(ask)}\n      blank:        ${was.join(' | ')}\n      after import: ${now.join(' | ')}`);
  }
  console.log(`   search "off": ${engine.searchTitles('off', titleIndex, 5).map((e) => `${e.title} (${e.year})`).join(' | ')}`);
  console.log(`   search "grey": ${engine.searchTitles('grey', titleIndex, 5).map((e) => `${e.title} (${e.year})`).join(' | ')}`);
}
