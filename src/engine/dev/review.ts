/**
 * Prints the top of the deck for a spread of realistic requests, so a human
 * can judge whether the picks look right, and so weights can be tuned.
 *
 *   npx tsx src/engine/dev/review.ts                         (sample catalog)
 *   npx tsx src/engine/dev/review.ts public/data/catalog.json
 *   npx tsx src/engine/dev/review.ts public/data/catalog.json 20   (20 cards each)
 *   npx tsx src/engine/dev/review.ts public/data/catalog.json 12 public/data/titles.json
 *
 * Also prints: how "either" decks mix new and rewatch, the follow-ups for each
 * audience, and (when a title lookup is given or public/data/titles.json sits
 * next to the catalog) a trial import of a sample Netflix history.
 *
 * Development tool only; the app never loads this file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Catalog, SuggestRequest, TitleIndex, Who } from '../../contracts';
import { FIXTURE_CATALOG, FIXTURE_TITLE_INDEX } from '../../contracts/fixtures/catalog';
import { sampleNetflixHistory } from './sampleHistory';
import { createEngine } from '../index';
import { makeCtx } from '../testkit';

const path = process.argv[2];
const top = Number(process.argv[3] ?? 12);
const catalog: Catalog = path ? (JSON.parse(readFileSync(path, 'utf8')) as Catalog) : FIXTURE_CATALOG;
const engine = createEngine();
const ctx = makeCtx({ catalog });
const byId = new Map(catalog.items.map((i) => [i.id, i]));

const R = (who: SuggestRequest['who'], viewing: SuggestRequest['viewing'], mood: SuggestRequest['mood'], time: SuggestRequest['time'], novelty: SuggestRequest['novelty'], genre: SuggestRequest['genre'] = null): SuggestRequest => ({ who, viewing, mood, time, novelty, genre });

const REQUESTS: SuggestRequest[] = [
  R('HG', 'background', 'laugh', 20, 'either'),
  R('HG', 'focused', 'laugh', 'any', 'either'),
  R('HG', 'focused', 'laugh', 120, 'new'),
  R('HG', 'focused', 'gripped', 60, 'new'),
  R('HG', 'focused', 'scared', 120, 'new'),
  R('HG', 'focused', 'hyped', 120, 'new'),
  R('HG', 'focused', 'think', 60, 'new'),
  R('HG', 'eating', 'brainoff', 45, 'either'),
  R('BG', 'focused', 'gripped', 60, 'new'),
  R('BG', 'background', 'brainoff', 45, 'rewatch'),
  R('BG', 'background', 'cozy', 60, 'either'),
  R('BG', 'focused', 'romantic', 120, 'new'),
  R('BG', 'focused', 'cry', 120, 'either'),
  R('BG', 'focused', 'feelgood', 45, 'new'),
  R('BG', 'focused', 'gripped', 120, 'new', 'reality'),
  R('Together', 'eating', 'cozy', 45, 'either'),
  R('Together', 'focused', 'gripped', 120, 'new'),
  R('Together', 'focused', 'romantic', 120, 'either'),
  R('Together', 'focused', 'laugh', 60, 'either'),
  R('Together', 'focused', 'think', 120, 'new'),
  R('Together', 'background', 'brainoff', 20, 'either'),
  R('Together', 'focused', 'hyped', 120, 'new', 'action'),
  R('Together', 'focused', 'gripped', 60, 'new', 'reality'),
];

const pickText = (c: { pick: { type: string; season?: number; episode?: number; name?: string } }) =>
  c.pick.type === 'episode' ? `S${c.pick.season}E${c.pick.episode} "${c.pick.name}"` : c.pick.type;

console.log(`Catalog: ${catalog.items.length} titles, built ${catalog.builtAt}${path ? ` (${path})` : ' (fixture)'}\n`);

for (const r of REQUESTS) {
  const t0 = performance.now();
  const deck = engine.buildDeck(r, ctx, { limit: top });
  const ms = performance.now() - t0;
  console.log(`=== ${r.who} | ${r.viewing} | ${r.mood} | ${r.time === 'any' ? 'any length' : `${r.time} min`} | ${r.novelty}${r.genre ? ` | craving ${r.genre}` : ''}   (${ms.toFixed(1)} ms)`);
  if (!deck.length) console.log('   (nothing)');
  deck.forEach((c, k) => {
    const i = byId.get(c.itemId)!;
    const seen = (r.who === 'Together' ? (['HG', 'BG'] as const) : [r.who]).filter((p) => engine.hasSeen(p, i.id, ctx));
    console.log(
      `${String(k + 1).padStart(2)}. ${c.score.toFixed(3)}  ${i.title} (${i.year}) [${i.kind}, ${c.minutes}m, ${i.attention}, mood ${(i.moods[r.mood] ?? 0).toFixed(2)}, ${i.rating.toFixed(1)}/${i.votes}] ` +
        `${c.service.serviceId}${c.service.adFree ? '' : '(ads)'} -> ${pickText(c)}${seen.length ? `  {seen: ${seen.join('+')}}` : ''}\n` +
        `      ${i.genres.join(', ')} | ${c.reasons.join(' / ') || '-'}`,
    );
  });
  console.log('');
}

for (const p of ['HG', 'BG'] as const) {
  console.log(`=== What it knows about ${p}`);
  for (const line of engine.describeTaste(ctx.state.profiles[p], catalog)) {
    console.log(`   ${line.strength >= 0 ? '+' : ''}${line.strength.toFixed(2)}  ${line.text}   [${line.key}, ${line.source}]`);
  }
  console.log('');
}

console.log('=== First-run grid (first 24)');
console.log('   ' + engine.onboardingTitles(catalog, ctx.state.settings.plans, 24).map((i) => i.title).join(' | '));

// ---------------------------------------------------------------------------
// "Either": how much of each deck is a rewatch, and where the rewatches sit
// ---------------------------------------------------------------------------
{
  // A lived-in household: besides their favourites, each has seen a good slice of the well-known titles.
  const known = engine.onboardingTitles(catalog, ctx.state.settings.plans, 400).map((i) => i.id);
  const lived = makeCtx({ catalog, seen: { HG: known.filter((_, k) => k % 3 === 0), BG: known.filter((_, k) => k % 3 === 1) } });
  const either: SuggestRequest[] = [
    R('HG', 'background', 'laugh', 20, 'either'),
    R('HG', 'focused', 'gripped', 60, 'either'),
    R('HG', 'focused', 'think', 120, 'either'),
    R('HG', 'focused', 'hyped', 'any', 'either'),
    R('BG', 'background', 'cozy', 60, 'either'),
    R('BG', 'focused', 'gripped', 60, 'either'),
    R('BG', 'focused', 'romantic', 120, 'either'),
    R('BG', 'focused', 'cry', 'any', 'either'),
    R('Together', 'eating', 'cozy', 45, 'either'),
    R('Together', 'focused', 'laugh', 60, 'either'),
    R('Together', 'focused', 'gripped', 120, 'either'),
    R('Together', 'focused', 'feelgood', 'any', 'either'),
  ];
  for (const [label, c] of [['favourites only', ctx], ['lived-in (about 130 more seen each)', lived]] as const) {
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
          if ((r.who === 'Together' ? (['HG', 'BG'] as const) : [r.who]).some((p) => engine.hasSeen(p, card.itemId, c))) {
            rw++;
            where[k]++;
            const t = byId.get(card.itemId)!.title;
            names.set(t, (names.get(t) ?? 0) + 1);
          }
        });
      }
      cards += n;
      rewatch += rw;
      const top = [...names].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, k]) => `${t} x${k}`).join(', ');
      console.log(`   ${r.who} | ${r.viewing} | ${r.mood} | ${r.time}: ${((100 * rw) / Math.max(1, n)).toFixed(1)}% rewatch   positions ${where.map((x) => (x ? Math.min(9, Math.ceil(x / 2)) : '.')).join('')}\n      ${top || '(no rewatch good enough)'}`);
    }
    console.log(`   overall: ${((100 * rewatch) / Math.max(1, cards)).toFixed(1)}% of ${cards} cards\n`);
  }
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------
{
  const today = (catalog.builtAt ?? '').slice(0, 10) || ctx.today;
  const withSeasons = catalog.items.filter((i) => i.latestSeason).length;
  const withSpinoffs = catalog.items.filter((i) => i.spinoffOf?.length).length;
  console.log(`=== Follow-ups as of ${today} (catalog has ${withSeasons} titles with a latest season, ${withSpinoffs} marked as spinoffs)`);
  const fctx = { ...ctx, today };
  for (const who of ['HG', 'BG', 'Together'] as Who[]) {
    const list = engine.followUps(who, fctx);
    console.log(`   ${who}: ${list.length}`);
    for (const f of list.slice(0, 15)) {
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
  const guess = path ? join(dirname(path), 'titles.json') : '';
  const indexPath = process.argv[4] ?? (guess && existsSync(guess) ? guess : '');
  const titleIndex: TitleIndex = indexPath ? (JSON.parse(readFileSync(indexPath, 'utf8')) as TitleIndex) : FIXTURE_TITLE_INDEX;
  console.log(`=== Import trial: sample Netflix history against ${indexPath || 'the fixture lookup (no titles.json found)'} (${titleIndex.titles.length} titles)`);
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
  for (const p of ['HG', 'BG'] as const) {
    const after = engine.learnFromImport(ctx.state.profiles[p], result.matched, catalog);
    const twice = engine.learnFromImport(after, result.matched, catalog);
    console.log(`   What it knows about ${p} after importing it (importing twice changes nothing: ${JSON.stringify(after) === JSON.stringify(twice)})`);
    for (const line of engine.describeTaste(after, catalog)) {
      console.log(`      ${line.strength >= 0 ? '+' : ''}${line.strength.toFixed(2)}  ${line.text}   [${line.key}, ${line.source}]`);
    }
  }
  console.log(`   search "off": ${engine.searchTitles('off', titleIndex, 5).map((e) => `${e.title} (${e.year})`).join(' | ')}`);
  console.log(`   search "grey": ${engine.searchTitles('grey', titleIndex, 5).map((e) => `${e.title} (${e.year})`).join(' | ')}`);
}
