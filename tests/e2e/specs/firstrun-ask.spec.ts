import { expect, test } from '@playwright/test';
import { MEM_URL, REQ, askSolo, engineDeck, fillAsk, pageThroughDeck, startMemoryPhone, tid } from '../helpers/app';

const SITCOMS = ['tv-8592', 'tv-48891']; // Parks and Recreation, Brooklyn Nine-Nine (not favourites for either person)

test('first run: choose person, start household, tick what you have seen -> counts as seen afterwards', async ({ page }) => {
  await page.goto(MEM_URL);
  await expect(tid(page, 'setup')).toBeVisible();
  await expect(tid(page, 'person-HG')).toBeVisible();
  await expect(tid(page, 'person-BG')).toBeVisible();
  // "Not HG?" lets you change your mind
  await tid(page, 'person-HG').click();
  await expect(tid(page, 'change-person')).toBeVisible();
  await tid(page, 'change-person').click();
  await tid(page, 'person-HG').click();
  await tid(page, 'start-household').click();

  // The "what have you seen" grid
  await expect(tid(page, 'onboarding')).toBeVisible();
  const tiles = page.locator('[data-testid^="onboard-item-"]');
  expect(await tiles.count()).toBeGreaterThanOrEqual(20);
  await expect(tid(page, 'onboard-skip')).toBeVisible();
  await expect(tid(page, 'onboard-done')).toBeVisible();

  // Before ticking: the engine would offer both sitcoms in a New request.
  const NEW = { ...REQ, novelty: 'new' as const };
  const before = (await engineDeck(page, NEW)).map((c) => c.id);
  for (const id of SITCOMS) expect(before, `${id} should be offered before it is ticked`).toContain(id);

  for (const id of SITCOMS) {
    const tile = tid(page, `onboard-item-${id}`);
    await expect(tile).toHaveAttribute('data-selected', 'false');
    await tile.click();
    await expect(tile).toHaveAttribute('data-selected', 'true');
  }
  await expect(tid(page, 'onboard-done')).toContainText('2');
  await tid(page, 'onboard-done').click();
  await expect(tid(page, 'ask')).toBeVisible();

  // New: the ticked titles are gone from the whole deck.
  await askSolo(page, { who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'new' });
  const newDeck = await pageThroughDeck(page);
  expect(newDeck.length).toBeGreaterThan(5);
  for (const id of SITCOMS) expect(newDeck.map((c) => c.id)).not.toContain(id);

  // Rewatch: they appear.
  await tid(page, 'empty-back').click();
  await askSolo(page, { novelty: 'rewatch' });
  const rewatch = await pageThroughDeck(page);
  for (const id of SITCOMS) expect(rewatch.map((c) => c.id), `${id} is a rewatch now`).toContain(id);
  // ...and the seeded favourites are rewatchable too (favourites count as seen)
  expect(rewatch.map((c) => c.id)).toContain('tv-4556'); // Scrubs

  // The Us page lists them as seen
  await tid(page, 'empty-back').click();
  await tid(page, 'tab-us').click();
  await tid(page, 'us-seg-HG').click();
  for (const id of SITCOMS) await expect(page.locator(`[data-testid="seen-row"][data-item-id="${id}"]`)).toHaveCount(1);
});

test('first run: skipping the grid still gets you to the questions; BG can be the first phone too', async ({ page }) => {
  await startMemoryPhone(page, { person: 'BG', onboarding: 'skip' });
  await expect(tid(page, 'ask')).toBeVisible();
  await expect(tid(page, 'ask-who-BG')).toHaveAttribute('data-selected', 'true');
  // The grid is not shown again after a reload
  await page.reload();
  await expect(tid(page, 'ask')).toBeVisible();
  await expect(tid(page, 'onboarding')).toHaveCount(0);
});

test('ask: sensible defaults make "Show me" reachable in one tap', async ({ page }) => {
  await startMemoryPhone(page, { person: 'HG' });
  // Everything already has a selection
  for (const group of ['who', 'viewing', 'mood', 'time', 'novelty', 'genre']) {
    await expect(page.locator(`[data-testid="ask-group-${group}"] [data-selected="true"]`)).toHaveCount(1);
  }
  await expect(tid(page, 'ask-who-HG')).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'ask-submit')).toHaveText(/Show me/);
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'solo-deck')).toBeVisible();
  await expect(tid(page, 'card')).toBeVisible();
  // Back goes to the questions
  await tid(page, 'deck-back').click();
  await expect(tid(page, 'ask')).toBeVisible();
  // Together changes the button to "Start together"
  await tid(page, 'ask-who-Together').click();
  await expect(tid(page, 'ask-submit')).toHaveText(/Start together/);
});

for (const phone of ['HG', 'BG'] as const) {
  test(`ask: "Scared, spooky" is only offered for HG alone (checked on ${phone}'s phone)`, async ({ page }) => {
    await startMemoryPhone(page, { person: phone });
    await tid(page, 'ask-who-HG').click();
    await expect(tid(page, 'ask-mood-scared')).toBeVisible();
    await tid(page, 'ask-who-BG').click();
    await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
    await tid(page, 'ask-who-Together').click();
    await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
    // the other nine moods are all there
    for (const m of ['laugh', 'cozy', 'brainoff', 'gripped', 'feelgood', 'think', 'romantic', 'cry', 'hyped']) {
      await expect(tid(page, `ask-mood-${m}`)).toBeVisible();
    }
  });
}

test('ask: switching Who from HG (with Scared selected) to Together or BG resets the mood', async ({ page }) => {
  await startMemoryPhone(page, { person: 'HG' });
  for (const other of ['Together', 'BG'] as const) {
    await tid(page, 'ask-who-HG').click();
    await tid(page, 'ask-mood-scared').click();
    await expect(tid(page, 'ask-mood-scared')).toHaveAttribute('data-selected', 'true');
    await tid(page, `ask-who-${other}`).click();
    await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
    // exactly one mood is selected, and it is a real one
    await expect(page.locator('[data-testid="ask-group-mood"] [data-selected="true"]')).toHaveCount(1);
  }
  // Scared for HG alone gives a deck of scary-ish titles
  await tid(page, 'ask-who-HG').click();
  await fillAsk(page, { mood: 'scared', time: 120 });
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'card')).toBeVisible();
});
