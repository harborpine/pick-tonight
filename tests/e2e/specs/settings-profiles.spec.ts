import { expect, test, type Page } from '@playwright/test';
import { REQ, askSolo, engineDeck, openTab, pageThroughDeck, sharedState, startMemoryPhone, tid } from '../helpers/app';

async function goSettings(page: Page) {
  await openTab(page, 'us');
  await tid(page, 'us-seg-settings').click();
  await expect(tid(page, 'settings')).toBeVisible();
}
async function goProfile(page: Page, who: 'HG' | 'BG') {
  await openTab(page, 'us');
  await tid(page, `us-seg-${who}`).click();
  await expect(tid(page, `profile-${who}`)).toBeVisible();
}

test('settings: the six plans show the household defaults', async ({ page }) => {
  await startMemoryPhone(page);
  await goSettings(page);
  const expected: Record<string, string> = {
    netflix: 'standard',
    disney: 'premium',
    hulu: 'ads',
    hbo: 'ads',
    peacock: 'premium',
    paramount: 'essential',
  };
  for (const [svc, plan] of Object.entries(expected)) {
    await expect(tid(page, `plan-${svc}`)).toBeVisible();
    await expect(tid(page, `plan-${svc}-${plan}`)).toHaveAttribute('data-selected', 'true');
    await expect(tid(page, `plan-${svc}-none`)).toHaveAttribute('data-selected', 'false');
  }
});

test('settings: Peacock Premium Plus makes Poker Face available; it stays hidden before', async ({ page }) => {
  await startMemoryPhone(page);
  // before: not in the engine's deck, not in a full page-through
  expect((await engineDeck(page, REQ)).map((c) => c.id)).not.toContain('tv-120998');
  await goSettings(page);
  await tid(page, 'plan-peacock-premium-plus').click();
  await expect(tid(page, 'plan-peacock-premium-plus')).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'plan-peacock-premium')).toHaveAttribute('data-selected', 'false');
  expect((await sharedState(page)).settings.plans.peacock).toBe('premium-plus');

  await openTab(page, 'tonight');
  await askSolo(page, { who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
  const deck = await pageThroughDeck(page);
  const pf = deck.find((c) => c.id === 'tv-120998');
  expect(pf, 'Poker Face is offered once Peacock is Premium Plus').toBeTruthy();
  expect(pf!.service).toBe('Peacock');
  expect(pf!.adFree, 'Premium Plus is the ad-free Peacock tier').toBe(true);
  // ...and the plan change survives a reload
  await page.reload();
  await goSettings(page);
  await expect(tid(page, 'plan-peacock-premium-plus')).toHaveAttribute('data-selected', 'true');
});

test('settings: "Not subscribed" removes a service; titles move to another service', async ({ page }) => {
  await startMemoryPhone(page);
  // control: today Netflix titles are offered, HIMYM is shown on Netflix
  const before = await engineDeck(page, REQ);
  expect(before.some((c) => c.service === 'netflix')).toBe(true);

  await goSettings(page);
  await tid(page, 'plan-netflix-none').click();
  await expect(tid(page, 'plan-netflix-none')).toHaveAttribute('data-selected', 'true');
  await openTab(page, 'tonight');
  await askSolo(page, { who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
  const deck = await pageThroughDeck(page);
  expect(deck.length).toBeGreaterThan(8);
  expect(deck.filter((c) => c.service === 'Netflix')).toEqual([]);
  // Netflix exclusives are gone (Disenchantment: Netflix only)...
  expect(deck.map((c) => c.id)).not.toContain('tv-73021');
  // ...and HIMYM falls back to Hulu with ads (v2: it is a seen favourite, so ask for Rewatch to be sure it is in the deck)
  await tid(page, 'empty-back').click();
  await askSolo(page, { novelty: 'rewatch' });
  const rew = await pageThroughDeck(page);
  expect(rew.filter((c) => c.service === 'Netflix')).toEqual([]);
  const himym = rew.find((c) => c.id === 'tv-1100');
  expect(himym).toBeTruthy();
  expect([himym!.service, himym!.adFree]).toEqual(['Hulu', false]);
});

test('settings: pairing code is shown and can be hidden; About credits TMDB and JustWatch', async ({ page }) => {
  await startMemoryPhone(page);
  await goSettings(page);
  await tid(page, 'show-pairing-code').click();
  await expect(tid(page, 'pairing-code')).toHaveText(/^\s*[A-Z0-9 ]{5,8}\s*$/);
  await tid(page, 'hide-pairing-code').click();
  await expect(tid(page, 'pairing-code')).toHaveCount(0);

  await expect(tid(page, 'about')).toBeVisible();
  await expect(tid(page, 'about-tmdb')).toHaveText('This product uses the TMDB API but is not endorsed or certified by TMDB.');
  await expect(tid(page, 'about-justwatch')).toHaveText('Streaming availability data provided by JustWatch.');
  await expect(tid(page, 'about-built')).toContainText('Catalog last updated');
  // Unpair asks first
  await tid(page, 'unpair').click();
  await expect(tid(page, 'unpair-sheet')).toBeVisible();
  await tid(page, 'unpair-cancel').click();
  await expect(tid(page, 'unpair-sheet')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

test('profiles: favourites are listed and "what it has learned" is plain language', async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'HG');
  await expect(tid(page, 'profile-favorites')).toContainText('Scrubs');
  await expect(tid(page, 'profile-favorites')).toContainText('How I Met Your Mother');
  const lines = tid(page, 'insight-line');
  expect(await lines.count()).toBeGreaterThanOrEqual(4);
  const texts = await tid(page, 'insight-text').allTextContents();
  for (const t of texts) {
    expect(t.length, 'line is not empty').toBeGreaterThan(8);
    expect(t, `"${t}" looks technical`).not.toMatch(/undefined|NaN|\[object|genre:|keyword:|trait:|_|\{|\}/);
    expect(t).toMatch(/[a-z]{3}/);
  }
  await goProfile(page, 'BG');
  await expect(tid(page, 'profile-favorites')).toContainText('Gilmore Girls');
});

test('profiles: "more" / "less" corrections stick (across tabs and reloads) and can be cleared', async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'HG');
  const keys = await tid(page, 'insight-line').evaluateAll((els) => els.map((e) => e.getAttribute('data-key') ?? ''));
  expect(keys.length).toBeGreaterThanOrEqual(3);
  const [kMore, kLess] = [keys[0], keys[1]];
  const line = (k: string) => page.locator(`[data-testid="insight-line"][data-key="${k}"]`);

  await line(kMore).getByTestId('insight-more').click();
  await expect(line(kMore)).toHaveAttribute('data-correction', 'more');
  await line(kLess).getByTestId('insight-less').click();
  await expect(line(kLess)).toHaveAttribute('data-correction', 'less');

  // leave and come back, then reload the whole app
  await openTab(page, 'history');
  await goProfile(page, 'HG');
  await expect(line(kMore)).toHaveAttribute('data-correction', 'more');
  await page.reload();
  await goProfile(page, 'HG');
  await expect(line(kMore)).toHaveAttribute('data-correction', 'more');
  await expect(line(kLess)).toHaveAttribute('data-correction', 'less');
  expect((await sharedState(page)).profiles.HG.taste.corrections).toMatchObject({ [kMore]: 'more', [kLess]: 'less' });

  await line(kMore).getByTestId('insight-clear').click();
  await expect(line(kMore)).toHaveAttribute('data-correction', '');
});

test("profiles: swiping teaches the app (HG's lines react to a Never / yes)", async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'HG');
  const before = (await sharedState(page)).profiles.HG.taste;
  await openTab(page, 'tonight');
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120 });
  await tid(page, 'action-never').click();
  await tid(page, 'never-confirm').click();
  await expect
    .poll(async () => JSON.stringify((await sharedState(page)).profiles.HG.taste), { message: 'learning changed something' })
    .not.toBe(JSON.stringify(before));
});

test('profiles: dealbreakers are on for BG and off for HG; toggling them changes what is offered', async ({ page }) => {
  await startMemoryPhone(page);
  // BG: all three on
  await goProfile(page, 'BG');
  for (const k of ['horror', 'trueCrime', 'scary']) await expect(tid(page, `dealbreaker-${k}`)).toHaveAttribute('data-on', 'true');
  // HG: all off
  await goProfile(page, 'HG');
  for (const k of ['horror', 'trueCrime', 'scary']) await expect(tid(page, `dealbreaker-${k}`)).toHaveAttribute('data-on', 'false');

  // BG cannot be scared...
  await openTab(page, 'tonight');
  await tid(page, 'ask-who-BG').click();
  await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);

  // ...until her dealbreakers are switched off
  await goProfile(page, 'BG');
  for (const k of ['horror', 'trueCrime', 'scary']) {
    await tid(page, `dealbreaker-${k}`).click();
    await expect(tid(page, `dealbreaker-${k}`)).toHaveAttribute('data-on', 'false');
  }
  await openTab(page, 'tonight');
  await tid(page, 'ask-who-BG').click();
  await expect(tid(page, 'ask-mood-scared')).toBeVisible();
  await askSolo(page, { who: 'BG', mood: 'scared', time: 120, viewing: 'focused', novelty: 'either' });
  const deck = await pageThroughDeck(page);
  expect(deck.map((c) => c.id), 'BG can now get a scary title').toContain('movie-419430');
  await tid(page, 'empty-back').click();

  // And the other way round: HG turning on "nothing scary" removes Scared for him
  await goProfile(page, 'HG');
  await tid(page, 'dealbreaker-scary').click();
  await expect(tid(page, 'dealbreaker-scary')).toHaveAttribute('data-on', 'true');
  await openTab(page, 'tonight');
  await tid(page, 'ask-who-HG').click();
  await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
  // (and Together is still not scary-offering: BG's other settings are off now, HG's scary is on)
  await tid(page, 'ask-who-Together').click();
  await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
  void REQ;
});

test('profiles: seen list can be edited, and the grid can be re-opened from the profile', async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'HG');
  await expect(tid(page, 'seen-list')).toBeVisible();
  await tid(page, 'profile-redo-onboarding').click();
  await expect(tid(page, 'onboarding')).toBeVisible();
  // untick/tick one and finish
  const tile = tid(page, 'onboard-item-tv-8592');
  await tile.click();
  await expect(tile).toHaveAttribute('data-selected', 'true');
  await tid(page, 'onboard-done').click();
  await expect(tid(page, 'tabbar')).toBeVisible();
  await goProfile(page, 'HG');
  const row = page.locator('[data-testid="seen-row"][data-item-id="tv-8592"]');
  if ((await row.count()) === 0) await tid(page, 'seen-show-all').click();
  await expect(row).toHaveCount(1);
  await row.getByTestId('unmark-seen').click();
  await expect(row).toHaveCount(0);
});
