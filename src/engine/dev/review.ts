/**
 * Prints the top of the deck for a spread of realistic requests, so a human
 * can judge whether the picks look right, and so weights can be tuned.
 *
 *   npx tsx src/engine/dev/review.ts                         (sample catalog)
 *   npx tsx src/engine/dev/review.ts public/data/catalog.json
 *   npx tsx src/engine/dev/review.ts public/data/catalog.json 20   (20 cards each)
 *
 * Development tool only; the app never loads this file.
 */
import { readFileSync } from 'node:fs';
import type { Catalog, SuggestRequest } from '../../contracts';
import { FIXTURE_CATALOG } from '../../contracts/fixtures/catalog';
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
  console.log(`=== ${r.who} | ${r.viewing} | ${r.mood} | ${r.time} min | ${r.novelty}${r.genre ? ` | craving ${r.genre}` : ''}   (${ms.toFixed(1)} ms)`);
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
