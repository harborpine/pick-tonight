import { expect, test } from '@playwright/test';
import { FIXTURE_PLANS } from '../../../src/contracts/fixtures/catalog';
import {
  act,
  ask,
  createHousehold,
  currentCardId,
  neverCard,
  myId,
  openProfile,
  openSettings,
  openTab,
  readCard,
  saveCard,
  sharedState,
  swipeCard,
  tid,
  toAsk,
} from '../helpers/app';

const ALL_SIX = Object.entries(FIXTURE_PLANS).map(([id, plan]) => [id, plan as string] as [string, string]);

test.beforeEach(async ({ page }) => {
  await createHousehold(page, { name: 'Robin', services: ALL_SIX });
});

test('a household of one never sees the who-picker or anything "Together"', async ({ page }) => {
  const noTogether = async (label: string) => {
    await expect(page.getByText(/together/i), `"Together" shown on ${label}`).toHaveCount(0);
  };
  await noTogether('Tonight');
  await expect(tid(page, 'ask-group-who')).toHaveCount(0);
  await expect(tid(page, 'ask-submit')).toHaveText('Show me');

  await openTab(page, 'new');
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(tid(page, 'who-picker')).toHaveCount(0);
  await noTogether('New');

  await openTab(page, 'watchlist');
  await expect(page.locator('[data-testid^="watchlist-tab-"]')).toHaveCount(0); // one list only
  await noTogether('Watchlist');

  await openTab(page, 'matches');
  await expect(page.locator('[data-testid^="matches-filter-"]')).toHaveCount(0);
  await noTogether('Matches');

  await openTab(page, 'history');
  await expect(page.locator('[data-testid^="history-person-"]')).toHaveCount(0);
  await noTogether('History');

  await openSettings(page);
  await expect(tid(page, 'settings-members')).toHaveCount(0);
  await expect(page.locator('[data-testid^="us-seg-"]')).toHaveCount(2); // me + settings
  await expect(tid(page, 'page-title').or(page.getByRole('heading', { name: 'You' })).first()).toBeVisible();
});

test('swipe right keeps the deck going, ticks the counter and fills Matches; "I watched this" moves it to History', async ({ page }) => {
  await ask(page, { mood: 'laugh', time: 120 });
  await expect(tid(page, 'solo-deck')).toBeVisible();
  await expect(tid(page, 'liked-chip')).toHaveCount(0);
  const start = Number(((await tid(page, 'deck-count').textContent()) ?? '').match(/\d+/)![0]);
  const first = await readCard(page);
  await act(page, 'yes');
  // still on the deck, counter ticked, next card showing
  await expect(tid(page, 'solo-deck')).toBeVisible();
  await expect(tid(page, 'liked-chip')).toHaveAttribute('data-count', '1');
  await expect(tid(page, 'liked-count')).toHaveText('1');
  await expect(tid(page, 'deck-count')).toContainText(String(start - 1));
  expect((await readCard(page)).id).not.toBe(first.id);
  // a real swipe counts too
  await swipeCard(page, 'right');
  await expect(tid(page, 'liked-count')).toHaveText('2');
  // a left swipe does not
  await swipeCard(page, 'left');
  await expect(tid(page, 'liked-count')).toHaveText('2');

  // Matches: both likes, labelled with my name, with where to watch
  await tid(page, 'liked-chip').click();
  await expect(tid(page, 'matches')).toBeVisible();
  const rows = tid(page, 'match-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByTestId('match-label')).toHaveText('Liked by Robin');
  await expect(rows.first().getByTestId('match-where')).not.toHaveText('');
  await expect(rows.first().getByTestId('match-ad-badge')).toHaveText(/ad-free|ads/i);
  const rowId = (await rows.first().getAttribute('data-item-id'))!;
  await rows.first().click();
  await expect(tid(page, 'match-detail')).toBeVisible();
  await expect(tid(page, 'match-watched')).toHaveText('I watched this');
  await tid(page, 'match-watched').click();
  await expect(rows).toHaveCount(1);
  await openTab(page, 'history');
  const hist = page.locator(`[data-testid="history-row"][data-item-id="${rowId}"]`);
  await expect(hist).toHaveCount(1);
  await expect(hist).toHaveAttribute('data-source', 'manual');
  // a title in Matches or History is not offered again to this person (rule 8 / New)
  await openTab(page, 'tonight');
  await expect(tid(page, 'solo-deck').or(tid(page, 'ask'))).toBeVisible();
});

test('Save goes straight to my one list (no sheet); Never hides it for good; Seen it lands in History; Not tonight comes back another day', async ({ page }) => {
  await ask(page, { mood: 'laugh', time: 120 });
  const saved = (await currentCardId(page))!;
  await saveCard(page); // no sheet: a single list
  await expect(tid(page, 'save-sheet')).toHaveCount(0);
  const never = (await currentCardId(page))!;
  await neverCard(page);
  const seen = (await currentCardId(page))!;
  await act(page, 'seen');
  const later = (await currentCardId(page))!;
  await act(page, 'not-tonight');

  await openTab(page, 'watchlist');
  await expect(page.locator(`[data-testid="watchlist-row"][data-item-id="${saved}"]`)).toHaveCount(1);
  await openTab(page, 'history');
  await expect(page.locator(`[data-testid="history-row"][data-item-id="${seen}"]`)).toHaveCount(1);
  await openProfile(page, await myId(page));
  await expect(page.locator(`[data-testid="never-row"][data-item-id="${never}"]`)).toHaveCount(1);

  // a fresh deck: never / seen / saved-to-watchlist titles are not in it; the "not tonight" one is not shown again TODAY
  await toAsk(page);
  await ask(page, { mood: 'laugh', time: 120, novelty: 'new' });
  const ids: string[] = [];
  for (let i = 0; i < 60; i++) {
    const end = tid(page, 'empty-deck');
    await expect(tid(page, 'card').or(end)).toBeVisible();
    if ((await end.count()) > 0) break;
    ids.push((await currentCardId(page))!);
    await act(page, 'not-tonight');
  }
  expect(ids).not.toContain(never);
  expect(ids).not.toContain(seen);
  expect(ids).not.toContain(later);
  const st = await sharedState(page);
  const me = Object.keys(st.members)[0];
  expect(Object.keys(st.notTonight[me])).toContain(later);
  expect(Object.keys(st.never[me])).toEqual([never]);
});

test('Together is impossible on a household of one, and the unpair confirmation warns about losing the lists', async ({ page }) => {
  await openSettings(page);
  await expect(tid(page, 'unpair')).toBeVisible();
  await tid(page, 'unpair').click();
  await expect(tid(page, 'unpair-sheet')).toBeVisible();
  await expect(tid(page, 'unpair-solo-warning')).toContainText('only person');
  await expect(tid(page, 'unpair-solo-warning')).toContainText('no sign-in');
  await expect(tid(page, 'unpair-confirm')).toContainText(/lose my lists/i);
  await tid(page, 'unpair-cancel').click();
  await expect(tid(page, 'unpair-sheet')).toHaveCount(0);
  await expect(tid(page, 'settings')).toBeVisible(); // cancelled: still paired
});

test('New tab for a person with a few picks renders and the taste page responds to a like', async ({ page }) => {
  await openTab(page, 'new');
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(tid(page, 'new-row').first()).toBeVisible();
  await openTab(page, 'tonight');
  await ask(page, { mood: 'laugh', time: 120 });
  for (let i = 0; i < 4; i++) await act(page, 'yes');
  const me = Object.keys((await sharedState(page)).members)[0];
  await openProfile(page, me);
  // after four likes the app has learned something and says where it came from
  await expect(tid(page, 'insight-line').first()).toBeVisible();
  await expect.poll(async () => (await page.locator('[data-testid="insight-line"] small').allTextContents()).join('|')).toContain('Learned from swipes');
});
