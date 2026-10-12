import { expect, test, type Page } from '@playwright/test';
import {
  REQ,
  SAMPLE,
  act,
  ask,
  currentCardId,
  engineDeck,
  markWatched,
  openTab,
  quickHousehold,
  readCard,
  saveCard,
  sharedState,
  swipeCard,
  tid,
  toAsk,
  wtw,
} from '../helpers/app';

const historyRow = (page: Page, id: string) => page.locator(`[data-testid="history-row"][data-item-id="${id}"]`);
const wlRow = (page: Page, id: string) => page.locator(`[data-testid="watchlist-row"][data-item-id="${id}"]`);

test('Watchlist: tabs for Mine, each other member, and Ours; Save sends the card to the chosen list; "Mark as seen" and Remove work', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await ask(page, { mood: 'laugh', time: 120 });
  const a = (await currentCardId(page))!;
  await tid(page, 'action-save').click();
  await expect(tid(page, 'save-sheet')).toBeVisible();
  await expect(tid(page, `save-option-${h.ids.Alex}`)).toHaveText('Mine');
  await expect(tid(page, 'save-option-ours')).toBeVisible();
  await tid(page, `save-option-${h.ids.Alex}`).click();
  await expect(page.locator(`[data-testid="card"][data-item-id="${a}"]`)).toHaveCount(0);
  const b = (await currentCardId(page))!;
  await saveCard(page, 'ours');
  // picking for Sam: Save defaults to Sam's list and offers hers first
  await toAsk(page);
  await ask(page, { who: [h.ids.Sam], mood: 'laugh', time: 120 });
  const c = (await currentCardId(page))!;
  await tid(page, 'action-save').click();
  await expect(tid(page, `save-option-${h.ids.Sam}`)).toContainText('Sam');
  await tid(page, `save-option-${h.ids.Sam}`).click();
  await expect(page.locator(`[data-testid="card"][data-item-id="${c}"]`)).toHaveCount(0);

  await openTab(page, 'watchlist');
  await expect(tid(page, 'watchlist-tab-mine')).toBeVisible();
  await expect(tid(page, `watchlist-tab-member:${h.ids.Sam}`)).toHaveText('Sam');
  await expect(tid(page, `watchlist-tab-member:${h.ids.Kit}`)).toHaveText('Kit');
  await expect(tid(page, 'watchlist-tab-ours')).toBeVisible();
  await expect(wlRow(page, a)).toHaveCount(1);
  await expect(wlRow(page, a)).toHaveAttribute('data-list', h.ids.Alex);
  await expect(wlRow(page, b)).toHaveCount(0);
  await tid(page, 'watchlist-tab-ours').click();
  await expect(wlRow(page, b)).toHaveCount(1);
  await tid(page, `watchlist-tab-member:${h.ids.Sam}`).click();
  await expect(wlRow(page, c)).toHaveCount(1);
  await tid(page, `watchlist-tab-member:${h.ids.Kit}`).click();
  await expect(tid(page, 'watchlist-empty')).toBeVisible();

  // detail sheet: where to watch; mark seen moves it to History; remove deletes it
  await tid(page, 'watchlist-tab-ours').click();
  await wlRow(page, b).click();
  await expect(tid(page, 'watchlist-detail')).toBeVisible();
  await expect(tid(page, 'detail-title')).not.toHaveText('');
  await expect(tid(page, 'detail-where')).not.toHaveText('');
  await tid(page, 'watchlist-seen').click();
  await expect(wlRow(page, b)).toHaveCount(0);
  await openTab(page, 'history');
  await expect(historyRow(page, b)).toHaveCount(1);
  await openTab(page, 'watchlist');
  await tid(page, 'watchlist-tab-mine').click();
  await wlRow(page, a).click();
  await tid(page, 'watchlist-remove').click();
  await expect(wlRow(page, a)).toHaveCount(0);
  await expect(tid(page, 'watchlist-empty')).toBeVisible();
});

test('Matches: filters and labels by name for 3 people; solo likes, a pair\'s match, Remove', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  // Alex likes one alone
  await ask(page, { mood: 'laugh', time: 120 });
  const alexLike = (await currentCardId(page))!;
  await act(page, 'yes');
  // Sam's like, picked from Alex's phone for Sam? (cards swiped for someone else apply to them)
  await toAsk(page);
  await ask(page, { who: [h.ids.Sam], mood: 'laugh', time: 120 });
  const samLike = (await currentCardId(page))!;
  await act(page, 'yes');
  // a Together match for Alex + Sam, via the sync layer
  const together = await wtw(
    page,
    async (w, a) => {
      const ctx = { catalog: w.catalogs.get().catalog, state: w.sync.getState(), today: '2026-10-11' };
      const card = w.engine.buildDeck({ who: a.who, viewing: 'focused', mood: 'cozy', time: 'any', novelty: 'new', genre: null }, ctx, { limit: 50 })[0];
      const item = w.catalogs.get().catalog.items.find((i: { id: string }) => i.id === card.itemId);
      await w.sync.addPick({ kind: 'match', who: a.who, itemId: card.itemId, snapshot: { title: item.title, year: item.year, poster: null }, pick: card.pick, service: card.service });
      return card.itemId as string;
    },
    { who: [h.ids.Alex, h.ids.Sam].sort() },
  );
  await openTab(page, 'matches');
  await expect(tid(page, 'match-row')).toHaveCount(3);
  const label = (id: string) => page.locator(`[data-testid="match-row"][data-item-id="${id}"] [data-testid="match-label"]`);
  await expect(label(alexLike)).toHaveText('Liked by Alex');
  await expect(label(samLike)).toHaveText('Liked by Sam');
  await expect(label(together)).toHaveText('Match — Alex & Sam');
  await tid(page, 'matches-filter-mine').click();
  await expect(tid(page, 'match-row')).toHaveCount(1);
  await expect(page.locator(`[data-testid="match-row"][data-item-id="${alexLike}"]`)).toHaveCount(1);
  await tid(page, `matches-filter-member:${h.ids.Sam}`).click();
  await expect(tid(page, 'match-row')).toHaveCount(1);
  await expect(page.locator(`[data-testid="match-row"][data-item-id="${samLike}"]`)).toHaveCount(1);
  await tid(page, `matches-filter-member:${h.ids.Kit}`).click();
  await expect(tid(page, 'matches-empty')).toBeVisible();
  await tid(page, 'matches-filter-together').click();
  await expect(tid(page, 'match-row')).toHaveCount(1);
  await expect(label(together)).toBeVisible();
  // Sam's like: opening it from Alex's phone says "Sam watched this"
  await tid(page, 'matches-filter-all').click();
  await page.locator(`[data-testid="match-row"][data-item-id="${samLike}"]`).click();
  await expect(tid(page, 'match-watched')).toHaveText('Sam watched this');
  await tid(page, 'match-remove').click();
  await expect(tid(page, 'match-row')).toHaveCount(2);
  expect((await sharedState(page)).picks.map((p: { itemId: string }) => p.itemId)).not.toContain(samLike);
  // ...and it is allowed back in Sam's decks once removed
  expect((await engineDeck(page, { ...REQ, who: [h.ids.Sam], time: 'any', novelty: 'new' } as never)).map((c) => c.id)).toContain(samLike);
});

test('History: starts empty; a right-swipe never creates an entry; "Seen it" does; the person switch shows each person\'s list', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openTab(page, 'history');
  await expect(tid(page, 'history-empty')).toBeVisible();
  await expect(tid(page, 'history-add')).toBeVisible();
  await expect(tid(page, 'history-favorites-note')).toBeVisible();
  await openTab(page, 'tonight');
  await ask(page, { mood: 'laugh', time: 120, novelty: 'new' });
  const liked = await readCard(page);
  await swipeCard(page, 'right');
  const seenIt = await readCard(page);
  await act(page, 'seen');
  await openTab(page, 'history');
  await expect(historyRow(page, liked.id)).toHaveCount(0);
  const row = historyRow(page, seenIt.id);
  await expect(row).toHaveAttribute('data-source', 'manual');
  await expect(row.getByTestId('history-title')).toHaveText(seenIt.title);
  await expect(row.getByTestId('history-year')).toHaveText(seenIt.year);
  await expect(row.getByTestId('history-date')).not.toHaveText('');
  await expect(row.getByTestId('history-source')).toHaveText(/Marked watched/);
  await expect(tid(page, 'history-count')).toContainText('1');
  expect((await engineDeck(page, { ...REQ, who: [h.ids.Alex], novelty: 'new' } as never)).map((c) => c.id)).not.toContain(seenIt.id);
  expect((await engineDeck(page, { ...REQ, who: [h.ids.Alex], novelty: 'rewatch' } as never)).map((c) => c.id)).toContain(seenIt.id);

  await markWatched(page, h.ids.Sam, ['tv-48891']);
  await tid(page, `history-person-${h.ids.Sam}`).click();
  await expect(historyRow(page, 'tv-48891')).toHaveCount(1);
  await expect(historyRow(page, seenIt.id)).toHaveCount(0);
  await tid(page, `history-person-${h.ids.Kit}`).click();
  await expect(tid(page, 'history-empty')).toBeVisible();
  await tid(page, `history-person-${h.ids.Alex}`).click();
  await expect(historyRow(page, seenIt.id)).toHaveCount(1);
});

test('History: the first-run grid\'s ticks are there, labelled as first-run picks', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]]);
  await toAsk(page);
  await openTab(page, 'us');
  const me = Object.keys((await sharedState(page)).members)[0];
  await tid(page, `us-seg-${me}`).click();
  await tid(page, 'profile-redo-onboarding').click();
  await expect(tid(page, 'onboarding')).toBeVisible();
  const tiles = page.locator('[data-testid^="onboard-item-"]');
  await expect(tiles.first()).toBeVisible();
  const ids = [await tiles.nth(0).getAttribute('data-item-id'), await tiles.nth(1).getAttribute('data-item-id')] as string[];
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await tid(page, 'onboard-done').click();
  await openTab(page, 'history');
  for (const id of ids) {
    await expect(historyRow(page, id)).toHaveAttribute('data-source', 'onboarding');
    await expect(historyRow(page, id).getByTestId('history-source')).toHaveText(/first-run/i);
  }
});

test('History: "Add something I\'ve watched" finds titles by name, including ones not on the services', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]]);
  await openTab(page, 'history');
  await tid(page, 'history-add').click();
  await expect(tid(page, 'history-add-sheet')).toBeVisible();
  await tid(page, 'history-add-input').fill('breaking bad');
  const result = (id: string) => page.locator(`[data-testid="history-add-result"][data-item-id="${id}"]`);
  await expect(result('tv-1396')).toBeVisible({ timeout: 15_000 });
  await expect(result('tv-1396')).toHaveAttribute('data-added', 'false');
  await result('tv-1396').click();
  await expect(result('tv-1396')).toHaveAttribute('data-added', 'true');
  await tid(page, 'history-add-input').fill('ted las');
  await result('tv-97546').click();
  await tid(page, 'history-add-input').fill('qqzzxxvv');
  await expect(tid(page, 'history-add-none')).toBeVisible();
  await tid(page, 'history-add-close').click();
  await expect(historyRow(page, 'tv-1396').getByTestId('history-title')).toHaveText('Breaking Bad');
  await expect(historyRow(page, 'tv-1396').getByTestId('history-year')).toHaveText('2008');
  await expect(historyRow(page, 'tv-97546')).toHaveCount(1);
  await tid(page, 'history-search').fill('lasso');
  await expect(tid(page, 'history-row')).toHaveCount(1);
  await tid(page, 'history-search').fill('zzzz');
  await expect(tid(page, 'history-no-results')).toBeVisible();
});

test('History: remove, then Undo; removing returns the title to New decks', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0]]);
  await markWatched(page, h.first, ['tv-8592', 'tv-48891']);
  await openTab(page, 'history');
  await expect(tid(page, 'history-row')).toHaveCount(2);
  const newIds = async () => (await engineDeck(page, { ...REQ, who: [h.first], novelty: 'new', time: 'any' } as never)).map((c) => c.id);
  expect(await newIds()).not.toContain('tv-8592');
  await historyRow(page, 'tv-8592').getByTestId('history-remove').click();
  await expect(historyRow(page, 'tv-8592')).toHaveCount(0);
  await expect(tid(page, 'toast-action')).toBeVisible();
  expect(await newIds()).toContain('tv-8592');
  await tid(page, 'toast-action').click();
  await expect(historyRow(page, 'tv-8592')).toHaveCount(1);
  expect(await newIds()).not.toContain('tv-8592');
});
