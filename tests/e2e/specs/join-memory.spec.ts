import { expect, test, type Page } from '@playwright/test';
import { MEM_URL, SAMPLE, quickHousehold, sharedState, tid, wtw, type MemberSpec } from '../helpers/app';

const DEE: MemberSpec = { name: 'Dee' };

/** Memory mode: make an invite, step away from the household ("unpair"), and open the invite link as a newcomer. */
async function arriveWithInvite(page: Page, members: MemberSpec[]): Promise<{ code: string; ids: Record<string, string> }> {
  const h = await quickHousehold(page, members);
  const code = await wtw(page, (w) => w.sync.createInvite());
  await wtw(page, (w) => w.sync.unpair());
  await page.evaluate(() => sessionStorage.removeItem('pt.install.skipped'));
  await page.goto(`${MEM_URL}&join=${code}`);
  return { code, ids: h.ids };
}

test('invite link in a browser tab: install guidance with the code, then "Join Alex and Sam"', async ({ page }) => {
  const { code } = await arriveWithInvite(page, SAMPLE.slice(0, 2));
  await expect(tid(page, 'welcome')).toBeVisible();
  await expect(tid(page, 'install-invite')).toBeVisible();
  await expect(tid(page, 'install-invite-code')).toHaveText(`${code.slice(0, 3)} ${code.slice(3)}`);
  await tid(page, 'continue-in-browser').click();
  await expect(tid(page, 'invite-preview')).toBeVisible();
  await expect(tid(page, 'invite-title')).toHaveText('Join Alex and Sam');
  await expect(tid(page, 'invite-members').locator('li')).toHaveText(['Alex', 'Sam']);
  await expect(tid(page, 'join-new')).toBeVisible();
  await expect(tid(page, 'join-existing')).toBeVisible();
});

test('join as a new member: the name must be unique, setup has five steps, and everyone ends up in one household', async ({ page }) => {
  await arriveWithInvite(page, SAMPLE.slice(0, 2));
  await tid(page, 'continue-in-browser').click();
  await tid(page, 'join-new').click();
  await tid(page, 'name-input').fill('sam');
  await expect(tid(page, 'wizard-next')).toBeDisabled();
  await expect(tid(page, 'name-hint')).toContainText('already');
  await tid(page, 'name-input').fill('Jo');
  await expect(tid(page, 'wizard-next')).toBeEnabled();
  await expect(tid(page, 'wizard-dots')).toHaveAttribute('data-total', '5'); // no services step for a joiner
  await tid(page, 'wizard-next').click();
  await expect(tid(page, 'wizard-favorites')).toBeVisible();
  for (const step of ['wizard-favorites', 'wizard-never', 'wizard-import', 'wizard-seen']) {
    await expect(tid(page, step)).toBeVisible();
    await tid(page, 'wizard-skip').click();
  }
  await expect(tid(page, 'wizard-done')).toBeVisible();
  await expect(tid(page, 'solo-warning')).toHaveCount(0); // not alone any more
  await tid(page, 'wizard-finish').click();
  await expect(tid(page, 'ask')).toBeVisible();
  const st = await sharedState(page);
  expect(Object.values<{ name: string }>(st.members).map((m) => m.name).sort()).toEqual(['Alex', 'Jo', 'Sam']);
  await expect(tid(page, 'who-everyone')).toBeVisible();
});

test('a used invite and a wrong code are refused with a plain message and a way forward', async ({ page }) => {
  const { code } = await arriveWithInvite(page, SAMPLE.slice(0, 2));
  await tid(page, 'continue-in-browser').click();
  await tid(page, 'join-new').click();
  await tid(page, 'name-input').fill('Jo');
  await tid(page, 'wizard-next').click();
  await expect(tid(page, 'wizard-favorites')).toBeVisible();
  // the same code again (as another newcomer would): already used
  await wtw(page, (w) => w.sync.unpair());
  await page.evaluate(() => sessionStorage.removeItem('pt.install.skipped'));
  await page.goto(`${MEM_URL}&join=${code}`);
  await tid(page, 'continue-in-browser').click();
  await expect(tid(page, 'invite-error')).toBeVisible();
  await expect(tid(page, 'invite-error')).toContainText(/already been used|isn.t right/i);
  await expect(tid(page, 'invite-error')).not.toContainText(/undefined|Error:|permission/i);
  await expect(tid(page, 'invite-retry')).toBeVisible();
  await expect(tid(page, 'invite-start-own')).toBeVisible();
  // typing a wrong code by hand
  await tid(page, 'invite-other-code').click();
  await tid(page, 'code-input').fill('zzz-999');
  await tid(page, 'code-submit').click();
  await expect(tid(page, 'invite-error')).toContainText(/isn.t right|check it/i);
  await tid(page, 'invite-start-own').click();
  await expect(tid(page, 'setup-name')).toBeVisible();
});

test('"I\'m already a member": pick yourself, see the warning, take your place back with your data', async ({ page }) => {
  const { ids } = await arriveWithInvite(page, SAMPLE);
  await tid(page, 'continue-in-browser').click();
  await tid(page, 'join-existing').click();
  await expect(tid(page, 'join-existing-screen')).toBeVisible();
  await expect(tid(page, 'existing-confirm')).toBeDisabled();
  await tid(page, `existing-${ids.Sam}`).click();
  await expect(tid(page, 'existing-warning')).toContainText('signed out');
  await expect(tid(page, 'existing-warning')).toContainText('Sam');
  await tid(page, 'existing-confirm').click();
  await expect(tid(page, 'tabbar')).toBeVisible();
  const st = await sharedState(page);
  const me = await wtw(page, (w) => w.sync.getDevice().memberId);
  expect(me).toBe(ids.Sam);
  // Sam's data is intact: her favourites and never-show-me choices
  expect(st.profiles[ids.Sam].favorites.length).toBeGreaterThan(5);
  expect(st.profiles[ids.Sam].dealbreakers.scary).toBe(true);
  await tid(page, 'tab-us').click();
  await expect(tid(page, `profile-${ids.Sam}`)).toBeVisible();
});

test('a full household: newcomers can only take an existing place back', async ({ page }) => {
  await arriveWithInvite(page, [...SAMPLE, DEE]);
  await tid(page, 'continue-in-browser').click();
  await expect(tid(page, 'invite-preview')).toBeVisible();
  await expect(tid(page, 'invite-full')).toContainText('4');
  await expect(tid(page, 'join-new')).toHaveCount(0);
  await expect(tid(page, 'join-existing')).toBeVisible();
});

test('a code can also be typed by hand (any case, spaces and dashes ignored)', async ({ page }) => {
  const { code } = await arriveWithInvite(page, SAMPLE.slice(0, 2));
  await page.goto(MEM_URL); // no ?join=
  await tid(page, 'continue-in-browser').click();
  await expect(tid(page, 'setup')).toBeVisible();
  await tid(page, 'have-code').click();
  await tid(page, 'code-input').fill(`${code.slice(0, 3).toLowerCase()} - ${code.slice(3).toLowerCase()}`);
  await tid(page, 'code-submit').click();
  await expect(tid(page, 'invite-title')).toHaveText('Join Alex and Sam');
});
