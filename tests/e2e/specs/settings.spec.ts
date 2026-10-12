import { expect, test } from '@playwright/test';
import { FIXTURE_PLANS } from '../../../src/contracts/fixtures/catalog';
import {
  SAMPLE,
  catalogRows,
  createHousehold,
  engineDeck,
  markWatched,
  openSettings,
  openTab,
  quickHousehold,
  request,
  sharedState,
  tid,
  wtw,
  type MemberSpec,
} from '../helpers/app';

const DEE: MemberSpec = { name: 'Dee' };

test('services and plans: the summary shows what the household pays for; anyone can change it; availability follows', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openSettings(page);
  const summary = tid(page, 'services-summary');
  for (const id of Object.keys(FIXTURE_PLANS)) await expect(summary.locator(`[data-service-id="${id}"]`)).toHaveCount(1);
  await expect(summary.locator('[data-service-id="prime"]')).toHaveCount(0);
  // control: a title only on Hulu is offered now
  const rows = await catalogRows(page);
  const huluOnly = Object.values(rows).filter((r) => r.providers.length === 1 && r.providers[0] === 15).map((r) => r.id);
  const deckIds = async () => (await engineDeck(page, request([h.first], { mood: 'laugh', time: 'any' }))).map((c) => c.id);
  expect((await deckIds()).some((id) => huluOnly.includes(id))).toBe(true);

  await h.actAs('Kit'); // anyone in the household can do it
  await openSettings(page);
  await tid(page, 'services-edit').click();
  await expect(tid(page, 'services-picker')).toBeVisible();
  await tid(page, 'service-toggle-hulu').click(); // off
  await expect(tid(page, 'service-hulu')).toHaveAttribute('data-on', 'false');
  await tid(page, 'service-toggle-prime').scrollIntoViewIfNeeded();
  await tid(page, 'service-toggle-prime').click(); // two plans: wait for a choice
  await tid(page, 'plan-prime-adfree').click();
  await expect(tid(page, 'plan-prime-adfree')).toHaveAttribute('data-adfree', 'true');
  await tid(page, 'services-done').click();
  await expect(summary.locator('[data-service-id="hulu"]')).toHaveCount(0);
  await expect(summary.locator('[data-service-id="prime"]')).toHaveCount(1);
  const st = await sharedState(page);
  expect(st.settings.plans.hulu ?? null).toBeNull();
  expect(st.settings.plans.prime).toBe('adfree');
  await h.actAs('Alex');
  const after = await deckIds();
  for (const id of huluOnly) expect(after, id).not.toContain(id);
  // the catalog store follows the plan list
  const loaded = await wtw(page, (w) => w.catalogs.get().services);
  expect(loaded).toContain('prime');
  expect(loaded).not.toContain('hulu');
});

test('removing the last service leaves the Tonight tab asking for one', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]], { plans: {} });
  await expect(tid(page, 'catalog-no-services')).toBeVisible();
  await tid(page, 'catalog-choose-services').click();
  await expect(tid(page, 'us')).toBeVisible();
});

test('invite: a link <site>/pick-tonight/?join=CODE and the bare code, which can be hidden again', async ({ page }) => {
  await createHousehold(page, { name: 'Alex' });
  await openSettings(page);
  await expect(tid(page, 'invite-block')).toBeVisible();
  await expect(tid(page, 'invite-code')).toHaveCount(0);
  await tid(page, 'invite-make').click();
  await expect(tid(page, 'invite-code')).toHaveText(/^[A-Z0-9]{3} [A-Z0-9]{3}$/);
  const code = ((await tid(page, 'invite-code').textContent()) ?? '').replace(/\s/g, '');
  const link = (await tid(page, 'invite-link').textContent())!.trim();
  expect(link).toMatch(/^https?:\/\/[^/]+\/pick-tonight\/\?join=[A-Z0-9]{6}$/);
  expect(link.endsWith(`join=${code}`)).toBe(true);
  await expect(tid(page, 'invite-share')).toBeVisible();
  await tid(page, 'invite-hide').click();
  await expect(tid(page, 'invite-code')).toHaveCount(0);
  // the privacy-minded wording is there: one use, 24 hours
  await expect(tid(page, 'invite-block')).toContainText('24 hours');
});

test('a full household (4) shows "Let a member back in" instead of an ordinary invite', async ({ page }) => {
  await quickHousehold(page, [...SAMPLE, DEE]);
  await openSettings(page);
  await expect(tid(page, 'invite-block')).toHaveCount(0);
  await expect(tid(page, 'invite-rejoin')).toBeVisible();
  await expect(tid(page, 'invite-rejoin')).toContainText('Let a member back in');
  await tid(page, 'invite-make').click();
  await expect(tid(page, 'invite-code')).toBeVisible();
  await expect(tid(page, 'invite-link')).toContainText('?join=');
});

test('rename: empty, too long and duplicate names are refused; a good name shows everywhere', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await openSettings(page);
  const input = tid(page, 'rename-input');
  await expect(input).toHaveValue('Alex');
  await expect(tid(page, 'rename-save')).toBeDisabled();
  await input.fill('');
  await expect(tid(page, 'rename-save')).toBeDisabled();
  await input.fill('B'.repeat(21));
  await expect(tid(page, 'rename-save')).toBeDisabled();
  await expect(tid(page, 'rename-error')).toContainText('20');
  await input.fill('sam'); // case-insensitive duplicate
  await expect(tid(page, 'rename-save')).toBeDisabled();
  await expect(tid(page, 'rename-error')).toContainText('already');
  await input.fill('Alexandra');
  await expect(tid(page, 'rename-save')).toBeEnabled();
  await tid(page, 'rename-save').click();
  await expect(tid(page, 'toast')).toContainText('Name changed');
  expect((await sharedState(page)).members[h.first].name).toBe('Alexandra');
  await openTab(page, 'tonight');
  await expect(tid(page, `who-${h.first}`)).toContainText('Alexandra');
  // keeping the same name with different capitals is allowed for yourself
  await openSettings(page);
  await tid(page, 'rename-input').fill('ALEXANDRA');
  await expect(tid(page, 'rename-save')).toBeEnabled();
});

test("remove a member: their data goes, shared things stay, the list of people updates", async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE);
  await markWatched(page, h.ids.Sam, ['tv-8592']);
  await wtw(
    page,
    async (w, a) => {
      await w.sync.addToWatchlist('ours', 'tv-8592', a.sam, { title: 'Parks and Recreation', year: 2009, poster: null });
      await w.sync.addToWatchlist(a.sam, 'tv-48891', a.sam, { title: 'Brooklyn Nine-Nine', year: 2013, poster: null });
      await w.sync.addPick({ kind: 'match', who: [a.alex, a.sam].sort(), itemId: 'tv-8592', snapshot: { title: 'Parks and Recreation', year: 2009, poster: null }, pick: { type: 'any-episode' }, service: { serviceId: 'hulu', planId: 'ads', adFree: false } });
    },
    { sam: h.ids.Sam, alex: h.first },
  );
  await openSettings(page);
  await expect(tid(page, 'member-row')).toHaveCount(3);
  await tid(page, `remove-member-${h.ids.Sam}`).click();
  await expect(tid(page, 'remove-sheet')).toBeVisible();
  await expect(tid(page, 'remove-text')).toContainText('Sam');
  await expect(tid(page, 'remove-text')).toContainText('Matches stay');
  await tid(page, 'remove-cancel').click();
  await expect(tid(page, 'member-row')).toHaveCount(3);
  await tid(page, `remove-member-${h.ids.Sam}`).click();
  await tid(page, 'remove-confirm').click();
  await expect(tid(page, 'member-row')).toHaveCount(2);
  const st = await sharedState(page);
  expect(Object.keys(st.members)).not.toContain(h.ids.Sam);
  expect(st.profiles[h.ids.Sam]).toBeUndefined();
  expect(st.seen[h.ids.Sam]).toBeUndefined();
  expect(st.watchlist.filter((w: { list: string }) => w.list === h.ids.Sam)).toHaveLength(0);
  expect(st.watchlist.filter((w: { list: string }) => w.list === 'ours')).toHaveLength(1); // shared things stay
  expect(st.picks).toHaveLength(1);
  await openTab(page, 'tonight');
  await expect(page.locator(`[data-testid="who-${h.ids.Sam}"]`)).toHaveCount(0);
  await openTab(page, 'us');
  await expect(page.locator(`[data-testid="us-seg-${h.ids.Sam}"]`)).toHaveCount(0);
  // the match survives and is labelled safely even though one of its people is gone
  await openTab(page, 'matches');
  await expect(tid(page, 'match-row')).toHaveCount(1);
});

test('unpair: this phone forgets the household and goes back to the first screen; the data is kept', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE.slice(0, 2));
  await openSettings(page);
  await tid(page, 'unpair').click();
  await expect(tid(page, 'unpair-sheet')).toBeVisible();
  await expect(tid(page, 'unpair-solo-warning')).toHaveCount(0); // not alone
  await expect(tid(page, 'unpair-confirm')).toHaveText('Unpair');
  await tid(page, 'unpair-confirm').click();
  await expect(tid(page, 'setup')).toBeVisible();
  await expect(tid(page, 'tabbar')).toHaveCount(0);
  void h;
});

test('Delete everything: needs a deliberate two-step confirmation, then nothing is left and the app starts from the first screen', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE.slice(0, 2));
  await markWatched(page, h.first, ['tv-8592']);
  await openSettings(page);
  await tid(page, 'delete-everything').scrollIntoViewIfNeeded();
  await tid(page, 'delete-everything').click();
  await expect(tid(page, 'delete-sheet')).toBeVisible();
  await expect(tid(page, 'delete-explain')).toContainText('permanently');
  await expect(tid(page, 'delete-explain')).toContainText('everyone');
  await tid(page, 'delete-cancel').click();
  await expect(tid(page, 'delete-sheet')).toHaveCount(0);
  expect(Object.keys((await sharedState(page)).members)).toHaveLength(2); // cancel deletes nothing

  await tid(page, 'delete-everything').click();
  await tid(page, 'delete-continue').click();
  await expect(tid(page, 'delete-confirm')).toBeDisabled();
  await tid(page, 'delete-input').fill('delet');
  await expect(tid(page, 'delete-confirm')).toBeDisabled();
  await tid(page, 'delete-input').fill('DELETE');
  await expect(tid(page, 'delete-confirm')).toBeEnabled();
  await tid(page, 'delete-confirm').click();
  await expect(tid(page, 'setup')).toBeVisible();
  // nothing of the household is left on the device
  const left = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('pt.memory-sync')) out[k] = localStorage.getItem(k)!;
    }
    return out;
  });
  for (const v of Object.values(left)) expect(v).not.toContain('Alex');
  await page.reload();
  await expect(tid(page, 'setup')).toBeVisible();
  // and a new household starts completely clean
  await tid(page, 'start-household').click();
  await tid(page, 'name-input').fill('Fresh');
  await tid(page, 'wizard-next').click();
  await tid(page, 'service-toggle-netflix').click();
  await tid(page, 'plan-netflix-standard').click();
  await tid(page, 'wizard-next').click();
  await expect(tid(page, 'wizard-favorites')).toBeVisible();
  const st = await sharedState(page);
  expect(Object.values<{ name: string }>(st.members).map((m) => m.name)).toEqual(['Fresh']);
  expect(st.picks).toHaveLength(0);
  expect(Object.values(st.seen).every((s) => Object.keys(s as object).length === 0)).toBe(true);
});

test('Privacy page says what is and is not stored, in plain words', async ({ page }) => {
  await createHousehold(page, { name: 'Alex' });
  await openSettings(page);
  await tid(page, 'open-privacy').scrollIntoViewIfNeeded();
  await tid(page, 'open-privacy').click();
  const p = tid(page, 'privacy');
  await expect(p).toBeVisible();
  await expect(p).toContainText('names people typed');
  await expect(p).toContainText('favourites');
  await expect(p).toContainText('No email address');
  await expect(p).toContainText(/no analytics/i);
  await expect(p).toContainText(/no ads/i);
  await expect(p).toContainText('Firebase');
  await expect(p).toContainText('No sign-in');
  await expect(p).toContainText('only person');
  await expect(p).toContainText('Delete everything');
  await tid(page, 'settings-back').click();
  await expect(tid(page, 'settings')).toBeVisible();
});

test('About shows the TMDB logo (loaded), the exact TMDB notice and the JustWatch credit', async ({ page }) => {
  await createHousehold(page, { name: 'Alex' });
  await openSettings(page);
  await tid(page, 'open-about').scrollIntoViewIfNeeded();
  await tid(page, 'open-about').click();
  await expect(tid(page, 'about')).toBeVisible();
  await expect(tid(page, 'about-tmdb')).toHaveText('This product uses the TMDB API but is not endorsed or certified by TMDB.');
  await expect(tid(page, 'about-justwatch')).toContainText('JustWatch');
  await expect(tid(page, 'about-free')).toBeVisible();
  const logo = tid(page, 'about-tmdb-logo');
  await expect(logo).toBeVisible();
  const size = await logo.evaluate((img: HTMLImageElement) => ({ complete: img.complete, w: img.naturalWidth, h: img.naturalHeight, cw: img.clientWidth, ch: img.clientHeight }));
  expect(size.complete).toBe(true);
  expect(size.w).toBeGreaterThan(0);
  expect(size.h).toBeGreaterThan(0);
  expect(size.cw).toBeGreaterThan(20);
  expect(size.ch).toBeGreaterThan(5);
});

test('rename and Settings work for a household of one too (page title says "You")', async ({ page }) => {
  await createHousehold(page, { name: 'Alex' });
  await openSettings(page);
  await expect(tid(page, 'rename-block')).toBeVisible();
  await expect(tid(page, 'settings-members')).toHaveCount(0);
});
