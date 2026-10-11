import { expect, test } from '@playwright/test';
import { REQ, askSolo, openTab, pageThroughDeck, startMemoryPhone, tid, wtw, type Req } from '../helpers/app';

/** Which of these ids has HG (or either of us for Together) seen, according to the engine? */
async function seenSet(page: import('@playwright/test').Page, who: 'HG' | 'BG' | 'Together'): Promise<string[]> {
  return wtw(
    page,
    (w, a) => {
      const ctx = { catalog: w.catalog, state: w.sync.getState(), today: '2026-10-11' };
      const people = a.who === 'Together' ? ['HG', 'BG'] : [a.who];
      return w.catalog.items.filter((i: { id: string }) => people.some((p: string) => w.engine.hasSeen(p, i.id, ctx))).map((i: { id: string }) => i.id);
    },
    { who },
  );
}

async function deckIds(page: import('@playwright/test').Page, req: Req): Promise<string[]> {
  return wtw(
    page,
    (w, a) => {
      const ctx = { catalog: w.catalog, state: w.sync.getState(), today: '2026-10-11' };
      return w.engine.buildDeck(a.req, ctx, { limit: 500 }).map((c: { itemId: string }) => c.itemId);
    },
    { req },
  );
}

test('"Either" leans new: rewatches are a small minority of each deck, but still show up; New shows none; Rewatch only watched', async ({ page }) => {
  await startMemoryPhone(page);
  // Through the UI: re-open the first-run grid from HG's profile and tick lots of titles as watched.
  await openTab(page, 'us');
  await tid(page, 'us-seg-HG').click();
  await tid(page, 'profile-redo-onboarding').click();
  await expect(tid(page, 'onboarding')).toBeVisible();
  const tileIds = await page.locator('[data-testid^="onboard-item-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id') ?? ''));
  expect(tileIds.length).toBeGreaterThanOrEqual(20);
  let ticked = 0;
  for (const id of tileIds) {
    const tile = tid(page, `onboard-item-${id}`);
    if ((await tile.getAttribute('data-selected')) !== 'true') {
      await tile.click();
      ticked++;
    }
    if (ticked >= 25) break;
  }
  await tid(page, 'onboard-done').click();
  await expect(tid(page, 'tabbar')).toBeVisible();

  const seen = new Set(await seenSet(page, 'HG'));
  expect(seen.size).toBeGreaterThanOrEqual(20);

  // Several Either requests, different moods / lengths (engine, so nothing gets hidden by "not tonight").
  const variants: Partial<Req>[] = [
    { mood: 'laugh', time: 120 },
    { mood: 'cozy', time: 120 },
    { mood: 'feelgood', time: 120 },
    { mood: 'brainoff', time: 60 },
    { mood: 'laugh', time: 'any' },
    { mood: 'gripped', time: 120 },
    { mood: 'laugh', time: 45 },
  ];
  let total = 0;
  let rewatches = 0;
  let decksWithRewatch = 0;
  for (const v of variants) {
    const ids = await deckIds(page, { ...REQ, novelty: 'either', ...v });
    if (ids.length < 8) continue; // too small to say anything
    const re = ids.filter((id) => seen.has(id)).length;
    total += ids.length;
    rewatches += re;
    if (re > 0) decksWithRewatch++;
    expect(re / ids.length, `a rewatch majority in the ${JSON.stringify(v)} deck (${re} of ${ids.length})`).toBeLessThan(0.5);
  }
  expect(total, 'enough cards to judge').toBeGreaterThan(40);
  expect(rewatches / total, `overall rewatch share ${rewatches}/${total}`).toBeLessThanOrEqual(0.3);
  expect(rewatches, 'good rewatches exist, so Either still lets some through').toBeGreaterThan(0);
  expect(decksWithRewatch).toBeGreaterThan(0);

  // The real deck on screen agrees (one page-through, through the UI)
  await openTab(page, 'tonight');
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, viewing: 'focused', novelty: 'either' });
  const ui = await pageThroughDeck(page);
  expect(ui.length).toBeGreaterThan(8);
  const uiRe = ui.filter((c) => seen.has(c.id)).length;
  expect(uiRe / ui.length).toBeLessThan(0.5);
  await tid(page, 'empty-back').click();

  // "New" shows none that are seen; "Rewatch" shows only seen
  await askSolo(page, { novelty: 'new' });
  const fresh = await pageThroughDeck(page);
  expect(fresh.length).toBeGreaterThan(3);
  for (const c of fresh) expect(seen.has(c.id), `${c.title} is watched but shown as New`).toBe(false);
  await tid(page, 'empty-back').click();
  await askSolo(page, { novelty: 'rewatch' });
  const rew = await pageThroughDeck(page);
  expect(rew.length).toBeGreaterThan(3);
  for (const c of rew) expect(seen.has(c.id), `${c.title} is not watched but shown as Rewatch`).toBe(true);
});

test('"Either" says it is "mostly new" on the Ask screen, inside the chip, on screen', async ({ page }) => {
  await startMemoryPhone(page);
  await expect(tid(page, 'ask-novelty-either-hint')).toHaveText(/mostly new/i);
  const chip = (await tid(page, 'ask-novelty-either').boundingBox())!;
  const hint = (await tid(page, 'ask-novelty-either-hint').boundingBox())!;
  expect(hint.x).toBeGreaterThanOrEqual(chip.x - 1);
  expect(hint.x + hint.width).toBeLessThanOrEqual(chip.x + chip.width + 1);
  expect(hint.x + hint.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
