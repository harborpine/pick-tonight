import { expect, test, type Page } from '@playwright/test';
import {
  REQ,
  act,
  askSolo,
  engineDeck,
  markWatched,
  openTab,
  pageThroughDeck,
  readCard,
  sharedState,
  startMemoryPhone,
  swipeCard,
  tid,
} from '../helpers/app';

const historyRow = (page: Page, id: string) => page.locator(`[data-testid="history-row"][data-item-id="${id}"]`);

test('History: starts empty; a right-swipe alone never creates an entry; "Seen it" on a card does', async ({ page }) => {
  await startMemoryPhone(page);
  await openTab(page, 'history');
  await expect(tid(page, 'history-empty')).toBeVisible();
  await expect(tid(page, 'history-add')).toBeVisible();
  await expect(tid(page, 'history-favorites-note')).toBeVisible();

  await openTab(page, 'tonight');
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  const liked = await readCard(page);
  await swipeCard(page, 'right');
  const seenIt = await readCard(page);
  await act(page, 'seen');
  await openTab(page, 'history');
  await expect(historyRow(page, liked.id)).toHaveCount(0);
  const row = historyRow(page, seenIt.id);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-source', 'manual');
  await expect(row.getByTestId('history-title')).toHaveText(seenIt.title);
  await expect(row.getByTestId('history-year')).toHaveText(seenIt.year);
  await expect(row.getByTestId('history-date')).not.toHaveText('');
  await expect(row.getByTestId('history-source')).toHaveText(/Marked watched/);
  await expect(tid(page, 'history-row')).toHaveCount(1);
  await expect(tid(page, 'history-count')).toContainText('1');
  // the seen title is out of New and in Rewatch
  expect((await engineDeck(page, { ...REQ, novelty: 'new' })).map((c) => c.id)).not.toContain(seenIt.id);
  expect((await engineDeck(page, { ...REQ, novelty: 'rewatch' })).map((c) => c.id)).toContain(seenIt.id);
});

test('History: the first-run grid adds the ticked titles (source: first-run picks)', async ({ page }) => {
  await startMemoryPhone(page, { onboarding: 'tick', tick: ['tv-8592', 'tv-48891'] });
  await openTab(page, 'history');
  for (const id of ['tv-8592', 'tv-48891']) {
    const row = historyRow(page, id);
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-source', 'onboarding');
    await expect(row.getByTestId('history-source')).toHaveText(/first-run/i);
  }
  await expect(tid(page, 'history-row')).toHaveCount(2);
  const st = await sharedState(page);
  expect(st.seen.HG['tv-8592'].source).toBe('onboarding');
});

test('History: "Add something I\'ve watched" finds titles by name, including ones that are not on our services', async ({ page }) => {
  await startMemoryPhone(page);
  await openTab(page, 'history');
  await tid(page, 'history-add').click();
  await expect(tid(page, 'history-add-sheet')).toBeVisible();

  // off-service title
  await tid(page, 'history-add-input').fill('breaking bad');
  const result = (id: string) => page.locator(`[data-testid="history-add-result"][data-item-id="${id}"]`);
  await expect(result('tv-1396')).toBeVisible({ timeout: 15_000 });
  await expect(result('tv-1396')).toHaveAttribute('data-added', 'false');
  await expect(result('tv-1396').getByTestId('history-add-result-title')).toHaveText('Breaking Bad');
  await result('tv-1396').click();
  await expect(result('tv-1396')).toHaveAttribute('data-added', 'true');

  // another one, by a partial name
  await tid(page, 'history-add-input').fill('ted las');
  await expect(result('tv-97546')).toBeVisible();
  await result('tv-97546').click();
  await expect(result('tv-97546')).toHaveAttribute('data-added', 'true');

  // nonsense gives the friendly "nothing" message
  await tid(page, 'history-add-input').fill('qqzzxxvv');
  await expect(tid(page, 'history-add-none')).toBeVisible();
  await tid(page, 'history-add-close').click();

  await expect(tid(page, 'history-add-sheet')).toHaveCount(0);
  await expect(historyRow(page, 'tv-1396')).toHaveCount(1);
  await expect(historyRow(page, 'tv-1396').getByTestId('history-title')).toHaveText('Breaking Bad');
  await expect(historyRow(page, 'tv-1396').getByTestId('history-year')).toHaveText('2008');
  await expect(historyRow(page, 'tv-97546')).toHaveCount(1);
  const st = await sharedState(page);
  expect(st.seen.HG['tv-1396']).toMatchObject({ source: 'manual', snapshot: { title: 'Breaking Bad' } });
  // the search box on the page filters the list
  await tid(page, 'history-search').fill('lasso');
  await expect(tid(page, 'history-row')).toHaveCount(1);
  await tid(page, 'history-search').fill('zzzz');
  await expect(tid(page, 'history-no-results')).toBeVisible();
});

test('History: an on-service title can be added by name too, and a title already added shows as added', async ({ page }) => {
  await startMemoryPhone(page);
  await openTab(page, 'history');
  await tid(page, 'history-add').click();
  await tid(page, 'history-add-input').fill('parks and rec');
  const r = page.locator('[data-testid="history-add-result"][data-item-id="tv-8592"]');
  await expect(r).toBeVisible();
  await r.click();
  await tid(page, 'history-add-input').fill('');
  await tid(page, 'history-add-input').fill('parks and rec');
  await expect(r).toHaveAttribute('data-added', 'true');
  await tid(page, 'history-add-close').click();
  await expect(historyRow(page, 'tv-8592')).toHaveCount(1);
});

test('History: remove then Undo; removing really removes (title returns to New decks)', async ({ page }) => {
  await startMemoryPhone(page);
  await markWatched(page, 'HG', ['tv-8592', 'tv-48891']);
  await openTab(page, 'history');
  await expect(tid(page, 'history-row')).toHaveCount(2);
  expect((await engineDeck(page, { ...REQ, novelty: 'new' })).map((c) => c.id)).not.toContain('tv-8592');

  await historyRow(page, 'tv-8592').getByTestId('history-remove').click();
  await expect(historyRow(page, 'tv-8592')).toHaveCount(0);
  await expect(tid(page, 'toast-action')).toBeVisible();
  expect(Object.keys((await sharedState(page)).seen.HG)).not.toContain('tv-8592');
  expect((await engineDeck(page, { ...REQ, novelty: 'new' })).map((c) => c.id)).toContain('tv-8592');

  await tid(page, 'toast-action').click();
  await expect(historyRow(page, 'tv-8592')).toHaveCount(1);
  expect(Object.keys((await sharedState(page)).seen.HG)).toContain('tv-8592');
  expect((await engineDeck(page, { ...REQ, novelty: 'new' })).map((c) => c.id)).not.toContain('tv-8592');
});

test('History: the me / partner switch shows the other person\'s list', async ({ page }) => {
  await startMemoryPhone(page);
  await markWatched(page, 'HG', ['tv-8592']);
  await markWatched(page, 'BG', ['tv-48891']);
  await openTab(page, 'history');
  await expect(historyRow(page, 'tv-8592')).toHaveCount(1);
  await expect(historyRow(page, 'tv-48891')).toHaveCount(0);
  await tid(page, 'history-person-partner').click();
  await expect(historyRow(page, 'tv-48891')).toHaveCount(1);
  await expect(historyRow(page, 'tv-8592')).toHaveCount(0);
  await tid(page, 'history-person-me').click();
  await expect(historyRow(page, 'tv-8592')).toHaveCount(1);
});

test('History: a watched title disappears from a New request and shows up in Rewatch (through the UI)', async ({ page }) => {
  await startMemoryPhone(page);
  await markWatched(page, 'HG', ['tv-8592']);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  const ids = (await pageThroughDeck(page)).map((c) => c.id);
  expect(ids.length).toBeGreaterThan(3);
  expect(ids).not.toContain('tv-8592');
  await tid(page, 'empty-back').click();
  await askSolo(page, { novelty: 'rewatch' });
  const rew = (await pageThroughDeck(page)).map((c) => c.id);
  expect(rew).toContain('tv-8592');
});
