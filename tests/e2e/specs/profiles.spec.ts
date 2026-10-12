import { expect, test } from '@playwright/test';
import { SAMPLE, ask, createHousehold, openProfile, openTab, pageThroughDeck, quickHousehold, setWho, sharedState, tid, toAsk } from '../helpers/app';

test('profiles: favourites are listed per person and "what it has learned" is plain language', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openProfile(page, h.ids.Alex);
  await expect(tid(page, 'profile-favorites')).toContainText('Scrubs');
  await expect(tid(page, 'profile-favorites')).toContainText('How I Met Your Mother');
  expect(await tid(page, 'insight-line').count()).toBeGreaterThanOrEqual(3);
  for (const t of await tid(page, 'insight-text').allTextContents()) {
    expect(t.length).toBeGreaterThan(8);
    expect(t, `"${t}" looks technical`).not.toMatch(/undefined|NaN|\[object|genre:|keyword:|trait:|_|\{|\}/);
    expect(t).toMatch(/[a-z]{3}/);
  }
  await openProfile(page, h.ids.Sam);
  await expect(tid(page, 'profile-favorites')).toContainText('Gilmore Girls');
  await openProfile(page, h.ids.Kit);
  await expect(tid(page, 'fav-count')).toContainText('None yet');
});

test('profiles: "more" / "less" corrections stick (across tabs and reloads) and can be cleared', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openProfile(page, h.ids.Alex);
  const keys = await tid(page, 'insight-line').evaluateAll((els) => els.map((e) => e.getAttribute('data-key') ?? ''));
  expect(keys.length).toBeGreaterThanOrEqual(3);
  const [kMore, kLess] = [keys[0], keys[1]];
  const line = (k: string) => page.locator(`[data-testid="insight-line"][data-key="${k}"]`);
  await line(kMore).getByTestId('insight-more').click();
  await expect(line(kMore)).toHaveAttribute('data-correction', 'more');
  await line(kLess).getByTestId('insight-less').click();
  await expect(line(kLess)).toHaveAttribute('data-correction', 'less');
  await openTab(page, 'history');
  await openProfile(page, h.ids.Alex);
  await expect(line(kMore)).toHaveAttribute('data-correction', 'more');
  await page.reload();
  await openProfile(page, h.ids.Alex);
  await expect(line(kMore)).toHaveAttribute('data-correction', 'more');
  await expect(line(kLess)).toHaveAttribute('data-correction', 'less');
  expect((await sharedState(page)).profiles[h.ids.Alex].taste.corrections).toMatchObject({ [kMore]: 'more', [kLess]: 'less' });
  await line(kMore).getByTestId('insight-clear').click();
  await expect(line(kMore)).toHaveAttribute('data-correction', '');
});

test('profiles: swiping teaches the app (the learned taste changes after a Never)', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  const before = JSON.stringify((await sharedState(page)).profiles[h.ids.Alex].taste);
  await ask(page, { mood: 'laugh', time: 120 });
  await tid(page, 'action-never').click();
  await tid(page, 'never-confirm').click();
  await expect.poll(async () => JSON.stringify((await sharedState(page)).profiles[h.ids.Alex].taste)).not.toBe(before);
});

test('profiles: never-show-me switches reflect each person and change what is offered, in both directions', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openProfile(page, h.ids.Sam);
  for (const k of ['horror', 'trueCrime', 'scary']) await expect(tid(page, `dealbreaker-${k}`)).toHaveAttribute('data-on', 'true');
  await openProfile(page, h.ids.Alex);
  for (const k of ['horror', 'trueCrime', 'scary', 'subtitled']) await expect(tid(page, `dealbreaker-${k}`)).toHaveAttribute('data-on', 'false');

  await openTab(page, 'tonight');
  await tid(page, `who-${h.ids.Sam}`).click();
  await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
  // switch Sam's choices off: Scared comes back, and a scary title can be offered
  await openProfile(page, h.ids.Sam);
  for (const k of ['horror', 'trueCrime', 'scary']) {
    await tid(page, `dealbreaker-${k}`).click();
    await expect(tid(page, `dealbreaker-${k}`)).toHaveAttribute('data-on', 'false');
  }
  await openTab(page, 'tonight');
  await expect(tid(page, 'ask-mood-scared')).toBeVisible();
  await ask(page, { who: [h.ids.Sam], mood: 'scared', time: 120, viewing: 'focused', novelty: 'either' });
  expect((await pageThroughDeck(page)).map((c) => c.id), 'Sam can now get a scary title').toContain('movie-419430');
  await tid(page, 'empty-back').click();
  // and the other way round: Alex turns on "anything scary"
  await openProfile(page, h.ids.Alex);
  await tid(page, 'dealbreaker-scary').click();
  await openTab(page, 'tonight');
  await toAsk(page);
  await setWho(page, [h.ids.Alex]); // the last question (Sam alone) is remembered
  await expect(tid(page, 'ask-mood-scared')).toHaveCount(0);
  // a whole genre and "not in English" are also switches
  await openProfile(page, h.ids.Alex);
  await tid(page, 'dealbreaker-genre-reality').click();
  await tid(page, 'dealbreaker-subtitled').click();
  const p = (await sharedState(page)).profiles[h.ids.Alex].dealbreakers;
  expect(p.genres).toEqual(['reality']);
  expect(p.subtitled).toBe(true);
});

test('profiles: the seen list can be edited and the tick-what-you-have-seen grid reopened from the page', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0]]);
  await openProfile(page, h.first);
  await expect(tid(page, 'seen-list')).toBeVisible();
  await tid(page, 'profile-redo-onboarding').click();
  await expect(tid(page, 'onboarding')).toBeVisible();
  const tile = tid(page, 'onboard-item-tv-8592');
  await tile.click();
  await expect(tile).toHaveAttribute('data-selected', 'true');
  await tid(page, 'onboard-done').click();
  await expect(tid(page, 'tabbar')).toBeVisible();
  await openProfile(page, h.first);
  const row = page.locator('[data-testid="seen-row"][data-item-id="tv-8592"]');
  if ((await row.count()) === 0) await tid(page, 'seen-show-all').click();
  await expect(row).toHaveCount(1);
  await row.getByTestId('unmark-seen').click();
  await expect(row).toHaveCount(0);
});

test('reload while the "what have you seen" step is open: it asks again until done or skipped', async ({ page }) => {
  await createHousehold(page, { name: 'Jo', stopAtFavourites: true });
  for (const s of ['wizard-favorites', 'wizard-never', 'wizard-import']) {
    await expect(tid(page, s)).toBeVisible();
    await tid(page, 'wizard-skip').click();
  }
  await expect(tid(page, 'wizard-seen')).toBeVisible();
  await page.reload();
  await expect(tid(page, 'wizard-seen')).toBeVisible({ timeout: 30_000 });
  await tid(page, 'wizard-skip').click();
  await tid(page, 'wizard-finish').click();
  await expect(tid(page, 'ask')).toBeVisible();
});
