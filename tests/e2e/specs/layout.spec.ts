import { expect, test, type Page } from '@playwright/test';
import {
  MEM_URL,
  askSolo,
  expectInViewport,
  expectNoHorizontalScroll,
  openTab,
  saveCard,
  startMemoryPhone,
  tid,
  wtw,
} from '../helpers/app';

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png` });

/** The tab bar is on screen and nothing important is hidden underneath it. */
async function expectAboveTabbar(page: Page, locator: ReturnType<Page['getByTestId']>, name: string) {
  const tab = (await tid(page, 'tabbar').boundingBox())!;
  const box = (await locator.boundingBox())!;
  expect(box, `${name} has a box`).toBeTruthy();
  expect(box.y + box.height, `${name} is hidden under the tab bar`).toBeLessThanOrEqual(tab.y + 1);
}

test('layout: every main screen fits an iPhone (no sideways scrolling, tab bar and buttons reachable)', async ({ page }) => {
  // --- setup screen
  await page.goto(MEM_URL);
  await expect(tid(page, 'setup')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectInViewport(page, tid(page, 'person-HG'), 'HG button');
  await expectInViewport(page, tid(page, 'person-BG'), 'BG button');
  await shot(page, '01-setup');
  await tid(page, 'person-HG').click();
  await expectInViewport(page, tid(page, 'start-household'), 'start button');
  await shot(page, '02-setup-first-phone');
  await tid(page, 'start-household').click();

  // --- onboarding grid
  await expect(tid(page, 'onboarding')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectInViewport(page, tid(page, 'onboard-done'), 'Done button');
  await expectInViewport(page, tid(page, 'onboard-skip'), 'Skip button');
  await shot(page, '03-onboarding');
  await tid(page, 'onboard-skip').click();

  // --- ask screen
  await expect(tid(page, 'ask')).toBeVisible();
  await expect(tid(page, 'tabbar')).toBeVisible();
  await expectInViewport(page, tid(page, 'tabbar'), 'tab bar');
  await expectNoHorizontalScroll(page);
  await shot(page, '04-ask-top');
  await tid(page, 'ask-group-genre').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  {
    // the last question must not be hidden behind the floating Show me button
    const g = (await tid(page, 'ask-group-genre').boundingBox())!;
    const b = (await tid(page, 'ask-submit').boundingBox())!;
    expect(g.y + g.height, 'genre question is hidden behind the Show me button').toBeLessThanOrEqual(b.y + 1);
  }
  await expectAboveTabbar(page, tid(page, 'ask-submit'), 'Show me button');
  await expectInViewport(page, tid(page, 'ask-submit'), 'Show me button');
  await shot(page, '05-ask-bottom');
  // every chip in the fixed rows keeps the page margin (nothing touches or runs past the screen edge)
  for (const group of ['who', 'viewing', 'time', 'novelty']) {
    for (const chip of await page.locator(`[data-testid="ask-group-${group}"] [data-selected]`).all()) {
      const b = (await chip.boundingBox())!;
      expect(b.x + b.width, `a chip in the "${group}" row touches the right screen edge`).toBeLessThanOrEqual(page.viewportSize()!.width - 8);
    }
  }
  // every mood chip fits the width
  for (const m of await page.locator('[data-testid^="ask-mood-"]').all()) {
    const b = (await m.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }

  // --- solo deck
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'card')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectInViewport(page, tid(page, 'card'), 'card');
  await expectInViewport(page, tid(page, 'card-title'), 'card title');
  await expectInViewport(page, tid(page, 'card-service'), 'card service');
  await expectInViewport(page, tid(page, 'card-pick'), 'card pick');
  await expectInViewport(page, tid(page, 'tabbar'), 'tab bar');
  for (const a of ['action-yes', 'action-not-tonight', 'action-seen', 'action-save', 'action-never']) {
    await expectInViewport(page, tid(page, a), a);
    await expectAboveTabbar(page, tid(page, a), a);
    const b = (await tid(page, a).boundingBox())!;
    expect(b.width, `${a} is a comfortable tap target`).toBeGreaterThanOrEqual(40);
    expect(b.height, `${a} is a comfortable tap target`).toBeGreaterThanOrEqual(40);
  }
  // card is not covered by the action buttons
  const card = (await tid(page, 'card').boundingBox())!;
  const yes = (await tid(page, 'action-yes').boundingBox())!;
  expect(card.y + card.height, 'card runs into the buttons').toBeLessThanOrEqual(yes.y + 2);
  await shot(page, '06-card');
  await tid(page, 'card-info').click();
  await shot(page, '07-card-description');
  await tid(page, 'card-overview').click();

  // sheets
  await tid(page, 'action-save').click();
  await page.waitForTimeout(600); // sheet slides in
  await expectInViewport(page, tid(page, 'save-sheet'), 'save sheet');
  await shot(page, '08-save-sheet');
  await tid(page, 'save-option-ours').click();
  await tid(page, 'action-never').click();
  await page.waitForTimeout(600);
  await expectInViewport(page, tid(page, 'never-sheet'), 'never sheet');
  await expectInViewport(page, tid(page, 'never-confirm'), 'never confirm');
  await shot(page, '09-never-sheet');
  await tid(page, 'never-cancel').click();

  // --- pick screen
  await tid(page, 'action-yes').click();
  await expect(tid(page, 'pick-screen')).toBeVisible();
  await page.waitForTimeout(900); // fade-in
  await expectNoHorizontalScroll(page);
  await expectInViewport(page, tid(page, 'pick-done'), 'pick Done');
  await expectInViewport(page, tid(page, 'pick-keep'), 'pick Keep browsing');
  await expectInViewport(page, tid(page, 'pick-title'), 'pick title');
  await shot(page, '10-pick');
  await tid(page, 'pick-done').click();

  // --- watchlist (with something in it), history, new, us
  await askSolo(page, { who: 'HG', mood: 'cozy', time: 120 });
  await saveCard(page, 'HG');
  await openTab(page, 'watchlist');
  await expect(tid(page, 'watchlist-row').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, '11-watchlist');
  await openTab(page, 'history');
  await expect(tid(page, 'history-row').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, '12-history');
  await openTab(page, 'new');
  await expect(tid(page, 'new-row').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, '13-new');
  await tid(page, 'new-row').first().scrollIntoViewIfNeeded();
  await openTab(page, 'us');
  await tid(page, 'us-seg-HG').click();
  await expectNoHorizontalScroll(page);
  await shot(page, '14-profile-hg');
  await tid(page, 'us-seg-BG').click();
  await expectNoHorizontalScroll(page);
  await shot(page, '15-profile-bg');
  await tid(page, 'us-seg-settings').click();
  await expectNoHorizontalScroll(page);
  await shot(page, '16-settings');
  await tid(page, 'show-pairing-code').click();
  await shot(page, '17-settings-code');
  await tid(page, 'about').scrollIntoViewIfNeeded();
  await shot(page, '18-settings-about');

  // tab bar stays put on every tab
  for (const t of ['tonight', 'new', 'watchlist', 'history', 'us'] as const) {
    await openTab(page, t);
    await expectInViewport(page, tid(page, 'tabbar'), `tab bar on ${t}`);
    await expectNoHorizontalScroll(page);
  }
});

test('layout: Together deck and the match moment fit the screen (one phone, simulated partner)', async ({ page }) => {
  await startMemoryPhone(page);
  await tid(page, 'ask-who-Together').click();
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectInViewport(page, tid(page, 'session-status'), 'session status');
  await expectInViewport(page, tid(page, 'card'), 'card');
  await expectInViewport(page, tid(page, 'action-yes'), 'yes');
  await shot(page, '20-together-waiting');
  const sessionId = (await tid(page, 'session-deck').getAttribute('data-session-id'))!;
  const itemId = (await tid(page, 'card').getAttribute('data-item-id'))!;
  await wtw(
    page,
    async (w, a) => {
      await w.sync.joinSession(a.sessionId, 'BG');
      await w.sync.swipeInSession(a.sessionId, 'BG', a.itemId, true, { title: 'x', year: 2000, poster: null });
    },
    { sessionId, itemId },
  );
  await shot(page, '21-together-joined');
  await tid(page, 'action-yes').click();
  await expect(tid(page, 'match-screen')).toBeVisible();
  await page.waitForTimeout(1200); // let the confetti settle in
  await expectNoHorizontalScroll(page);
  await expectInViewport(page, tid(page, 'match-keep'), 'Keep swiping');
  await expectInViewport(page, tid(page, 'match-watching'), "We're watching this");
  await expectInViewport(page, tid(page, 'match-title'), 'match title');
  await shot(page, '22-match');
});

test('layout: the join prompt banner is on screen and does not hide the tab bar', async ({ page }) => {
  await startMemoryPhone(page);
  await wtw(page, async (w) => {
    const req = { who: 'Together', viewing: 'focused', mood: 'laugh', time: 60, novelty: 'either', genre: null };
    const deck = w.engine.buildDeck(req, { catalog: w.catalog, state: w.sync.getState(), today: '2026-01-01' }, { limit: 10 });
    await w.sync.startSession('BG', req, deck);
  });
  await expect(tid(page, 'join-prompt')).toBeVisible();
  await page.waitForTimeout(700); // banner slides in
  await expectInViewport(page, tid(page, 'join-prompt'), 'join prompt');
  await expectInViewport(page, tid(page, 'join-button'), 'join button');
  await expectInViewport(page, tid(page, 'tabbar'), 'tab bar');
  await expectNoHorizontalScroll(page);
  await shot(page, '23-join-prompt');
});
