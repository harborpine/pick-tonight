// Dev-only: click through the main flows at iPhone size and save screenshots.
// Usage: node src/ui/dev/walk.mjs <outDir>     (dev server must be running)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const URL = process.argv[3] ?? 'http://localhost:5173/what-to-watch/?catalog=fixture&sync=memory';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const tid = (id) => page.getByTestId(id);

await page.goto(URL);
await tid('person-HG').click();
await shot('01-setup-start');
await tid('start-household').click();
await tid('onboarding').waitFor();
await shot('02-onboarding');
await page.locator('[data-testid^="onboard-item-"]').nth(0).click();
await page.locator('[data-testid^="onboard-item-"]').nth(2).click();
await shot('03-onboarding-ticked');
await tid('onboard-done').click();

await tid('ask').waitFor();
await shot('04-ask');
await tid('ask-who-Together').click();
await shot('05-ask-together-moods');
await tid('ask-who-HG').click();
await tid('ask-mood-scared').waitFor();
await tid('ask-mood-scared').click();
await tid('ask-who-BG').click();
console.log('scared offered for BG:', await tid('ask-mood-scared').count());
console.log('mood after switch:', await page.locator('[data-testid^="ask-mood-"][data-selected="true"]').getAttribute('data-testid'));
await tid('ask-who-HG').click();
await tid('ask-mood-laugh').click();
await tid('ask-submit').click();
await tid('card').waitFor();
await page.waitForTimeout(500);
await shot('06-deck');
console.log('card:', await tid('card-title').innerText(), '|', await tid('card-pick').innerText(), '|', await tid('card-ad-badge').innerText());
await tid('card-info').click();
await shot('07-overview');
await tid('card-info').click();

// swipe with the mouse
const card = tid('card');
const box = await card.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 10, { steps: 4 });
await shot('08-dragging');
await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(450);
console.log('after spring back, same card:', await card.getAttribute('data-item-id'));
const first = await card.getAttribute('data-item-id');
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(500);
console.log('after swipe left, card changed:', first !== (await card.getAttribute('data-item-id')));

await tid('action-save').click();
await shot('09-save-sheet');
await tid('save-option-ours').click();
await page.waitForTimeout(450);
await tid('action-never').click();
await shot('10-never-confirm');
await tid('never-cancel').click();
await tid('action-seen').click();
await page.waitForTimeout(450);
await tid('action-yes').click();
await page.waitForTimeout(700);
await shot('11-liked-chip'); // solo yes stays on the deck now
await tid('deck-back').click();
await tid('ask').waitFor();

// together
await tid('ask-who-Together').click();
await tid('ask-submit').click();
await tid('session-deck').waitFor();
await shot('12-session-waiting');
console.log('status:', await tid('session-status').innerText());
// simulate BG
await page.evaluate(async () => {
  const s = window.__wtw.sync;
  const sess = s.getState().activeSession;
  await s.joinSession(sess.id, 'BG');
});
await page.waitForTimeout(200);
console.log('status after join:', await tid('session-status').innerText());
const id1 = await tid('card').getAttribute('data-item-id');
await page.evaluate(async (id) => {
  const s = window.__wtw.sync;
  const sess = s.getState().activeSession;
  await s.swipeInSession(sess.id, 'BG', id, true, { title: 't', year: 1, poster: null });
}, id1);
await tid('action-yes').click();
await tid('match-screen').waitFor();
await page.waitForTimeout(900);
await shot('13-match');
await tid('match-keep').click();
await tid('session-deck').waitFor();
// partner starts a new session while we are away -> join prompt
await page.evaluate(async () => {
  const s = window.__wtw.sync;
  const old = s.getState().activeSession;
  await s.endSession(old.id);
});
await page.waitForTimeout(300);
await shot('14-session-ended');
await page.evaluate(async () => {
  const w = window.__wtw;
  const st = w.sync.getState();
  const deck = w.engine.buildDeck({ who: 'Together', viewing: 'focused', mood: 'cozy', time: 45, novelty: 'either', genre: null }, { catalog: w.catalog, state: st, today: '2026-10-10' }, { seed: 3 });
  await w.sync.startSession('BG', { who: 'Together', viewing: 'focused', mood: 'cozy', time: 45, novelty: 'either', genre: null }, deck);
});
await tid('join-prompt').waitFor();
await page.waitForTimeout(600);
await shot('15-join-prompt');
await tid('tab-history').click();
await shot('16-history-with-banner');
await tid('join-button').click();
await tid('session-deck').waitFor();
await shot('17-joined');
await page.evaluate(async () => { const s = window.__wtw.sync; await s.endSession(s.getState().activeSession.id); });

for (const t of ['new', 'watchlist', 'history', 'us']) {
  await tid(`tab-${t}`).click();
  await page.waitForTimeout(250);
  await shot(`20-tab-${t}`);
}
await tid('tab-watchlist').click();
const row = page.getByTestId('watchlist-row').first();
if (await row.count()) { await row.click(); await shot('21-watchlist-detail'); await tid('watchlist-close').click(); }
await tid('tab-us').click();
await tid('us-seg-settings').click();
await shot('22-settings');
await page.getByTestId('about').scrollIntoViewIfNeeded();
await shot('23-settings-about');
await tid('show-pairing-code').click();
await page.getByTestId('pairing-code').scrollIntoViewIfNeeded();
await shot('24-pairing');
await tid('us-seg-BG').click();
await shot('25-profile-BG');
await tid('us-seg-HG').click();
await shot('26-profile-HG');

console.log('ERRORS:', errors);
await browser.close();
