import { expect, test, type Page } from '@playwright/test';
import {
  REQ,
  act,
  askSolo,
  engineDeck,
  findCard,
  expectInViewport,
  expectNoHorizontalScroll,
  openTab,
  pageThroughDeck,
  parseMinutes,
  readCard,
  sharedState,
  startMemoryPhone,
  swipeCard,
  tid,
  wtw,
} from '../helpers/app';

const matchRow = (page: Page, id: string) => page.locator(`[data-testid="match-row"][data-item-id="${id}"]`);
const historyRow = (page: Page, id: string) => page.locator(`[data-testid="history-row"][data-item-id="${id}"]`);

// ---------------------------------------------------------------------------
// Change 1: Time "I don't care"
// ---------------------------------------------------------------------------

test('time "I don\'t care": selectable, stays inside the screen, and the deck mixes short sitcoms with long films', async ({ page }) => {
  await startMemoryPhone(page);
  const any = tid(page, 'ask-time-any');
  await any.scrollIntoViewIfNeeded();
  await expectInViewport(page, any, 'I don\'t care chip');
  await expectInViewport(page, tid(page, 'ask-group-time'), 'time row');
  for (const t of ['20', '45', '60', '120']) await expectInViewport(page, tid(page, `ask-time-${t}`), `time ${t}`);
  await expectNoHorizontalScroll(page);
  await any.click();
  await expect(any).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-testid="ask-group-time"] [data-selected="true"]')).toHaveCount(1);
  await expect(tid(page, 'ask-time-120')).toHaveAttribute('data-selected', 'false');

  await askSolo(page, { who: 'HG', mood: 'laugh', time: 'any', novelty: 'new' });
  const deck = await pageThroughDeck(page);
  const mins = deck.map((c) => parseMinutes(c.minutes));
  expect(mins.some((m) => m <= 25), 'a short episode (a 22-minute sitcom) is in the deck').toBe(true);
  expect(mins.some((m) => m >= 100), 'a film of 100+ minutes is in the deck').toBe(true);
  // the same through the engine, for all kinds of mood
  const eng = await engineDeck(page, { ...REQ, time: 'any', mood: 'laugh' }, '2099-01-01'); // (a later day, since the page-through above said "not tonight" to everything)
  expect(eng.some((c) => c.minutes <= 25) && eng.some((c) => c.minutes >= 100)).toBe(true);
  // the choice is remembered after a reload
  await page.reload();
  await expect(tid(page, 'ask-time-any')).toHaveAttribute('data-selected', 'true');
});

// ---------------------------------------------------------------------------
// Change 2: solo right swipe stays on the deck
// ---------------------------------------------------------------------------

test('solo yes by a real swipe: no navigation, no overlay, next card shows, Liked counts up, tapping it opens Matches', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  const a = await readCard(page);
  await swipeCard(page, 'right');
  await expect(tid(page, 'solo-deck')).toBeVisible();
  await expect(tid(page, 'pick-screen')).toHaveCount(0);
  await expect(tid(page, 'match-screen')).toHaveCount(0);
  await expect(tid(page, 'liked-count')).toHaveText('1');
  const b = await readCard(page);
  expect(b.id).not.toBe(a.id);
  await tid(page, 'action-yes').click();
  await expect(tid(page, 'liked-count')).toHaveText('2');
  await swipeCard(page, 'right');
  await expect(tid(page, 'liked-count')).toHaveText('3');
  await expectNoHorizontalScroll(page);
  await tid(page, 'liked-chip').click();
  await expect(tid(page, 'matches')).toBeVisible();
  await expect(matchRow(page, a.id)).toHaveCount(1);
  await expect(matchRow(page, b.id)).toHaveCount(1);
  await expect(tid(page, 'match-row')).toHaveCount(3);
});

// ---------------------------------------------------------------------------
// Change 3: the Matches tab
// ---------------------------------------------------------------------------

test('Matches: solo picks (mine and BG\'s) and a Together match, with labels, filters and where to watch', async ({ page }) => {
  await startMemoryPhone(page);
  await openTab(page, 'matches');
  await expect(tid(page, 'matches-empty')).toBeVisible();

  // HG alone
  await openTab(page, 'tonight');
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  const mine = await readCard(page);
  await act(page, 'yes');
  await tid(page, 'deck-back').click();
  // BG's pick, made on this phone while picking for her
  await askSolo(page, { who: 'BG', mood: 'cozy', time: 120, novelty: 'new' });
  const hers = await readCard(page);
  await act(page, 'yes');
  await tid(page, 'deck-back').click();
  // A Together match (the partner is played through the debug hook)
  await tid(page, 'ask-who-Together').click();
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  const sessionId = (await tid(page, 'session-deck').getAttribute('data-session-id'))!;
  const t = await readCard(page);
  await wtw(
    page,
    async (w, a) => {
      await w.sync.joinSession(a.sessionId, 'BG');
      await w.sync.swipeInSession(a.sessionId, 'BG', a.itemId, true, { title: 'x', year: 2000, poster: null });
    },
    { sessionId, itemId: t.id },
  );
  await tid(page, 'action-yes').click();
  await expect(tid(page, 'match-screen')).toBeVisible();
  await tid(page, 'match-watching').click();
  await expect(tid(page, 'ask')).toBeVisible();

  await openTab(page, 'matches');
  await expect(tid(page, 'match-row')).toHaveCount(3);
  await expect(matchRow(page, mine.id).getByTestId('match-label')).toHaveText(/HG/);
  await expect(matchRow(page, hers.id).getByTestId('match-label')).toHaveText(/BG/);
  await expect(matchRow(page, t.id).getByTestId('match-label')).toHaveText(/Match/);
  for (const c of [mine, hers, t]) {
    await expect(matchRow(page, c.id).getByTestId('match-title')).toHaveText(c.title);
    await expect(matchRow(page, c.id).getByTestId('match-pick')).toHaveText(c.pick);
    await expect(matchRow(page, c.id).getByTestId('match-where')).toContainText(c.service);
    await expect(matchRow(page, c.id).getByTestId('match-ad-badge')).toHaveAttribute('data-adfree', String(c.adFree));
  }
  // newest first
  const order = await tid(page, 'match-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')));
  expect(order).toEqual([t.id, hers.id, mine.id]);

  // filters
  const ids = async () => (await tid(page, 'match-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')))).sort();
  await tid(page, 'matches-filter-mine').click();
  expect(await ids()).toEqual([mine.id]);
  await tid(page, 'matches-filter-BG').click();
  expect(await ids()).toEqual([hers.id]);
  await tid(page, 'matches-filter-together').click();
  expect(await ids()).toEqual([t.id]);
  await tid(page, 'matches-filter-all').click();
  expect(await ids()).toEqual([mine.id, hers.id, t.id].sort());

  // detail sheet: what to watch and where
  await matchRow(page, mine.id).click();
  await expect(tid(page, 'match-detail')).toBeVisible();
  await expect(tid(page, 'detail-title')).toHaveText(mine.title);
  await expect(tid(page, 'detail-pick')).toHaveText(mine.pick);
  await expect(tid(page, 'detail-service-name')).toHaveText(mine.service);
  await tid(page, 'match-close').click();
  await expect(tid(page, 'match-detail')).toHaveCount(0);
  // none of them is in History
  await openTab(page, 'history');
  for (const c of [mine, hers, t]) await expect(historyRow(page, c.id)).toHaveCount(0);
});

test('Matches: a picked title leaves new decks for that person (whole deck paged), stays for the other person, and Remove brings it back', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  // a title neither of us has seen, so every audience below could be offered it as New
  const bgFav: string[] = await wtw(page, (w) => w.sync.getState().profiles.BG.favorites);
  const x = (await findCard(page, (c) => !bgFav.includes(c.id)))!;
  expect(x, 'a title new to both of us in the deck').toBeTruthy();
  // sanity: BG alone and Together could also be offered it right now
  expect((await engineDeck(page, { ...REQ, novelty: 'new', who: 'BG' })).map((c) => c.id)).toContain(x.id);
  await act(page, 'yes');
  await tid(page, 'deck-back').click();

  // a new HG deck, paged right through (Seen it would add watched titles, so use Not tonight on a fresh day via the engine below)
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  const again = await pageThroughDeck(page);
  expect(again.length).toBeGreaterThan(3);
  expect(again.map((c) => c.id)).not.toContain(x.id);
  await tid(page, 'empty-back').click();
  // ...and also tomorrow, and for Together, but BG alone can still have it
  expect((await engineDeck(page, { ...REQ, novelty: 'new' }, '2099-01-01')).map((c) => c.id)).not.toContain(x.id);
  expect((await engineDeck(page, { ...REQ, novelty: 'new', who: 'Together' }, '2099-01-01')).map((c) => c.id)).not.toContain(x.id);
  expect((await engineDeck(page, { ...REQ, novelty: 'new', who: 'BG' }, '2099-01-01')).map((c) => c.id)).toContain(x.id);

  // Remove -> back in the deck
  await openTab(page, 'matches');
  await matchRow(page, x.id).click();
  await tid(page, 'match-remove').click();
  await expect(matchRow(page, x.id)).toHaveCount(0);
  expect((await engineDeck(page, { ...REQ, novelty: 'new' }, '2099-01-01')).map((c) => c.id)).toContain(x.id);
  expect((await sharedState(page)).picks).toHaveLength(0);
});

test('Matches: "I watched this" moves a solo pick to History (and out of the deck as New, into Rewatch)', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  const x = await readCard(page);
  await act(page, 'yes');
  await tid(page, 'liked-chip').click();
  await matchRow(page, x.id).click();
  await expect(tid(page, 'match-watched')).toContainText(/watched this/i);
  await tid(page, 'match-watched').click();
  await expect(tid(page, 'toast')).toContainText('Moved to History');
  await expect(matchRow(page, x.id)).toHaveCount(0);
  await openTab(page, 'history');
  const row = historyRow(page, x.id);
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('history-title')).toHaveText(x.title);
  await expect(row).toHaveAttribute('data-source', 'manual');
  const st = await sharedState(page);
  expect(Object.keys(st.seen.HG)).toContain(x.id);
  expect(st.picks.map((p: { itemId: string }) => p.itemId)).not.toContain(x.id);
  expect((await engineDeck(page, { ...REQ, novelty: 'new' })).map((c) => c.id)).not.toContain(x.id);
  expect((await engineDeck(page, { ...REQ, novelty: 'rewatch' })).map((c) => c.id)).toContain(x.id);
});

test('Matches: "We watched this" on a Together match marks both people', async ({ page }) => {
  await startMemoryPhone(page);
  await tid(page, 'ask-who-Together').click();
  await tid(page, 'ask-submit').click();
  const sessionId = (await tid(page, 'session-deck').getAttribute('data-session-id'))!;
  const t = await readCard(page);
  await wtw(
    page,
    async (w, a) => {
      await w.sync.joinSession(a.sessionId, 'BG');
      await w.sync.swipeInSession(a.sessionId, 'BG', a.itemId, true, { title: 'x', year: 2000, poster: null });
    },
    { sessionId, itemId: t.id },
  );
  await tid(page, 'action-yes').click();
  await tid(page, 'match-watching').click();
  await openTab(page, 'matches');
  await matchRow(page, t.id).click();
  await expect(tid(page, 'match-watched')).toContainText('We watched this');
  await tid(page, 'match-watched').click();
  await expect(matchRow(page, t.id)).toHaveCount(0);
  const st = await sharedState(page);
  expect(Object.keys(st.seen.HG)).toContain(t.id);
  expect(Object.keys(st.seen.BG)).toContain(t.id);
  await openTab(page, 'history');
  await expect(historyRow(page, t.id)).toHaveCount(1);
  await tid(page, 'history-person-partner').click();
  await expect(historyRow(page, t.id)).toHaveCount(1);
});

test('Matches: a Together match keeps the title out of Together decks', async ({ page }) => {
  await startMemoryPhone(page);
  await tid(page, 'ask-who-Together').click();
  await tid(page, 'ask-submit').click();
  const sessionId = (await tid(page, 'session-deck').getAttribute('data-session-id'))!;
  const t = await readCard(page);
  await wtw(
    page,
    async (w, a) => {
      await w.sync.joinSession(a.sessionId, 'BG');
      await w.sync.swipeInSession(a.sessionId, 'BG', a.itemId, true, { title: 'x', year: 2000, poster: null });
    },
    { sessionId, itemId: t.id },
  );
  await tid(page, 'action-yes').click();
  await tid(page, 'match-watching').click();
  for (const who of ['Together', 'HG', 'BG'] as const) {
    expect((await engineDeck(page, { ...REQ, who, novelty: 'either' }, '2099-01-01')).map((c) => c.id), `matched title offered to ${who}`).not.toContain(t.id);
  }
});
