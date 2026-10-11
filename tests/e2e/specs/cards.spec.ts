import { expect, test } from '@playwright/test';
import {
  REQ,
  askSolo,
  engineDeck,
  neverCard,
  openTab,
  pageThroughDeck,
  readCard,
  saveCard,
  sharedState,
  startMemoryPhone,
  swipeCard,
  tid,
  todayLocal,
  wtw,
  act,
  type CardInfo,
} from '../helpers/app';

const SERVICES = ['Netflix', 'Disney+', 'Hulu', 'HBO Max', 'Peacock', 'Paramount+'];
const FORMS = {
  movie: /^Movie$/,
  series: /^Start the series$/,
  any: /^Put on any episode$/,
  episode: /^Season \d+, Episode \d+ . .+.$/,
};

test('card content: poster, title, year, length, service + Ad-free/Ads, and every form of "what to watch"', async ({ page }) => {
  await startMemoryPhone(page);
  const seenForms = new Set<string>();
  let looked = 0;
  // Fresh decks until every form of "what to watch" has been seen (episode picks are random per deck).
  for (let attempt = 0; attempt < 8 && seenForms.size < 4; attempt++) {
    await askSolo(page, { who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
    const cards = await pageThroughDeck(page);
    for (const c of cards) {
      looked++;
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.year).toMatch(/^(19|20)\d\d$/);
      expect(c.minutes).toMatch(/^(\d+ min|\d+h( \d+m)?)$/);
      expect(SERVICES).toContain(c.service);
      expect(c.adFree === true || c.adFree === false).toBe(true);
      expect(c.badge.toLowerCase()).toBe(c.adFree ? 'ad-free' : 'ads');
      const form = Object.entries(FORMS).find(([, re]) => re.test(c.pick));
      expect(form, `card ${c.id} has an unrecognised "what to watch": ${c.pick}`).toBeTruthy();
      seenForms.add(form![0]);
      // the form must suit the kind of title
      if (c.id.startsWith('movie-')) expect(c.pick).toMatch(FORMS.movie);
      else expect(c.pick).not.toMatch(FORMS.movie);
    }
    await tid(page, 'empty-back').click();
  }
  expect(looked).toBeGreaterThan(20);
  expect([...seenForms].sort(), 'forms of "what to watch" that appeared').toEqual(['any', 'episode', 'movie', 'series']);
});

test('card content: specific titles show the right "what to watch"', async ({ page }) => {
  await startMemoryPhone(page);
  // v2: "Either" leans new, so the seen favourites (Family Guy, Scrubs, Disenchantment) are asked for as Rewatch, Knives Out as New.
  await askSolo(page, { who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'rewatch' });
  const cards = await pageThroughDeck(page);
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  expect(byId['tv-1434'].pick).toMatch(FORMS.any); // Family Guy: drop-in
  expect(byId['tv-73021'].pick).toMatch(FORMS.series); // Disenchantment: a story to start from the beginning
  expect(byId['tv-4556'].pick).toMatch(/^(Put on any episode|Season 3, Episode 14 . .My Screw Up.)$/); // Scrubs: drop-in with a standout
  await tid(page, 'empty-back').click();
  await askSolo(page, { novelty: 'new' });
  const fresh = Object.fromEntries((await pageThroughDeck(page)).map((c) => [c.id, c]));
  expect(fresh['movie-546554'].pick).toMatch(FORMS.movie); // Knives Out
});

test('card content: placeholder poster is drawn, "i" shows the description, a quick tap does not act', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120 });
  const card = tid(page, 'card');
  const poster = card.locator('.card-poster-wrap');
  await expect(poster).toBeVisible();
  const box = await poster.boundingBox();
  expect(box!.height).toBeGreaterThan(200);
  await expect(tid(page, 'card-overview')).toHaveCount(0);
  await tid(page, 'card-info').click();
  await expect(tid(page, 'card-overview')).toBeVisible();
  await expect(tid(page, 'card-overview')).not.toHaveText('');
});

// ---------------------------------------------------------------------------
// Each card action
// ---------------------------------------------------------------------------

test('Yes (solo): the deck carries on (no screen change), "Liked" counts up, the tap opens Matches with the pick', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120 });
  await expect(tid(page, 'liked-chip')).toHaveCount(0);
  const c = await readCard(page);
  await tid(page, 'action-yes').click();
  // no navigation, no full-screen overlay: the next card is simply showing
  await expect(tid(page, 'solo-deck')).toBeVisible();
  await expect(tid(page, 'pick-screen')).toHaveCount(0);
  await expect(tid(page, 'match-screen')).toHaveCount(0);
  await expect(page.locator(`[data-testid="card"][data-item-id="${c.id}"]`)).toHaveCount(0);
  const next = await readCard(page);
  expect(next.id).not.toBe(c.id);
  await expect(tid(page, 'liked-chip')).toHaveAttribute('data-count', '1');
  await expect(tid(page, 'liked-count')).toHaveText('1');
  await act(page, 'yes');
  await expect(tid(page, 'liked-count')).toHaveText('2');

  await tid(page, 'liked-chip').click();
  await expect(tid(page, 'matches')).toBeVisible();
  const row = page.locator(`[data-testid="match-row"][data-item-id="${c.id}"]`);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-kind', 'solo');
  await expect(row.getByTestId('match-title')).toHaveText(c.title);
  await expect(row.getByTestId('match-label')).toContainText('HG');
  await expect(row.getByTestId('match-pick')).toHaveText(c.pick);
  await expect(row.getByTestId('match-where')).toContainText(c.service);
  await expect(row.getByTestId('match-date')).not.toHaveText('');
  // a right-swipe is not "watched"
  expect(Object.keys((await sharedState(page)).seen.HG)).not.toContain(c.id);
  await openTab(page, 'history');
  await expect(page.locator(`[data-testid="history-row"][data-item-id="${c.id}"]`)).toHaveCount(0);
});

test('Yes by a real swipe right = yes; swipe left = not tonight; an early release springs back', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120 });
  const a = await readCard(page);
  // small drag: springs back, nothing happens
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
  // swipe left
  await swipeCard(page, 'left');
  const b = await readCard(page);
  expect(b.id).not.toBe(a.id);
  const st = await sharedState(page);
  expect(st.notTonight.HG[a.id]).toBe(todayLocal());
  // swipe right
  await swipeCard(page, 'right');
  await expect(tid(page, 'pick-screen')).toHaveCount(0);
  await expect(tid(page, 'solo-deck')).toBeVisible();
  await expect(tid(page, 'liked-count')).toHaveText('1');
  expect((await readCard(page)).id).not.toBe(b.id);
  expect((await sharedState(page)).picks.map((p: { itemId: string }) => p.itemId)).toContain(b.id);
});

test('Not tonight: the card goes away, and a new identical request the same day does not show it', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120 });
  const x = await readCard(page);
  await act(page, 'not-tonight');
  expect((await readCard(page)).id).not.toBe(x.id);
  await tid(page, 'deck-back').click();
  await askSolo(page, {}); // same request again
  const again = await pageThroughDeck(page);
  expect(again.length).toBeGreaterThan(3);
  expect(again.map((c) => c.id)).not.toContain(x.id);
  // ...but it can come back another day
  const tomorrow = await engineDeck(page, { ...REQ, who: 'HG' }, '2099-01-01');
  expect(tomorrow.map((c) => c.id)).toContain(x.id);
});

test('Seen it: card goes away; it is out of New and into Rewatch', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  const x = await readCard(page);
  await act(page, 'seen');
  expect((await readCard(page)).id).not.toBe(x.id);
  const st = await sharedState(page);
  expect(Object.keys(st.seen.HG)).toContain(x.id);
  await tid(page, 'deck-back').click();
  await askSolo(page, { novelty: 'new' });
  expect((await pageThroughDeck(page)).map((c) => c.id)).not.toContain(x.id);
  await tid(page, 'empty-back').click();
  await askSolo(page, { novelty: 'rewatch' });
  expect((await pageThroughDeck(page)).map((c) => c.id)).toContain(x.id);
});

test('Save to watchlist: Mine vs Ours land under the right tab', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120 });
  const a = await readCard(page);
  // the sheet offers Mine and Ours for yourself
  await tid(page, 'action-save').click();
  await expect(tid(page, 'save-sheet')).toBeVisible();
  await expect(tid(page, 'save-option-HG')).toBeVisible();
  await expect(tid(page, 'save-option-ours')).toBeVisible();
  await expect(tid(page, 'save-option-BG')).toHaveCount(0);
  await tid(page, 'save-option-HG').click();
  await expect(page.locator(`[data-testid="card"][data-item-id="${a.id}"]`)).toHaveCount(0);
  const b = await readCard(page);
  await saveCard(page, 'ours');

  await openTab(page, 'watchlist');
  await expect(tid(page, 'watchlist-tab-mine')).toBeVisible();
  const mineRow = (id: string) => page.locator(`[data-testid="watchlist-row"][data-item-id="${id}"]`);
  await tid(page, 'watchlist-tab-mine').click();
  await expect(mineRow(a.id)).toHaveCount(1);
  await expect(mineRow(a.id)).toHaveAttribute('data-list', 'HG');
  await expect(mineRow(b.id)).toHaveCount(0);
  await tid(page, 'watchlist-tab-ours').click();
  await expect(mineRow(b.id)).toHaveCount(1);
  await expect(mineRow(b.id)).toHaveAttribute('data-list', 'ours');
  await expect(mineRow(a.id)).toHaveCount(0);
  await tid(page, 'watchlist-tab-hers').click();
  await expect(tid(page, 'watchlist-empty')).toBeVisible();

  // Detail sheet shows where to watch; Remove empties the list
  await tid(page, 'watchlist-tab-ours').click();
  const row = mineRow(b.id);
  await expect(row.getByTestId('watchlist-title')).toHaveText(b.title);
  await expect(row.getByTestId('watchlist-where')).toContainText(b.service);
  await row.click();
  await expect(tid(page, 'watchlist-detail')).toBeVisible();
  await expect(tid(page, 'detail-title')).toHaveText(b.title);
  await expect(tid(page, 'detail-service-name')).toHaveText(b.service);
  await tid(page, 'watchlist-remove').click();
  await expect(tid(page, 'watchlist-empty')).toBeVisible();
});

test('Save when picking for BG offers Hers / Mine / Ours', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'BG', mood: 'laugh', time: 120 });
  const a = await readCard(page);
  await tid(page, 'action-save').click();
  await expect(tid(page, 'save-option-BG')).toBeVisible();
  await expect(tid(page, 'save-option-HG')).toBeVisible();
  await expect(tid(page, 'save-option-ours')).toBeVisible();
  await tid(page, 'save-option-BG').click();
  await openTab(page, 'watchlist');
  await tid(page, 'watchlist-tab-hers').click();
  await expect(page.locator(`[data-testid="watchlist-row"][data-item-id="${a.id}"]`)).toHaveAttribute('data-list', 'BG');
});

test('Never: asks first; cancel keeps the card; confirm hides it for that person for good, but BG alone can still see it', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120 });
  const x = await readCard(page);
  const forBG = await engineDeck(page, { ...REQ, who: 'BG' });
  expect(forBG.map((c) => c.id), 'precondition: BG could be offered the same title').toContain(x.id);

  await tid(page, 'action-never').click();
  await expect(tid(page, 'never-sheet')).toBeVisible();
  await expect(tid(page, 'never-text')).not.toHaveText('');
  await tid(page, 'never-cancel').click();
  await expect(tid(page, 'never-sheet')).toHaveCount(0);
  expect((await readCard(page)).id).toBe(x.id);

  await neverCard(page);
  await tid(page, 'deck-back').click();
  await askSolo(page, {});
  const all = await pageThroughDeck(page);
  expect(all.map((c) => c.id)).not.toContain(x.id);

  // Even tomorrow, and in a Together request, it stays hidden for HG...
  expect((await engineDeck(page, { ...REQ, who: 'HG' }, '2099-01-01')).map((c) => c.id)).not.toContain(x.id);
  expect((await engineDeck(page, { ...REQ, who: 'Together' })).map((c) => c.id)).not.toContain(x.id);
  // ...but BG alone can still be offered it
  expect((await engineDeck(page, { ...REQ, who: 'BG' })).map((c) => c.id)).toContain(x.id);
  // It is listed (with an undo) under Us > HG
  await tid(page, 'empty-back').click();
  await openTab(page, 'us');
  await tid(page, 'us-seg-HG').click();
  await expect(page.locator(`[data-testid="never-row"][data-item-id="${x.id}"]`)).toHaveCount(1);
  await page.locator(`[data-testid="never-row"][data-item-id="${x.id}"]`).getByTestId('unmark-never').click();
  await expect(page.locator(`[data-testid="never-row"][data-item-id="${x.id}"]`)).toHaveCount(0);
  expect((await engineDeck(page, { ...REQ, who: 'HG' }, '2099-01-01')).map((c) => c.id)).toContain(x.id);
});

test('Together on one phone (memory): the other person can be simulated; both-yes makes a Matches entry', async ({ page }) => {
  // Single-device smoke test of the session UI (the real two-phone version is in together.spec.ts).
  await startMemoryPhone(page);
  await tid(page, 'ask-who-Together').click();
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  const sessionId = await tid(page, 'session-deck').getAttribute('data-session-id');
  const c: CardInfo = await readCard(page);
  await wtw(
    page,
    async (w, a) => {
      await w.sync.joinSession(a.sessionId, 'BG');
      await w.sync.swipeInSession(a.sessionId, 'BG', a.itemId, true, { title: 'x', year: 2000, poster: null });
    },
    { sessionId: sessionId!, itemId: c.id },
  );
  await expect(tid(page, 'session-status')).toHaveAttribute('data-partner-joined', 'true');
  await tid(page, 'action-yes').click();
  await expect(tid(page, 'match-screen')).toHaveAttribute('data-item-id', c.id);
  await expect(tid(page, 'match-service')).toHaveText(c.service);
  await tid(page, 'match-keep').click();
  await openTab(page, 'matches');
  await expect(page.locator(`[data-testid="match-row"][data-item-id="${c.id}"]`)).toHaveAttribute('data-kind', 'match');
  await openTab(page, 'history');
  await expect(page.locator(`[data-testid="history-row"][data-item-id="${c.id}"]`)).toHaveCount(0);
});
