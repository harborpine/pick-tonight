/**
 * Measures deck-building speed on synthetic catalogs of 3,000 and 8,000 titles
 * (a household with many services), for audiences of one to four.
 *
 *   npx tsx src/engine/dev/perf.ts
 *
 * Budget: a warm deck well under 100 ms on a phone (a phone is several times
 * slower than a desktop, so look for roughly 10-15 ms here).
 * Development tool only; the app never loads this file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { SERVICES, type Catalog, type CatalogItem } from '../../contracts';
import { createEngine } from '../index';
import { makeCtx, req, syntheticCatalog, HOUSE_OF_FOUR } from '../testkit';
import type { Who } from '../../contracts';

const engine = createEngine();
for (const size of [3000, 8000]) {
  const catalog = syntheticCatalog(size);
  const ctx = makeCtx({
    catalog,
    members: HOUSE_OF_FOUR,
    seen: { alex: catalog.items.slice(100, 400).map((i) => i.id), sam: catalog.items.slice(300, 700).map((i) => i.id), kit: catalog.items.slice(600, 2600).map((i) => i.id) },
    never: { alex: catalog.items.slice(900, 1000).map((i) => i.id), kit: catalog.items.slice(950, 1100).map((i) => i.id) },
  });
  const audiences: Who[] = [['kit'], ['alex'], ['alex', 'sam'], ['alex', 'kit', 'sam'], ['alex', 'dee', 'kit', 'sam']];
  let t0 = performance.now();
  engine.buildDeck(req({ who: ['kit'], mood: 'cozy' }), ctx);
  console.log(`${size}: cold first deck (index only, blank person) ${(performance.now() - t0).toFixed(0)} ms`);
  t0 = performance.now();
  engine.buildDeck(req({ who: ['alex', 'dee', 'kit', 'sam'], mood: 'cozy' }), ctx);
  console.log(`${size}: first deck for all four (three favourites models) ${(performance.now() - t0).toFixed(0)} ms`);
  for (const who of audiences) {
    const asks = [req({ who, mood: 'laugh', viewing: 'background', time: 20 }), req({ who, mood: 'gripped', time: 60, novelty: 'new' }), req({ who, mood: 'cozy', viewing: 'eating', time: 45 }), req({ who, mood: 'hyped', genre: 'action', novelty: 'new' }), req({ who, mood: 'feelgood', time: 'any' })];
    let worst = 0, total = 0, n = 0;
    for (let round = 0; round < 6; round++) for (const r of asks) {
      const t = performance.now();
      engine.buildDeck(r, ctx, { seed: round + 1 });
      const ms = performance.now() - t;
      if (round > 0) { worst = Math.max(worst, ms); total += ms; n++; }
    }
    console.log(`${size}: ${who.length} watching: warm avg ${(total / n).toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
  }
  t0 = performance.now();
  engine.followUps(['alex', 'kit', 'sam'], ctx);
  console.log(`${size}: followUps ${(performance.now() - t0).toFixed(1)} ms`);
}

// The real thing, when the catalog files are there: every service at once (the largest household possible).
if (existsSync('public/data/catalog')) {
  const items = new Map<string, CatalogItem>();
  for (const f of readdirSync('public/data/catalog')) for (const i of (JSON.parse(readFileSync(`public/data/catalog/${f}`, 'utf8')) as Catalog).items) items.set(i.id, i);
  const catalog: Catalog = { schema: 1, builtAt: '2026-10-12T00:00:00.000Z', items: [...items.values()] };
  const plans = Object.fromEntries(SERVICES.map((s) => [s.id, s.plans[0].id]));
  const ctx = makeCtx({ catalog, plans, members: HOUSE_OF_FOUR });
  let t0 = performance.now();
  engine.buildDeck(req({ who: ['kit'], mood: 'cozy' }), ctx);
  console.log(`real, every service (${catalog.items.length} titles): cold first deck ${(performance.now() - t0).toFixed(0)} ms`);
  t0 = performance.now();
  engine.buildDeck(req({ who: ['alex', 'dee', 'kit', 'sam'], mood: 'cozy' }), ctx);
  console.log(`real: first deck for all four ${(performance.now() - t0).toFixed(0)} ms`);
  for (const who of [['kit'], ['alex', 'sam'], ['alex', 'dee', 'kit', 'sam']] as Who[]) {
    const asks = [req({ who, mood: 'laugh', time: 'any' }), req({ who, mood: 'laugh', viewing: 'background', time: 20 }), req({ who, mood: 'gripped', time: 60, novelty: 'new' }), req({ who, mood: 'gripped', time: 120, novelty: 'new' }), req({ who, mood: 'feelgood', time: 'any' })];
    let worst = 0, total = 0, n = 0;
    for (let round = 0; round < 6; round++) for (const r of asks) {
      const t = performance.now();
      engine.buildDeck(r, ctx, { seed: round + 1 });
      const ms = performance.now() - t;
      if (round > 0) { worst = Math.max(worst, ms); total += ms; n++; }
    }
    console.log(`real: ${who.length} watching: warm avg ${(total / n).toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
  }
}
