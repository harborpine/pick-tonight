import { expect, test } from '@playwright/test';
import {
  MEM_URL,
  SAMPLE,
  act,
  ask,
  createHousehold,
  currentCardId,
  markWatched,
  openTab,
  quickHousehold,
  sharedState,
  tid,
  toAsk,
} from '../helpers/app';

test('reload keeps the household, the lists and the tab bar; a deck in progress goes back to the questions', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await ask(page, { mood: 'laugh', time: 120 });
  await act(page, 'yes');
  await markWatched(page, h.first, ['tv-8592']);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(tid(page, 'tabbar')).toBeVisible({ timeout: 30_000 });
  await expect(tid(page, 'ask')).toBeVisible();
  const st = await sharedState(page);
  expect(Object.keys(st.members)).toHaveLength(3);
  expect(st.picks).toHaveLength(1);
  expect(Object.keys(st.seen[h.first])).toContain('tv-8592');
  // the last question is remembered per person
  await expect(tid(page, 'ask-mood-laugh')).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'ask-time-120')).toHaveAttribute('data-selected', 'true');
  for (const t of ['watchlist', 'matches', 'history', 'new', 'us']) {
    await openTab(page, t as 'matches');
    await page.reload();
    await expect(tid(page, 'tabbar')).toBeVisible({ timeout: 30_000 });
  }
  await toAsk(page);
  await expect(tid(page, 'ask')).toBeVisible();
});

test('reload while the first-run setup is open does not lose the person or restart the household', async ({ page }) => {
  await createHousehold(page, { name: 'Jo', stopAtDone: true });
  await page.reload();
  await expect(tid(page, 'wizard-done')).toBeVisible({ timeout: 30_000 });
  const st = await sharedState(page);
  expect(Object.keys(st.members)).toHaveLength(1);
});

test('every browser-storage key the app writes starts with "pt." (the private app shares this origin)', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await ask(page, { mood: 'laugh', time: 120 });
  const first = (await currentCardId(page))!;
  await act(page, 'yes');
  await toAsk(page);
  await tid(page, 'who-everyone').click();
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  await act(page, 'not-tonight');
  await openTab(page, 'new');
  await openTab(page, 'tonight');
  await h.actAs('Sam');
  void first;
  const keys = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(keys.local.length).toBeGreaterThan(0);
  for (const k of [...keys.local, ...keys.session]) expect(k, `storage key "${k}" does not start with pt.`).toMatch(/^pt\./);
  // and cookies are not used at all
  expect(await page.evaluate(() => document.cookie)).toBe('');
  // nor any private-app key
  for (const k of [...keys.local, ...keys.session]) expect(k).not.toMatch(new RegExp('what' + '-to-' + 'watch', 'i'));
});

test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('registers, controls the page after one visit, and the app loads offline afterwards', async ({ page, context }) => {
    await page.goto(MEM_URL);
    await expect(tid(page, 'welcome')).toBeVisible();
    // registered and activated
    await expect
      .poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? 'none'), { timeout: 30_000 })
      .toBe('activated');
    // after one more load, it controls the page
    await page.reload();
    await expect(tid(page, 'welcome').or(tid(page, 'setup'))).toBeVisible();
    await expect.poll(async () => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    // get through setup online once so the catalog code is cached too
    if (await tid(page, 'welcome').isVisible()) await tid(page, 'continue-in-browser').click();
    await tid(page, 'start-household').click();
    await tid(page, 'name-input').fill('Offline Olly');
    await tid(page, 'wizard-next').click();
    await tid(page, 'service-toggle-netflix').click();
    await tid(page, 'plan-netflix-standard').click();
    await tid(page, 'wizard-next').click();
    await expect(tid(page, 'wizard-favorites')).toBeVisible({ timeout: 30_000 });
    for (const s of ['wizard-favorites', 'wizard-never', 'wizard-import', 'wizard-seen']) {
      await expect(tid(page, s)).toBeVisible();
      await tid(page, 'wizard-skip').click();
    }
    await tid(page, 'wizard-finish').click();
    await expect(tid(page, 'ask')).toBeVisible();
    await tid(page, 'ask-submit').click();
    await expect(tid(page, 'card')).toBeVisible();

    // now the network goes away: the app still opens, with the household and a deck
    await context.setOffline(true);
    await page.reload();
    await expect(tid(page, 'tabbar')).toBeVisible({ timeout: 30_000 });
    await expect(tid(page, 'ask')).toBeVisible();
    await askOffline(page, { mood: 'laugh', time: 120 });
    await expect(tid(page, 'card')).toBeVisible();
    await context.setOffline(false);
  });
});

async function askOffline(page: import('@playwright/test').Page, o: { mood: string; time: 120 }) {
  await tid(page, `ask-mood-${o.mood}`).click();
  await tid(page, `ask-time-${o.time}`).click();
  await tid(page, 'ask-submit').click();
}
