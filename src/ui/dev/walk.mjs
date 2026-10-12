// Dev-only walkthrough with Playwright at 390x844: node src/ui/dev/walk.mjs <outDir> [part]
// Needs `npm run dev`. Parts: solo (default), group, join.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const part = process.argv[3] ?? 'solo';
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:5173/pick-tonight/?catalog=fixture&sync=memory&debug=1';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

const T = (id) => page.getByTestId(id);
let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` });
const overflow = async (label) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
  if (o) errors.push('horizontal overflow: ' + label);
};
const step = async (name) => {
  await shot(name);
  await overflow(name);
};

async function createHousehold(name, serviceIds, favQueries) {
  await T('welcome').waitFor();
  await step('welcome-install');
  await T('continue-in-browser').click();
  await T('setup').waitFor();
  await step('create-or-join');
  await T('start-household').click();
  await T('name-input').fill(name);
  await step('name');
  await T('wizard-next').click();
  await T('setup-services').waitFor();
  for (const id of serviceIds) {
    await T(`service-toggle-${id}`).click();
    const first = page.locator(`[data-testid="service-${id}"] .svc-plans button`).first();
    if (await first.count()) await first.click();
  }
  await step('services');
  await T('wizard-next').click();
  await T('wizard-favorites').waitFor();
  for (const q of favQueries) {
    await T('fav-search').fill(q);
    await page.waitForTimeout(500);
    await page.locator('[data-testid="fav-result"]:not([disabled])').first().click();
  }
  await step('favourites');
  await T('wizard-next').click();
  await T('wizard-never').waitFor();
  await T('dealbreaker-horror').click();
  await T('dealbreaker-genre-reality').click();
  await step('never');
  await T('wizard-next').click();
  await T('wizard-import').waitFor();
  await step('import');
  await T('wizard-skip').click();
  await T('wizard-seen').waitFor();
  await page.locator('[data-testid^="onboard-item-"]').first().waitFor();
  const tiles = page.locator('[data-testid^="onboard-item-"]');
  for (let i = 0; i < 3; i++) await tiles.nth(i).click();
  await step('seen-grid');
  await T('wizard-next').click();
  await T('wizard-done').waitFor();
  await step('done');
  await T('wizard-finish').click();
  await T('tabbar').waitFor();
}

try {
  await page.goto(BASE);
  if (part === 'solo') {
    await createHousehold('Riley', ['netflix', 'hulu', 'disney'], ['office', 'stranger', 'breaking']);
    await step('tonight-ask');
    await T('ask-submit').click();
    await T('card').waitFor();
    await step('deck');
    await T('action-yes').click();
    await page.waitForTimeout(600);
    await T('tab-matches').click();
    await step('matches');
    await page.locator('[data-testid="match-row"]').first().click();
    await step('match-detail');
    await T('match-watched').click();
    await T('tab-history').click();
    await step('history');
    await T('tab-new').click();
    await step('new');
    await T('tab-watchlist').click();
    await step('watchlist');
    await T('tab-us').click();
    await step('us-profile');
    await T('us-seg-settings').click();
    await step('settings');
    await T('invite-make').click();
    await T('invite-code').waitFor();
    await step('invite');
    await T('open-privacy').scrollIntoViewIfNeeded();
    await T('open-privacy').click();
    await step('privacy');
    await T('settings-back').click();
    await T('open-about').click();
    await step('about');
    await T('settings-back').click();
    await T('unpair').click();
    await step('unpair-solo');
    await T('unpair-cancel').click();
    await T('delete-everything').click();
    await T('delete-continue').click();
    await step('delete-type');
    await T('delete-input').fill('DELETE');
    await T('delete-confirm').click();
    await T('welcome').waitFor({ timeout: 8000 }).catch(() => {});
    await step('after-delete');
  }
  if (part === 'group') {
    await createHousehold('Alex', ['netflix', 'hulu'], ['office', 'stranger']);
    const add = (name) =>
      page.evaluate(async (nm) => {
        const p = __wtw.engine.emptyProfile();
        return __wtw.sync.debugAddMember(nm, { ...p, onboarded: true });
      }, name);
    const sam = await add('Sam');
    await T('tab-tonight').click();
    await T('who-picker').waitFor();
    await step('who-2');
    await T('who-' + sam).click();
    await step('who-2-selected');
    await T('ask-submit').click();
    await T('session-deck').waitFor();
    await step('session-waiting');
    await T('action-yes').click();
    await page.waitForTimeout(500);
    await page.evaluate((id) => __wtw.sync.debugActAs(id), sam);
    await T('join-prompt').waitFor();
    await step('join-prompt');
    await T('join-button').click();
    await T('session-deck').waitFor();
    await T('action-yes').click();
    await T('match-screen').waitFor({ timeout: 8000 });
    await step('match-2');
    await T('match-keep').click();
    const kit = await add('Kit');
    await T('tab-tonight').click();
    await page.waitForTimeout(300);
    await step('who-3');
    await T('tab-matches').click();
    await step('matches-group');
    await T('tab-watchlist').click();
    await step('watchlist-group');
    await T('tab-history').click();
    await step('history-group');
    await T('tab-us').click();
    await step('us-group');
    await T('us-seg-settings').click();
    await step('settings-group');
    await T('remove-member-' + kit).scrollIntoViewIfNeeded();
    await T('remove-member-' + kit).click();
    await step('remove-sheet');
    await T('remove-confirm').click();
    await page.waitForTimeout(500);
    await T('rename-input').scrollIntoViewIfNeeded();
    await T('rename-input').fill('Sammy');
    await T('rename-save').click();
    await step('renamed');
  }
  if (part === 'join' || part === 'join-existing') {
    await createHousehold('Alex', ['netflix'], ['office']);
    await page.evaluate(async () => {
      const p = __wtw.engine.emptyProfile();
      await __wtw.sync.debugAddMember('Sam', { ...p, onboarded: true });
    });
    const code = await page.evaluate(() => __wtw.sync.createInvite());
    await page.evaluate(() => __wtw.sync.unpair());
    await page.evaluate(() => sessionStorage.removeItem('pt.install.skipped'));
    await page.goto(BASE + '&join=' + code);
    await T('welcome').waitFor();
    await step('invited-install');
    await T('continue-in-browser').click();
    await T('invite-preview').waitFor();
    await T('invite-title').waitFor();
    await step('invite-preview');
    if (part === 'join') {
      await T('join-new').click();
      await T('name-input').fill('sam');
      await step('join-name-taken');
      await T('wizard-next').isDisabled().then((d) => d || errors.push('name taken should disable'));
      await T('name-input').fill('Jo');
      await T('wizard-next').click();
      await T('wizard-favorites').waitFor();
      await step('joiner-favourites');
    } else {
      await T('join-existing').click();
      await step('existing-pick');
      await page.locator('[data-testid^="existing-"][data-member-id]').first().click();
      await step('existing-warning');
      await T('existing-confirm').click();
      await T('tabbar').waitFor();
      await step('existing-in');
    }
  }
  if (part === 'four') {
    await createHousehold('Maximilian Alexande', ['netflix', 'hulu'], ['office']);
    const ids = [];
    for (const nm of ['Wilhelmina Fitzgera', 'Sam', 'Kit']) {
      ids.push(await page.evaluate(async (n) => __wtw.sync.debugAddMember(n, { ...__wtw.engine.emptyProfile(), onboarded: true }), nm));
    }
    await T('tab-tonight').click();
    await T('who-everyone').click();
    await step('who-4-everyone');
    await T('ask-submit').click();
    await T('session-deck').waitFor();
    await step('session-4-waiting');
    await T('action-yes').click();
    await page.waitForTimeout(700);
    for (const id of ids) {
      await page.evaluate((x) => __wtw.sync.debugActAs(x), id);
      await T('join-button').click();
      await T('session-deck').waitFor();
      await T('action-yes').click();
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(800);
    console.log(JSON.stringify(await page.evaluate(() => { const a = __wtw.sync.getState().activeSession; return a && { yes: a.yes, joined: a.joined, matches: a.matches.length, first: a.deck[0].itemId }; })));
    await T('match-screen').waitFor({ timeout: 8000 });
    await page.waitForTimeout(900);
    await step('match-4');
    await T('match-keep').click();
    for (const t of ['matches', 'watchlist', 'history', 'new', 'us']) {
      await T('tab-' + t).click();
      await step('four-' + t);
    }
  }
} catch (e) {
  errors.push('FAILED: ' + e.message.split('\n')[0]);
  await shot('failure');
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
