import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_PLANS } from '../../../src/contracts/fixtures/catalog';
import {
  MEM_URL,
  SAMPLE,
  act,
  ask,
  createHousehold,
  expectInViewport,
  expectNothingClippedSideways,
  openSettings,
  openTab,
  pickServices,
  quickHousehold,
  shot,
  startTogether,
  tid,
} from '../helpers/app';

/**
 * Layout at iPhone size. Every screen: no sideways scroll, nothing sticking out of the screen, primary buttons in view.
 * Screenshots go to the git-ignored test-results/screens/ folder so they can be looked at.
 */
async function check(page: Page, name: string) {
  await expectNothingClippedSideways(page, name);
  await shot(page, name);
}

test('first-run screens: welcome, create-or-join, name, long services list, each wizard step, done', async ({ page }) => {
  await page.goto(MEM_URL);
  await expect(tid(page, 'welcome')).toBeVisible();
  await check(page, 'welcome');
  await expectInViewport(page, tid(page, 'continue-in-browser'), 'continue in browser (no scrolling needed)');
  await tid(page, 'continue-in-browser').click();
  await expect(tid(page, 'setup')).toBeVisible();
  await check(page, 'setup-choose');
  await expectInViewport(page, tid(page, 'start-household'), 'start household');
  await expectInViewport(page, tid(page, 'have-code'), 'have code');
  await tid(page, 'have-code').click();
  await check(page, 'setup-code');
  await expectInViewport(page, tid(page, 'code-submit'), 'continue (code)');
  await tid(page, 'code-back').click();
  await tid(page, 'start-household').click();
  await tid(page, 'name-input').fill('W'.repeat(20));
  await check(page, 'setup-name');
  await expectInViewport(page, tid(page, 'wizard-next'), 'Next on the name step');
  await tid(page, 'wizard-next').click();

  // the long services list (30 services): scrolls inside the page, the footer button stays reachable
  await expect(tid(page, 'setup-services')).toBeVisible();
  await check(page, 'setup-services-empty');
  await expectInViewport(page, tid(page, 'wizard-next'), 'Next on the services step');
  await pickServices(page, [['netflix', 'standard'], ['hulu', 'ads'], ['peacock', 'premium-plus'], ['paramount', 'premium']]);
  await tid(page, 'service-toggle-hulu').scrollIntoViewIfNeeded();
  await check(page, 'setup-services-chosen');
  await tid(page, 'service-toggle-roku').scrollIntoViewIfNeeded();
  await check(page, 'setup-services-bottom');
  await expectInViewport(page, tid(page, 'wizard-next'), 'Next after scrolling the services list');
  await tid(page, 'wizard-next').click();

  await expect(tid(page, 'wizard-favorites')).toBeVisible({ timeout: 30_000 });
  await tid(page, 'fav-search').fill('office');
  await expect(tid(page, 'fav-result').first()).toBeVisible();
  await check(page, 'wizard-favorites');
  await expectInViewport(page, tid(page, 'wizard-next'), 'Next on favourites');
  await expectInViewport(page, tid(page, 'wizard-skip'), 'Skip on favourites');
  await tid(page, 'wizard-skip').click();
  await expect(tid(page, 'wizard-never')).toBeVisible();
  await check(page, 'wizard-never');
  await expectInViewport(page, tid(page, 'wizard-next'), 'Next on never');
  await tid(page, 'wizard-skip').click();
  await expect(tid(page, 'wizard-import')).toBeVisible();
  await check(page, 'wizard-import');
  await expectInViewport(page, tid(page, 'wizard-next'), 'Next on import');
  await tid(page, 'wizard-skip').click();
  await expect(tid(page, 'wizard-seen')).toBeVisible();
  await expect(page.locator('[data-testid^="onboard-item-"]').first()).toBeVisible();
  await check(page, 'wizard-seen');
  await expectInViewport(page, tid(page, 'wizard-next'), 'Next on the seen grid');
  await tid(page, 'wizard-skip').click();
  await expect(tid(page, 'wizard-done')).toBeVisible();
  await check(page, 'wizard-done');
  await expectInViewport(page, tid(page, 'wizard-finish'), 'Start picking');
  await expectInViewport(page, tid(page, 'solo-warning'), 'solo warning');
});

test('the main tabs for a household of four with 20-character names', async ({ page }) => {
  const long = (c: string) => c.repeat(20);
  const names = [long('M'), long('W'), long('i'), long('O')];
  const h = await quickHousehold(page, names.map((name, i) => ({ name, like: (['alex', 'sam', 'kit', 'alex'] as const)[i] })));
  await expect(tid(page, 'ask')).toBeVisible();
  await expect(tid(page, 'who-everyone')).toBeVisible();
  await check(page, 'ask-four-long-names');
  for (const n of names) await expectInViewport(page, tid(page, `who-${h.ids[n]}`), `chip ${n.slice(0, 3)}`);
  await tid(page, 'who-everyone').click();
  await check(page, 'ask-four-everyone');
  await tid(page, 'ask-submit').scrollIntoViewIfNeeded();
  await expectInViewport(page, tid(page, 'ask-submit'), 'Start together');
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  await check(page, 'session-waiting-four-long-names');
  await expectInViewport(page, tid(page, 'action-yes'), 'Yes button');
  for (const t of ['watchlist', 'matches', 'history', 'new', 'us']) {
    await openTab(page, t as 'watchlist');
    await expect(tid(page, t === 'us' ? 'us' : t === 'new' ? 'new-feed' : t)).toBeVisible();
    await check(page, `tab-${t}-four-long-names`);
  }
  await expectInViewport(page, tid(page, 'tabbar'), 'tab bar');
  // the segmented controls with four long names stay inside the screen (they may scroll inside themselves)
  await openTab(page, 'history');
  await check(page, 'history-four-long-names');
});

test('deck card, match moment, empty states and the sheets', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openTab(page, 'tonight');
  await check(page, 'ask-three');
  await ask(page, { mood: 'laugh', time: 120 });
  await check(page, 'solo-deck');
  for (const a of ['action-yes', 'action-not-tonight', 'action-seen', 'action-save', 'action-never']) await expectInViewport(page, tid(page, a), a);
  await tid(page, 'card-info').click();
  await check(page, 'card-overview');
  await tid(page, 'card-info').click();
  await tid(page, 'action-save').click();
  await check(page, 'save-sheet');
  await expectInViewport(page, tid(page, 'save-option-ours'), 'Ours option');
  await page.keyboard.press('Escape');
  await tid(page, 'save-option-ours').click();
  await tid(page, 'action-never').click();
  await check(page, 'never-sheet');
  await expectInViewport(page, tid(page, 'never-confirm'), 'never confirm');
  await tid(page, 'never-cancel').click();
  await act(page, 'yes');
  await openTab(page, 'matches');
  await check(page, 'matches');
  await tid(page, 'match-row').first().click();
  await check(page, 'match-detail');
  await expectInViewport(page, tid(page, 'match-watched'), 'watched button');
  await tid(page, 'match-close').click();
  // a Together match screen
  await openTab(page, 'tonight');
  await tid(page, 'deck-back').click();
  await startTogether(page, [h.ids.Alex, h.ids.Sam].sort(), { mood: 'laugh' });
  await act(page, 'yes');
  await page.waitForTimeout(700);
  await h.actAs('Sam');
  await check(page, 'join-prompt');
  await tid(page, 'join-button').click();
  await act(page, 'yes');
  await expect(tid(page, 'match-screen')).toBeVisible();
  await page.waitForTimeout(1200);
  await check(page, 'match-screen');
  await expectInViewport(page, tid(page, 'match-watching'), 'We are watching this');
  await expectInViewport(page, tid(page, 'match-keep'), 'Keep swiping');
});

test('settings screens: invite sheet, remove sheet, unpair, delete confirmation, privacy, about', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openSettings(page);
  await check(page, 'settings');
  await tid(page, 'invite-make').scrollIntoViewIfNeeded();
  await tid(page, 'invite-make').click();
  await expect(tid(page, 'invite-code')).toBeVisible();
  await tid(page, 'invite-share').scrollIntoViewIfNeeded();
  await check(page, 'settings-invite');
  await expectInViewport(page, tid(page, 'invite-link'), 'invite link');
  await expectInViewport(page, tid(page, 'invite-code'), 'invite code');
  await tid(page, 'services-edit').scrollIntoViewIfNeeded();
  await tid(page, 'services-edit').click();
  await check(page, 'settings-services-edit');
  await tid(page, 'services-done').scrollIntoViewIfNeeded();
  await tid(page, 'services-done').click();
  await tid(page, `remove-member-${h.ids.Kit}`).scrollIntoViewIfNeeded();
  await tid(page, `remove-member-${h.ids.Kit}`).click();
  await check(page, 'remove-sheet');
  await expectInViewport(page, tid(page, 'remove-confirm'), 'remove confirm');
  await tid(page, 'remove-cancel').click();
  await tid(page, 'unpair').scrollIntoViewIfNeeded();
  await tid(page, 'unpair').click();
  await check(page, 'unpair-sheet');
  await expectInViewport(page, tid(page, 'unpair-confirm'), 'unpair confirm');
  await tid(page, 'unpair-cancel').click();
  await tid(page, 'delete-everything').click();
  await check(page, 'delete-sheet-explain');
  await expectInViewport(page, tid(page, 'delete-continue'), 'delete continue');
  await tid(page, 'delete-continue').click();
  await tid(page, 'delete-input').fill('DELETE');
  await check(page, 'delete-sheet-type');
  await expectInViewport(page, tid(page, 'delete-confirm'), 'delete confirm');
  await tid(page, 'delete-cancel').click();
  await tid(page, 'open-privacy').scrollIntoViewIfNeeded();
  await tid(page, 'open-privacy').click();
  await check(page, 'privacy');
  await tid(page, 'settings-back').click();
  await tid(page, 'open-about').click();
  await check(page, 'about');
  await expectInViewport(page, tid(page, 'about-tmdb-logo'), 'TMDB logo');
});

test('solo-household screens and the solo unpair warning', async ({ page }) => {
  await createHousehold(page, { name: 'Solo', services: Object.entries(FIXTURE_PLANS).map(([id, p]) => [id, p as string] as [string, string]) });
  await check(page, 'ask-solo');
  await openTab(page, 'us');
  await check(page, 'us-solo');
  await openSettings(page);
  await tid(page, 'unpair').scrollIntoViewIfNeeded();
  await tid(page, 'unpair').click();
  await check(page, 'unpair-solo-warning');
  await expectInViewport(page, tid(page, 'unpair-confirm'), 'unpair confirm (solo)');
  await expectInViewport(page, tid(page, 'unpair-solo-warning'), 'solo warning');
  await tid(page, 'unpair-cancel').click();
  for (const t of ['watchlist', 'matches', 'history', 'new']) {
    await openTab(page, t as 'watchlist');
    await check(page, `solo-tab-${t}`);
  }
});
