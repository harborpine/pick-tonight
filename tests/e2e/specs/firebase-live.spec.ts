import { expect, test } from '../helpers/fixtures';
import { fsStatus, householdId, idToken, makeInvite, newPhone, openInvite, openSettings, openTab, strangerToken, tid, wtw } from '../helpers/app';

test.describe.configure({ retries: 1, timeout: 240_000 });

test('live sync: watched, watchlist, never, plan changes and renames reach the other phone without a reload', async ({ group }) => {
  const g = await group(['Alex', 'Sam']);
  const [A, B] = g.pages;
  const alex = g.ids.Alex;

  // B is looking at Alex's History, Alex's Never list and the Ours watchlist while A does things
  await openTab(B, 'history');
  await tid(B, `history-person-${alex}`).click();
  await expect(tid(B, 'history-empty')).toBeVisible();
  await wtw(A, async (w, a) => w.sync.markWatched(a, [{ itemId: 'tv-8592', source: 'manual', snapshot: { title: 'Parks and Recreation', year: 2009, poster: null } }]), alex);
  await expect(B.locator('[data-testid="history-row"][data-item-id="tv-8592"]')).toHaveCount(1, { timeout: 45_000 });

  await openTab(B, 'watchlist');
  await tid(B, 'watchlist-tab-ours').click();
  await wtw(A, async (w, a) => w.sync.addToWatchlist('ours', 'tv-48891', a, { title: 'Brooklyn Nine-Nine', year: 2013, poster: null }), alex);
  await expect(B.locator('[data-testid="watchlist-row"][data-item-id="tv-48891"]')).toHaveCount(1, { timeout: 45_000 });
  await wtw(A, async (w) => w.sync.removeFromWatchlist('ours', 'tv-48891'));
  await expect(B.locator('[data-testid="watchlist-row"][data-item-id="tv-48891"]')).toHaveCount(0, { timeout: 45_000 });

  await openTab(B, 'us');
  await tid(B, `us-seg-${alex}`).click();
  await wtw(A, async (w, a) => w.sync.setNever(a, 'tv-1434', true), alex);
  await expect(B.locator('[data-testid="never-row"][data-item-id="tv-1434"]')).toHaveCount(1, { timeout: 45_000 });

  // plans: A changes them in Settings, B (looking at Settings) sees the summary change
  await openSettings(B);
  await expect(tid(B, 'services-summary').locator('[data-service-id="netflix"]')).toHaveCount(1);
  await openSettings(A);
  await tid(A, 'services-edit').click();
  await tid(A, 'service-toggle-netflix').click(); // Netflix off
  await tid(A, 'service-toggle-prime').scrollIntoViewIfNeeded();
  await tid(A, 'service-toggle-prime').click();
  await tid(A, 'plan-prime-ads').click();
  await tid(A, 'services-done').click();
  await expect(tid(B, 'services-summary').locator('[data-service-id="netflix"]')).toHaveCount(0, { timeout: 45_000 });
  await expect(tid(B, 'services-summary').locator('[data-service-id="prime"]')).toHaveCount(1, { timeout: 45_000 });
  // and B's catalog followed
  await expect.poll(async () => wtw(B, (w) => w.catalogs.get().services), { timeout: 45_000 }).toContain('prime');

  // rename: A renames, B's chips and Us tab show the new name
  await tid(A, 'rename-input').scrollIntoViewIfNeeded();
  await tid(A, 'rename-input').fill('Alexandra');
  await tid(A, 'rename-save').click();
  await openTab(B, 'tonight');
  await expect(B.locator(`[data-testid="who-${alex}"]`)).toContainText('Alexandra', { timeout: 45_000 });
  // a name change is also what a newcomer sees on the invite screen
  const { link } = await makeInvite(A);
  const N = await newPhone(A.context().browser()!, test.info());
  g.phones.push(N);
  await openInvite(N.page, link);
  await expect(tid(N.page, 'invite-title')).toHaveText('Join Alexandra and Sam');
});

test('removing a member signs their phone out with a plain message; everyone else updates', async ({ group }) => {
  const g = await group(['Alex', 'Sam', 'Kit']);
  const [A, B, C] = g.pages;
  await openSettings(A);
  await tid(A, `remove-member-${g.ids.Kit}`).scrollIntoViewIfNeeded();
  await tid(A, `remove-member-${g.ids.Kit}`).click();
  await tid(A, 'remove-confirm').click();
  await expect(tid(A, 'member-row')).toHaveCount(2);
  await expect(tid(C, 'device-error')).toBeVisible({ timeout: 60_000 });
  await expect(tid(C, 'device-error')).toContainText(/no longer part of the household/i);
  await expect(tid(C, 'tabbar')).toHaveCount(0);
  await openTab(B, 'tonight');
  await expect(B.locator(`[data-testid="who-${g.ids.Kit}"]`)).toHaveCount(0, { timeout: 45_000 });
});

test('Delete everything really deletes: the other phones go back to the first screen with a plain message and nothing can be read any more', async ({ group, browser }, testInfo) => {
  const g = await group(['Alex', 'Sam', 'Kit']);
  const [A, B, C] = g.pages;
  const hid = await householdId(A);
  const { code, link } = await makeInvite(A); // an outstanding invite must die with the household
  // some data worth deleting
  await wtw(A, async (w, a) => w.sync.markWatched(a, [{ itemId: 'tv-8592', source: 'manual', snapshot: { title: 'Parks and Recreation', year: 2009, poster: null } }]), g.ids.Alex);
  const tokenB = await idToken(B); // a phone that was a member keeps its sign-in after the household is gone
  const tokenA = await idToken(A);
  expect(await fsStatus(tokenA, `households/${hid}`)).toBe(200); // control: a member can read it

  await openSettings(A);
  await tid(A, 'delete-everything').scrollIntoViewIfNeeded();
  await tid(A, 'delete-everything').click();
  await tid(A, 'delete-continue').click();
  await tid(A, 'delete-input').fill('DELETE');
  await tid(A, 'delete-confirm').click();
  await expect(tid(A, 'setup')).toBeVisible({ timeout: 90_000 });

  for (const P of [B, C]) {
    await expect(tid(P, 'tabbar')).toHaveCount(0, { timeout: 90_000 });
    await expect(tid(P, 'device-error')).toBeVisible({ timeout: 90_000 });
    await expect(tid(P, 'device-error')).toContainText('This household was deleted.');
    await expect(tid(P, 'device-error-next')).toBeVisible();
    // (a phone opened from an invite link goes back to that dead link's screen, which also offers a fresh start)
    await expect(tid(P, 'start-household').or(tid(P, 'invite-start-own'))).toBeVisible();
    // the still-open phone holds nothing of the household any more
    expect(await wtw(P, (w) => w.sync.getState())).toBeNull();
    expect(await wtw(P, (w) => w.sync.getDevice().status)).toBe('unpaired');
  }

  // Nothing can be read with a former member's own credentials, a stranger's, or the old invite code
  const stranger = await strangerToken();
  const gone = [
    `households/${hid}`,
    `households/${hid}/data/shared`,
    `households/${hid}/data/${g.ids.Alex}`,
    `households/${hid}/seenx/${g.ids.Alex}_0`,
    `households/${hid}/seenx/${g.ids.Alex}_1`,
    `households/${hid}/seenx/${g.ids.Alex}_2`,
    `households/${hid}/sessions/current`,
    `invites/${code}`,
  ];
  for (const path of gone) {
    for (const [who, t] of [['a former member', tokenB], ['the former creator', tokenA], ['a stranger', stranger]] as const) {
      expect([403, 404], `${who} reading ${path}`).toContain(await fsStatus(t, path));
    }
  }
  // the old invite link on a fresh phone: a plain refusal, no household details
  const D = await newPhone(browser, testInfo);
  g.phones.push(D);
  await openInvite(D.page, link).catch(() => undefined);
  await expect(tid(D.page, 'invite-stale-note').or(tid(D.page, 'invite-error'))).toBeVisible({ timeout: 45_000 });
  await expect(tid(D.page, 'invite-members')).toHaveCount(0);
  await expect(D.page.getByText(/Alex|Sam|Kit/)).toHaveCount(0);
  // and a new household can be started on the same phones straight away
  await (await tid(B, 'start-household').count() ? tid(B, 'start-household') : tid(B, 'invite-start-own')).click();
  await expect(tid(B, 'setup-name')).toBeVisible();
});
