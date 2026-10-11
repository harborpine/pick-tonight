import { expect, test } from '@playwright/test';
import { openTab, readPairingCode, sharedState, tid, wtw } from '../helpers/app';

/**
 * UPGRADE SAFETY. The owners' household was created by the version-1 app, which is still deployed at LIVE until the lead
 * publishes version 2. This test creates a REAL household through the live old site, then opens the NEW local build and
 * joins it as BG, and checks that nothing from the old data is lost. It can only run while the live site is still v1,
 * so it skips itself (the one acceptable conditional skip) once the live site already has the Matches tab.
 */
const LIVE = 'https://harborpine.github.io/what-to-watch/';

test.describe.configure({ timeout: 300_000 });

async function liveIsAlreadyV2(request: import('@playwright/test').APIRequestContext): Promise<{ v2: boolean; why: string }> {
  const html = await (await request.get(LIVE)).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => new URL(m[1], LIVE).toString());
  for (const src of scripts) {
    const js = await (await request.get(src)).text();
    if (js.includes('tab-matches') || js.includes('"matches-filter') || js.includes('matches-filter')) return { v2: true, why: `found the Matches tab in ${src}` };
  }
  return { v2: false, why: `no Matches tab in ${scripts.length} script(s)` };
}

test('upgrade: a household created on the LIVE old site keeps all its data when the NEW build joins it', async ({ browser, request }, testInfo) => {
  const check = await liveIsAlreadyV2(request);
  test.skip(check.v2, `SKIPPED ON PURPOSE: the live site (${LIVE}) is already version 2 (${check.why}), so there is no old version left to upgrade from.`);

  const u = testInfo.project.use;
  const ctxOpts = {
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    serviceWorkers: 'block' as const,
  };
  const oldCtx = await browser.newContext(ctxOpts);
  const newCtx = await browser.newContext({ ...ctxOpts, baseURL: u.baseURL ?? 'http://localhost:4173' });
  const oldP = await oldCtx.newPage();
  const newP = await newCtx.newPage();
  let newReady = false;
  try {
    // ---- 1. The OLD live site: HG creates the household -------------------------------------------------
    await oldP.goto(`${LIVE}?debug=1`);
    await tid(oldP, 'person-HG').click();
    await tid(oldP, 'start-household').click();
    await expect(tid(oldP, 'onboarding')).toBeVisible({ timeout: 45_000 });
    await expect(tid(oldP, 'tab-matches')).toHaveCount(0); // really the old app

    // tick a few titles in the first-run grid (ids read from the page)
    const tileIds = (await oldP.locator('[data-testid^="onboard-item-"]').evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute('data-item-id') ?? ''))).filter(Boolean);
    expect(tileIds.length).toBe(4);
    for (const id of tileIds) await tid(oldP, `onboard-item-${id}`).click();
    await tid(oldP, 'onboard-done').click();
    await expect(tid(oldP, 'ask')).toBeVisible();

    // a deck: save the first card to the watchlist (mine), say yes to the second (old behaviour: pick screen + History)
    await tid(oldP, 'ask-submit').click();
    await expect(tid(oldP, 'card')).toBeVisible({ timeout: 30_000 });
    const saved = (await tid(oldP, 'card').getAttribute('data-item-id'))!;
    const savedTitle = ((await tid(oldP, 'card-title').textContent()) ?? '').trim();
    await tid(oldP, 'action-save').click();
    await tid(oldP, 'save-option-HG').click();
    await expect(oldP.locator(`[data-testid="card"][data-item-id="${saved}"]`)).toHaveCount(0);
    await expect(tid(oldP, 'card')).toBeVisible();
    const picked = (await tid(oldP, 'card').getAttribute('data-item-id'))!;
    const pickedTitle = ((await tid(oldP, 'card-title').textContent()) ?? '').trim();
    await tid(oldP, 'action-yes').click();
    await expect(tid(oldP, 'pick-screen')).toBeVisible();
    await tid(oldP, 'pick-done').click();
    // the old app really recorded all of it before we move on
    await expect.poll(async () => (await sharedState(oldP)).history?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(async () => Object.keys((await sharedState(oldP)).seen.HG).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    expect((await sharedState(oldP)).watchlist.map((w: { itemId: string }) => w.itemId)).toContain(saved);
    const code = await readPairingCode(oldP);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // ---- 2. The NEW build joins as BG ------------------------------------------------------------------------
    await newP.goto('/what-to-watch/?debug=1'); // real catalog from public/data, real Firebase
    await tid(newP, 'person-BG').click();
    await tid(newP, 'have-code').click();
    await tid(newP, 'code-input').fill(code);
    await tid(newP, 'code-submit').click();
    await expect(tid(newP, 'onboarding').or(tid(newP, 'ask'))).toBeVisible({ timeout: 45_000 });
    newReady = true;
    if ((await tid(newP, 'onboarding').count()) > 0) await tid(newP, 'onboard-skip').click();
    await expect(tid(newP, 'ask')).toBeVisible();
    await expect(tid(newP, 'tab-matches')).toBeVisible();
    await expect(tid(newP, 'tab-history')).toBeVisible();

    // HG's ticked titles are in HG's History (the partner view on BG's phone)
    await openTab(newP, 'history');
    await tid(newP, 'history-person-partner').click();
    for (const id of tileIds) {
      await expect(newP.locator(`[data-testid="history-row"][data-item-id="${id}"]`), `ticked title ${id} in HG's History`).toHaveCount(1, { timeout: 45_000 });
    }
    // the old solo pick is NOT a watched title
    await expect(newP.locator(`[data-testid="history-row"][data-item-id="${picked}"]`)).toHaveCount(0);
    const st = await sharedState(newP);
    for (const id of tileIds) expect(st.seen.HG[id], `${id} read as a watched entry`).toMatchObject({ source: expect.any(String) });

    // the watchlist entry
    await openTab(newP, 'watchlist');
    await tid(newP, 'watchlist-tab-hers').click(); // HG's list, from BG's side
    await expect(newP.locator(`[data-testid="watchlist-row"][data-item-id="${saved}"]`), `watchlist entry ${savedTitle}`).toHaveCount(1, { timeout: 45_000 });

    // the old solo pick is in Matches
    await openTab(newP, 'matches');
    await tid(newP, 'matches-filter-HG').click();
    const pickRow = newP.locator(`[data-testid="match-row"][data-item-id="${picked}"]`);
    await expect(pickRow, `old solo pick ${pickedTitle} in Matches`).toHaveCount(1, { timeout: 45_000 });
    await expect(pickRow.getByTestId('match-label')).toContainText('HG');
    expect(st.picks.map((p: { itemId: string }) => p.itemId)).toContain(picked);

    // ---- 3. Write from the NEW build, then check the OLD page still works --------------------------------------
    // pick another title from the old page's deck and mark it watched for HG from the new build (through the debug hook)
    const other = await oldP.evaluate(() => {
      const w = (window as any).__wtw;
      const s = w.sync.getState();
      const known = new Set([...Object.keys(s.seen.HG)]);
      return w.catalog.items.map((i: { id: string }) => i.id).find((id: string) => !known.has(id)) as string;
    });
    expect(other).toBeTruthy();
    await wtw(
      newP,
      async (w, a) => {
        await w.sync.markWatched('HG', [{ itemId: a.id, source: 'manual', snapshot: { title: 'x', year: 2000, poster: null } }]);
      },
      { id: other },
    );
    // the old page, still open, sees it live
    await expect.poll(async () => Object.keys((await sharedState(oldP)).seen.HG), { timeout: 45_000 }).toContain(other);
    // ...and after a reload it loads normally, with a working deck
    await oldP.reload();
    await expect(tid(oldP, 'ask')).toBeVisible({ timeout: 45_000 });
    await expect(tid(oldP, 'setup')).toHaveCount(0);
    expect(Object.keys((await sharedState(oldP)).seen.HG)).toContain(other);
    for (const id of tileIds) expect(Object.keys((await sharedState(oldP)).seen.HG)).toContain(id);
    await tid(oldP, 'ask-submit').click();
    await expect(tid(oldP, 'card')).toBeVisible({ timeout: 30_000 });
    await expect(tid(oldP, 'card-title')).not.toHaveText('');
    // the old History tab still lists its pick
    await openTab(oldP, 'history');
    await expect(oldP.locator(`[data-testid="history-row"][data-item-id="${picked}"]`)).toHaveCount(1, { timeout: 30_000 });
    // and a title the old app marked itself still reads fine in the new one (round trip)
    expect(Object.keys((await sharedState(newP)).seen.HG)).toContain(other);
  } catch (e) {
    for (const [name, p] of [['old-live', oldP], ['new-local', newP]] as const) {
      await testInfo.attach(`${name}.png`, { body: await p.screenshot({ timeout: 5000 }).catch(() => Buffer.from('')), contentType: 'image/png' }).catch(() => {});
    }
    throw e;
  } finally {
    // clean up the real household from the NEW build (falls back to the old page if the new build never joined)
    const cleaner = newReady ? newP : oldP;
    await cleaner
      .evaluate(async () => {
        const w = window as any;
        await Promise.race([w.__wtw?.sync.destroyHousehold?.(), new Promise((r) => setTimeout(r, 20_000))]);
      })
      .catch(() => {});
    await oldCtx.close().catch(() => {});
    await newCtx.close().catch(() => {});
  }
});
