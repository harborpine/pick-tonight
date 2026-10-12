import { expect, test } from '@playwright/test';
import {
  MEM_URL,
  addFavourite,
  ask,
  createHousehold,
  fillAsk,
  openApp,
  openTab,
  pageThroughDeck,
  pickServices,
  sharedState,
  tid,
  wtw,
} from '../helpers/app';

test('browser tab: install guidance first; "Continue in the browser anyway" moves on to create-or-join', async ({ page }) => {
  await page.goto(MEM_URL);
  await expect(tid(page, 'welcome')).toBeVisible();
  await expect(tid(page, 'install-title')).toContainText('Home Screen');
  await expect(tid(page, 'install-steps')).toContainText('Share');
  await expect(tid(page, 'install-steps')).toContainText('Add to Home Screen');
  await expect(tid(page, 'install-why')).toBeVisible();
  await expect(tid(page, 'install-invite')).toHaveCount(0); // only when opened from an invite link
  await tid(page, 'continue-in-browser').click();
  await expect(tid(page, 'setup')).toBeVisible();
  await expect(tid(page, 'start-household')).toBeVisible();
  await expect(tid(page, 'have-code')).toBeVisible();
  // the choice is remembered for this tab: a reload goes straight to create-or-join
  await page.reload();
  await expect(tid(page, 'setup')).toBeVisible();
});

test('installed (home-screen) mode: the install guidance is skipped', async ({ page }) => {
  // Emulate iOS "standalone": Safari sets navigator.standalone on a home-screen app.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
  });
  await page.goto(MEM_URL);
  await expect(tid(page, 'setup')).toBeVisible();
  await expect(tid(page, 'welcome')).toHaveCount(0);
  expect(await wtw(page, (w) => w.standalone)).toBe(true);
});

test('create a household from nothing: every step, and nothing is pre-filled', async ({ page }) => {
  await openApp(page);
  await tid(page, 'start-household').click();

  // --- name ---
  await expect(tid(page, 'setup-name')).toBeVisible();
  await expect(tid(page, 'name-input')).toHaveValue('');
  await expect(tid(page, 'wizard-next')).toBeDisabled();
  await tid(page, 'name-input').fill('   ');
  await expect(tid(page, 'wizard-next')).toBeDisabled();
  await tid(page, 'name-input').fill('Morgan');
  await expect(tid(page, 'wizard-next')).toBeEnabled();
  await tid(page, 'wizard-next').click();

  // --- services & plans: nothing chosen, cannot continue with none ---
  await expect(tid(page, 'setup-services')).toBeVisible();
  await expect(tid(page, 'wizard-next')).toBeDisabled();
  expect(await page.locator('[data-testid^="service-toggle-"]').count()).toBeGreaterThan(20);
  await expect(page.locator('[data-testid^="service-"][data-on="true"]')).toHaveCount(0);
  // search narrows the long list
  await tid(page, 'service-search').fill('zzzz');
  await expect(tid(page, 'service-none')).toBeVisible();
  await tid(page, 'service-search').fill('hulu');
  await expect(page.locator('[data-testid^="service-toggle-"]')).toHaveCount(1);
  await tid(page, 'service-search').fill('');
  // a service with two plans waits for a plan; the plan chips carry Ads / Ad-free badges
  await tid(page, 'service-toggle-hulu').click();
  await expect(tid(page, 'wizard-next')).toBeDisabled();
  await expect(tid(page, 'plan-hulu-ads')).toHaveAttribute('data-adfree', 'false');
  await expect(tid(page, 'plan-hulu-noads')).toHaveAttribute('data-adfree', 'true');
  await expect(tid(page, 'plan-hulu-ads')).toContainText(/ads/i);
  await expect(tid(page, 'plan-hulu-noads')).toContainText(/no ads|ad-free/i);
  await tid(page, 'plan-hulu-ads').click();
  await expect(tid(page, 'service-hulu')).toHaveAttribute('data-on', 'true');
  await expect(tid(page, 'wizard-next')).toBeEnabled();
  await pickServices(page, [['netflix', 'standard'], 'apple']);
  await tid(page, 'service-toggle-hulu').click(); // switch Hulu off again
  await expect(tid(page, 'service-hulu')).toHaveAttribute('data-on', 'false');
  await tid(page, 'wizard-next').click();

  // --- favourites: nothing there; found by search; one is not on the chosen services ---
  await expect(tid(page, 'wizard-favorites')).toBeVisible({ timeout: 30_000 });
  await expect(tid(page, 'fav-chip')).toHaveCount(0);
  await expect(tid(page, 'fav-count')).toContainText('None yet');
  const onCatalog = await addFavourite(page, 'office');
  expect(onCatalog).toMatch(/^tv-/);
  const offServices = await addFavourite(page, 'breaking bad');
  expect(offServices).toBe('tv-1396'); // not on Netflix/Apple in the sample catalog
  await expect(tid(page, 'fav-chip')).toHaveCount(2);
  await expect(tid(page, 'fav-count')).toContainText('2');
  // already added: the result is disabled
  await tid(page, 'fav-search').fill('breaking bad');
  await expect(page.locator('[data-testid="fav-result"][data-item-id="tv-1396"]')).toHaveAttribute('data-added', 'true');
  await tid(page, 'fav-search').fill('xqzjv nothing like this');
  await expect(tid(page, 'fav-none')).toBeVisible();
  await tid(page, 'wizard-next').click();

  // --- never show me: nothing on; a whole genre and "not in English" ---
  await expect(tid(page, 'wizard-never')).toBeVisible();
  for (const t of ['horror', 'trueCrime', 'scary', 'subtitled']) await expect(tid(page, `dealbreaker-${t}`)).toHaveAttribute('data-on', 'false');
  await tid(page, 'dealbreaker-horror').click();
  await tid(page, 'dealbreaker-genre-reality').click();
  await tid(page, 'dealbreaker-subtitled').click();
  await expect(tid(page, 'dealbreaker-horror')).toHaveAttribute('data-on', 'true');
  await expect(tid(page, 'dealbreaker-genre-reality')).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'dealbreaker-subtitled')).toHaveAttribute('data-on', 'true');
  await tid(page, 'wizard-next').click();

  // --- import is optional ---
  await expect(tid(page, 'wizard-import')).toBeVisible();
  await expect(tid(page, 'import-section')).toBeVisible();
  await tid(page, 'wizard-skip').click();

  // --- seen grid: nothing ticked beforehand ---
  await expect(tid(page, 'wizard-seen')).toBeVisible();
  const tiles = page.locator('[data-testid^="onboard-item-"]');
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid^="onboard-item-"][data-selected="true"]')).toHaveCount(0);
  const ticked: string[] = [];
  for (let i = 0; i < 3; i++) {
    ticked.push((await tiles.nth(i).getAttribute('data-item-id'))!);
    await tiles.nth(i).click();
  }
  await expect(page.locator('[data-testid^="onboard-item-"][data-selected="true"]')).toHaveCount(3);
  await expect(tid(page, 'wizard-next')).toContainText('3');
  await tid(page, 'wizard-next').click();

  // --- done: a household of one is warned about losing the phone ---
  await expect(tid(page, 'wizard-done')).toBeVisible();
  await expect(tid(page, 'solo-warning')).toContainText('no sign-in');
  await expect(tid(page, 'solo-warning')).toContainText('only person');
  await tid(page, 'wizard-finish').click();
  await expect(tid(page, 'ask')).toBeVisible();

  // --- what was saved is exactly what was entered ---
  const st = await sharedState(page);
  const ids = Object.keys(st.members);
  expect(ids).toHaveLength(1);
  expect(st.members[ids[0]].name).toBe('Morgan');
  expect(st.settings.plans).toMatchObject({ netflix: 'standard', apple: 'standard' });
  expect(st.settings.plans.hulu ?? null).toBeNull();
  const profile = st.profiles[ids[0]];
  expect(profile.onboarded).toBe(true);
  expect(profile.favorites.map((f: { id: string }) => f.id).sort()).toEqual([onCatalog, offServices].sort());
  expect(profile.dealbreakers).toMatchObject({ horror: true, trueCrime: false, scary: false, subtitled: true });
  expect(profile.dealbreakers.genres).toEqual(['reality']);
  expect(Object.keys(st.seen[ids[0]]).sort()).toEqual([...ticked].sort());
  for (const id of ticked) expect(st.seen[ids[0]][id].source).toBe('onboarding');
  expect(st.picks).toHaveLength(0);
  expect(st.watchlist).toHaveLength(0);
});

test('a brand-new household has no favourites, no history, no plans beyond what was chosen', async ({ page }) => {
  await createHousehold(page, { name: 'Robin', services: [['netflix', 'standard']] });
  const st = await sharedState(page);
  const id = Object.keys(st.members)[0];
  expect(st.profiles[id].favorites).toEqual([]);
  expect(st.profiles[id].dealbreakers).toMatchObject({ horror: false, trueCrime: false, scary: false, subtitled: false, genres: [] });
  expect(st.seen[id]).toEqual({});
  expect(st.never[id]).toEqual({});
  expect(Object.entries(st.settings.plans).filter(([, v]) => v)).toEqual([['netflix', 'standard']]);
});

test('names: empty, too long and whitespace-only are not accepted', async ({ page }) => {
  await openApp(page);
  await tid(page, 'start-household').click();
  await tid(page, 'name-input').fill('A'.repeat(21));
  await expect(tid(page, 'wizard-next')).toBeDisabled();
  await expect(tid(page, 'name-hint')).toContainText('20');
  await tid(page, 'name-input').fill('A'.repeat(20));
  await expect(tid(page, 'wizard-next')).toBeEnabled();
});

test('quitting mid-setup and reloading resumes at the right step', async ({ page }) => {
  await createHousehold(page, { name: 'Jo', stopAtFavourites: true });
  await addFavourite(page, 'office');
  await page.reload();
  await expect(tid(page, 'wizard-favorites')).toBeVisible({ timeout: 30_000 });
  await expect(tid(page, 'fav-chip')).toHaveCount(1); // what was saved is still there
  await tid(page, 'wizard-next').click();
  await expect(tid(page, 'wizard-never')).toBeVisible();
  await tid(page, 'dealbreaker-scary').click();
  await page.reload();
  await expect(tid(page, 'wizard-never')).toBeVisible({ timeout: 30_000 });
  await expect(tid(page, 'dealbreaker-scary')).toHaveAttribute('data-on', 'true');
  await tid(page, 'wizard-skip').click();
  await page.reload();
  await expect(tid(page, 'wizard-import')).toBeVisible({ timeout: 30_000 });
  await tid(page, 'wizard-skip').click();
  await page.reload();
  await expect(tid(page, 'wizard-seen')).toBeVisible({ timeout: 30_000 });
  await tid(page, 'wizard-next').click();
  await page.reload();
  await expect(tid(page, 'wizard-done')).toBeVisible({ timeout: 30_000 });
  await tid(page, 'wizard-finish').click();
  await expect(tid(page, 'ask')).toBeVisible();
  // finished: a reload goes straight to the app
  await page.reload();
  await expect(tid(page, 'ask')).toBeVisible({ timeout: 30_000 });
  await expect(tid(page, 'wizard-done')).toHaveCount(0);
});

test('setup can go back from services to the name without losing anything', async ({ page }) => {
  await openApp(page);
  await tid(page, 'start-household').click();
  await tid(page, 'name-input').fill('Pat');
  await tid(page, 'wizard-next').click();
  await pickServices(page, [['netflix', 'standard']]);
  await tid(page, 'wizard-back').click();
  await expect(tid(page, 'name-input')).toHaveValue('Pat');
  await tid(page, 'wizard-next').click();
  await expect(tid(page, 'service-netflix')).toHaveAttribute('data-on', 'true');
});

test('skipping every step still lands in a working app (cold start): a deck, moods and viewing types respected, empty tabs make sense', async ({ page }) => {
  await createHousehold(page, { name: 'Casey', services: [['netflix', 'standard'], ['hulu', 'ads'], ['disney', 'premium'], ['hbo', 'ads'], ['peacock', 'premium'], ['paramount', 'essential']] });
  // all tabs: sensible empty states
  await openTab(page, 'watchlist');
  await expect(tid(page, 'watchlist-empty')).toBeVisible();
  await openTab(page, 'matches');
  await expect(tid(page, 'matches-empty')).toBeVisible();
  await openTab(page, 'history');
  await expect(tid(page, 'history-empty')).toBeVisible();
  await openTab(page, 'new');
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(tid(page, 'new-row').first()).toBeVisible(); // recent arrivals on the services
  await openTab(page, 'us');
  // honest about knowing nothing: no line may claim to come from favourites (there are none) or from swipes (none yet)
  const sources = await page.locator('[data-testid="insight-line"] small').allTextContents();
  for (const s of sources) expect.soft(s, 'a taste line claims a source that does not exist yet').not.toMatch(/From favourites|Learned from swipes/);
  await openTab(page, 'tonight');
  // a deck appears with nothing known about the person
  await ask(page, { mood: 'laugh', time: 120, viewing: 'focused' });
  const first = await pageThroughDeck(page);
  expect(first.length).toBeGreaterThan(8);
  await tid(page, 'empty-back').click();
  // it respects viewing type: background means low attention only
  const rows = await wtw(page, (w) => Object.fromEntries(w.catalogs.get().catalog.items.map((i: { id: string; attention: string }) => [i.id, i.attention])));
  await ask(page, { viewing: 'background', mood: 'gripped', time: 120 });
  const bg = await pageThroughDeck(page);
  for (const c of bg) expect(rows[c.id], c.title).toBe('low');
  await tid(page, 'empty-back').click();
  // and mood: cozy and gripped decks differ
  await ask(page, { viewing: 'focused', mood: 'cozy', time: 120 });
  const cozy = await pageThroughDeck(page);
  await tid(page, 'empty-back').click();
  await ask(page, { mood: 'hyped', time: 120 });
  const hyped = await pageThroughDeck(page);
  expect(cozy.length).toBeGreaterThan(0);
  expect(hyped.length).toBeGreaterThan(0);
  expect(cozy.map((c) => c.id).slice(0, 5)).not.toEqual(hyped.map((c) => c.id).slice(0, 5));
});

test('the Ask screen for a household of one: no who-picker, the right controls', async ({ page }) => {
  await createHousehold(page, { name: 'Solo Sam' });
  await expect(tid(page, 'ask')).toBeVisible();
  await expect(tid(page, 'ask-group-who')).toHaveCount(0);
  await expect(tid(page, 'who-picker')).toHaveCount(0);
  for (const g of ['viewing', 'mood', 'time', 'novelty', 'genre']) await expect(tid(page, `ask-group-${g}`)).toBeVisible();
  await expect(tid(page, 'ask-submit')).toHaveText(/Show me/);
  for (const v of ['focused', 'background', 'eating']) await expect(tid(page, `ask-viewing-${v}`)).toBeVisible();
  for (const t of ['20', '45', '60', '120', 'any']) await expect(tid(page, `ask-time-${t}`)).toBeVisible();
  for (const n of ['new', 'rewatch', 'either']) await expect(tid(page, `ask-novelty-${n}`)).toBeVisible();
  await expect(tid(page, 'ask-novelty-either-hint')).toContainText('mostly new');
  // defaults: focused, either
  await expect(tid(page, 'ask-viewing-focused')).toHaveAttribute('data-selected', 'true');
  await expect(tid(page, 'ask-novelty-either')).toHaveAttribute('data-selected', 'true');
  await fillAsk(page, { mood: 'cry' });
  await expect(tid(page, 'ask-mood-cry')).toHaveAttribute('data-selected', 'true');
});
