import { expect, test } from '@playwright/test';
import {
  SAMPLE,
  act,
  ask,
  currentCardId,
  neverCard,
  openTab,
  pageThroughDeck,
  quickHousehold,
  readCard,
  saveCard,
  sharedState,
  swipeCard,
  tid,
  todayLocal,
  toAsk,
  fillAsk,
  engineDeck,
  request,
} from '../helpers/app';

const SERVICES = ['Netflix', 'Disney+', 'Hulu', 'HBO Max', 'Peacock', 'Paramount+'];
const FORMS = {
  movie: /^Movie$/,
  series: /^Start the series$/,
  any: /^Put on any episode$/,
  episode: /^Season \d+, Episode \d+ . .+.$/,
};

test('card content: title, year, length, service + Ad-free/Ads, and every form of "what to watch"', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]]);
  const seenForms = new Set<string>();
  let looked = 0;
  for (let attempt = 0; attempt < 8 && seenForms.size < 4; attempt++) {
    await ask(page, { mood: 'laugh', time: 'any', novelty: 'either' });
    const cards = await pageThroughDeck(page);
    for (const c of cards) {
      looked++;
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.year).toMatch(/^(19|20)\d\d$/);
      expect(c.minutes).toMatch(/^(\d+ min|\d+h( \d+m)?)$/);
      expect(SERVICES).toContain(c.service);
      expect(c.badge.toLowerCase()).toBe(c.adFree ? 'ad-free' : 'ads');
      const form = Object.entries(FORMS).find(([, re]) => re.test(c.pick));
      expect(form, `card ${c.id} has an unrecognised "what to watch": ${c.pick}`).toBeTruthy();
      seenForms.add(form![0]);
      if (c.id.startsWith('movie-')) expect(c.pick).toMatch(FORMS.movie);
      else expect(c.pick).not.toMatch(FORMS.movie);
    }
    await tid(page, 'empty-back').click();
    // not-tonight hides things for today: bring them back by clearing the day's list between rounds
    await page.evaluate(async () => {
      const w = (window as any).__wtw;
      const st = w.sync.getState();
      for (const [m, per] of Object.entries<Record<string, string>>(st.notTonight)) for (const id of Object.keys(per)) await w.sync.setNotTonight(m, id, '1999-01-01');
    });
  }
  expect(looked).toBeGreaterThan(20);
  expect([...seenForms].sort(), 'forms of "what to watch" that appeared').toEqual(['any', 'episode', 'movie', 'series']);
});

test('card content: specific titles show the right "what to watch"', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]]);
  await ask(page, { mood: 'laugh', time: 'any', novelty: 'rewatch' });
  const cards = await pageThroughDeck(page);
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  expect(byId['tv-1434'].pick).toMatch(FORMS.any); // Family Guy: drop-in
  expect(byId['tv-73021'].pick).toMatch(FORMS.series); // Disenchantment: a story to start from the beginning
  expect(byId['tv-4556'].pick).toMatch(/^(Put on any episode|Season 3, Episode 14 . .My Screw Up.)$/); // Scrubs
  await tid(page, 'empty-back').click();
  await ask(page, { novelty: 'new' });
  const fresh = Object.fromEntries((await pageThroughDeck(page)).map((c) => [c.id, c]));
  expect(fresh['movie-546554'].pick).toMatch(FORMS.movie); // Knives Out
});

test('card content: the poster placeholder is drawn, "i" shows the description, a quick tap does not act', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]]);
  await ask(page, { mood: 'laugh', time: 120 });
  const poster = tid(page, 'card').locator('.card-poster-wrap');
  await expect(poster).toBeVisible();
  expect((await poster.boundingBox())!.height).toBeGreaterThan(200);
  await expect(tid(page, 'card-overview')).toHaveCount(0);
  await tid(page, 'card-info').click();
  await expect(tid(page, 'card-overview')).toBeVisible();
  await expect(tid(page, 'card-overview')).not.toHaveText('');
  const id = await currentCardId(page);
  await tid(page, 'card').click({ position: { x: 150, y: 120 } }); // a quick tap on the card is not a swipe
  expect(await currentCardId(page)).toBe(id);
});

test('Yes: the deck carries on, "Liked" counts up, the Matches row shows the card\'s own details; a right-swipe is not "watched"', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0]]);
  await ask(page, { mood: 'laugh', time: 120 });
  const c = await readCard(page);
  await tid(page, 'action-yes').click();
  await expect(tid(page, 'solo-deck')).toBeVisible();
  await expect(tid(page, 'match-screen')).toHaveCount(0);
  await expect(page.locator(`[data-testid="card"][data-item-id="${c.id}"]`)).toHaveCount(0);
  await expect(tid(page, 'liked-count')).toHaveText('1');
  await tid(page, 'liked-chip').click();
  const row = page.locator(`[data-testid="match-row"][data-item-id="${c.id}"]`);
  await expect(row).toHaveAttribute('data-kind', 'solo');
  await expect(row.getByTestId('match-title')).toHaveText(c.title);
  await expect(row.getByTestId('match-label')).toContainText('Alex');
  await expect(row.getByTestId('match-pick')).toHaveText(c.pick);
  await expect(row.getByTestId('match-where')).toContainText(c.service);
  expect(Object.keys((await sharedState(page)).seen[h.first])).not.toContain(c.id);
  await openTab(page, 'history');
  await expect(page.locator(`[data-testid="history-row"][data-item-id="${c.id}"]`)).toHaveCount(0);
});

test('a real swipe right = yes, swipe left = not tonight, an early release springs back', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0]]);
  await ask(page, { mood: 'laugh', time: 120 });
  const a = await readCard(page);
  const box = (await tid(page, 'card').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 10, box.y + 100);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect((await readCard(page)).id).toBe(a.id);
  await swipeCard(page, 'left');
  const b = await readCard(page);
  expect(b.id).not.toBe(a.id);
  expect((await sharedState(page)).notTonight[h.first][a.id]).toBe(todayLocal());
  await swipeCard(page, 'right');
  await expect(tid(page, 'liked-count')).toHaveText('1');
  expect((await sharedState(page)).picks.map((p: { itemId: string }) => p.itemId)).toContain(b.id);
});

test('Not tonight: the card goes away and the same request the same day does not show it; Seen it moves it from New to Rewatch', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0]]);
  await ask(page, { mood: 'laugh', time: 120, novelty: 'new' });
  const x = await readCard(page);
  await act(page, 'not-tonight');
  const y = await readCard(page);
  await act(page, 'seen');
  await tid(page, 'deck-back').click();
  await ask(page, { mood: 'laugh', time: 120, novelty: 'new' });
  const again = (await pageThroughDeck(page)).map((c) => c.id);
  expect(again).not.toContain(x.id);
  expect(again).not.toContain(y.id);
  const re = (await engineDeck(page, request([h.first], { novelty: 'rewatch', time: 'any' }))).map((c) => c.id);
  expect(re).toContain(y.id);
});

test('Never: asks first; cancel keeps the card; confirm hides it for that person for good, but another member alone can still see it', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0], SAMPLE[2]]);
  await ask(page, { mood: 'laugh', time: 120, novelty: 'new' });
  const x = (await currentCardId(page))!;
  await tid(page, 'action-never').click();
  await expect(tid(page, 'never-sheet')).toBeVisible();
  await expect(tid(page, 'never-text')).toContainText('hidden');
  await tid(page, 'never-cancel').click();
  expect(await currentCardId(page)).toBe(x);
  await neverCard(page);
  const st = await sharedState(page);
  expect(Object.keys(st.never[h.first])).toContain(x);
  expect(Object.keys(st.never[h.ids.Kit])).not.toContain(x);
  await toAsk(page);
  await fillAsk(page, { mood: 'laugh', time: 'any', novelty: 'new', who: [h.first] });
  const mine = (await engineDeck(page, request([h.first], { novelty: 'new', time: 'any' }))).map((c) => c.id);
  const hers = (await engineDeck(page, request([h.ids.Kit], { novelty: 'new', time: 'any' }))).map((c) => c.id);
  expect(mine).not.toContain(x);
  expect(hers).toContain(x);
  // and it can be brought back from the Us page
  await openTab(page, 'us');
  await tid(page, `us-seg-${h.first}`).click();
  await page.locator(`[data-testid="never-row"][data-item-id="${x}"] [data-testid="unmark-never"]`).click();
  expect((await engineDeck(page, request([h.first], { novelty: 'new', time: 'any' }))).map((c) => c.id)).toContain(x);
});

test('Save in a household of three: Mine vs Ours land under the right tab', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await ask(page, { mood: 'laugh', time: 120 });
  const a = (await currentCardId(page))!;
  await saveCard(page, h.first);
  const b = (await currentCardId(page))!;
  await saveCard(page, 'ours');
  await openTab(page, 'watchlist');
  await expect(page.locator(`[data-testid="watchlist-row"][data-item-id="${a}"]`)).toHaveAttribute('data-list', h.first);
  await tid(page, 'watchlist-tab-ours').click();
  await expect(page.locator(`[data-testid="watchlist-row"][data-item-id="${b}"]`)).toHaveAttribute('data-list', 'ours');
});

test('ask: sensible defaults make "Show me" reachable in one tap; Back returns to the questions; groups change the button', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  for (const group of ['who', 'viewing', 'mood', 'time', 'novelty']) {
    await expect(page.locator(`[data-testid="ask-group-${group}"] [data-selected="true"]`)).not.toHaveCount(0);
  }
  await expect(page.locator('[data-testid="ask-group-genre"] [data-selected="true"]')).toHaveCount(1);
  await expect(tid(page, `who-${h.first}`)).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'ask-submit')).toHaveText(/Show me/);
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'solo-deck')).toBeVisible();
  await expect(tid(page, 'card')).toBeVisible();
  await tid(page, 'deck-back').click();
  await expect(tid(page, 'ask')).toBeVisible();
  await tid(page, `who-${h.ids.Kit}`).click();
  await expect(tid(page, 'ask-submit')).toHaveText(/Start together/);
});

test('ask: changing who resets a mood that is no longer offered (Scared) to a real one', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await tid(page, 'ask-mood-scared').click();
  await expect(tid(page, 'ask-mood-scared')).toHaveAttribute('data-selected', 'true');
  await tid(page, `who-${h.ids.Sam}`).click(); // Sam never wants scary things
  await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
  await expect(page.locator('[data-testid="ask-group-mood"] [data-selected="true"]')).toHaveCount(1);
  for (const m of ['laugh', 'cozy', 'brainoff', 'gripped', 'feelgood', 'think', 'romantic', 'cry', 'hyped']) await expect(tid(page, `ask-mood-${m}`)).toBeVisible();
});

test('time "I don\'t care": selectable, and the deck mixes short sitcoms with long films', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]]);
  await tid(page, 'ask-time-any').click();
  await expect(tid(page, 'ask-time-any')).toHaveAttribute('data-selected', 'true');
  const box = await tid(page, 'ask-time-any').boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await tid(page, 'ask-submit').click();
  const deck = await pageThroughDeck(page);
  const mins = deck.map((c) => c.minutes);
  expect(mins.some((m) => /^\d+ min$/.test(m) && parseInt(m) <= 30)).toBe(true);
  expect(mins.some((m) => /h/.test(m))).toBe(true);
});
