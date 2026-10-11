import { expect, test } from '@playwright/test';
import { BASE, MEM_URL, askSolo, openTab, pageThroughDeck, readCard, startMemoryPhone, tid, act } from '../helpers/app';

test('reload mid-deck: still signed in, back on the questions, earlier answers remembered', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'cozy', time: 45, viewing: 'focused', novelty: 'either' });
  const first = await readCard(page);
  await act(page, 'not-tonight');
  const second = await readCard(page);
  await page.reload();
  // lands on the questions (not the setup screen, not a blank page), with the last choices still selected
  await expect(tid(page, 'ask')).toBeVisible();
  await expect(tid(page, 'setup')).toHaveCount(0);
  await expect(tid(page, 'ask-mood-cozy')).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'ask-time-45')).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'tabbar')).toBeVisible();
  // the "not tonight" from before the reload still applies
  await tid(page, 'ask-submit').click();
  const deck = await pageThroughDeck(page);
  expect(deck.map((c) => c.id)).not.toContain(first.id);
  expect(deck.map((c) => c.id)).toContain(second.id);
});

test('reload on every tab keeps the household', async ({ page }) => {
  await startMemoryPhone(page);
  for (const t of ['new', 'watchlist', 'history', 'us'] as const) {
    await openTab(page, t);
    await page.reload();
    await expect(tid(page, 'tabbar')).toBeVisible();
    await expect(tid(page, 'setup')).toHaveCount(0);
  }
});

test('reload while the "what have you seen" grid is open: asks again until done or skipped', async ({ page }) => {
  await page.goto(MEM_URL);
  await tid(page, 'person-HG').click();
  await tid(page, 'start-household').click();
  await expect(tid(page, 'onboarding')).toBeVisible();
  await page.reload();
  await expect(tid(page, 'onboarding')).toBeVisible();
  await tid(page, 'onboard-skip').click();
  await expect(tid(page, 'ask')).toBeVisible();
});

test.describe('service worker', () => {
  test('the app loads with the service worker active, and loads again on reload (also with the network off)', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 664 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'allow',
      baseURL: 'http://localhost:4173',
    });
    const page = await context.newPage();
    try {
      await page.goto(MEM_URL);
      await tid(page, 'person-HG').click();
      await tid(page, 'start-household').click();
      await tid(page, 'onboard-skip').click();
      await expect(tid(page, 'ask')).toBeVisible();

      // the worker registers and takes over
      const state = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return { scope: reg.scope, active: reg.active?.state ?? null };
      });
      expect(state.scope).toContain(BASE);
      expect(state.active).toBe('activated');

      // a reload is served (and now controlled) by the worker
      await page.reload();
      await expect(tid(page, 'ask')).toBeVisible();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      // the manifest is reachable and names the app
      const manifest = await page.evaluate(async () => (await fetch(`${location.pathname.replace(/\/$/, '')}/manifest.webmanifest`)).json());
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBe(BASE);

      // working through a deck still works with the worker in charge
      await tid(page, 'ask-submit').click();
      await expect(tid(page, 'card')).toBeVisible();

      // offline reload: the shell comes from the cache
      await context.setOffline(true);
      await page.goto(MEM_URL);
      await expect(tid(page, 'tabbar')).toBeVisible({ timeout: 20_000 });
      await expect(tid(page, 'ask')).toBeVisible();
    } finally {
      await context.setOffline(false).catch(() => {});
      await context.close();
    }
  });
});
