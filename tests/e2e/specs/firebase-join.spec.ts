import { expect, test } from '../helpers/fixtures';
import { joinAsExisting, joinAsNew, makeInvite, memberIds, newPhone, openInvite, openSettings, openTab, tid, withDebug, wtw } from '../helpers/app';

// Real Firebase. Each phone is its own browser context. One retry is allowed for network flake only.
test.describe.configure({ retries: 1, timeout: 240_000 });

test('join by invite link: the link shows "Join <name>", the newcomer joins through setup, both see each other; a third joins the same way', async ({ group, browser }, testInfo) => {
  const g = await group(['Alex']);
  const [A] = g.pages;
  // the invite screen shows a link of the right shape and the bare code
  await openSettings(A);
  await tid(A, 'invite-make').click();
  await expect(tid(A, 'invite-link')).toHaveText(/\/pick-tonight\/\?join=[A-Z0-9]{6}$/, { timeout: 30_000 });
  const code = ((await tid(A, 'invite-code').textContent()) ?? '').replace(/\s/g, '');
  const link = ((await tid(A, 'invite-link').textContent()) ?? '').trim();
  expect(link.endsWith(code)).toBe(true);
  await tid(A, 'invite-hide').click();

  const B = await newPhone(browser, testInfo);
  g.phones.push(B);
  await openInvite(B.page, link);
  await expect(tid(B.page, 'invite-title')).toHaveText('Join Alex');
  await joinAsNew(B.page, 'Sam');
  for (const p of [A, B.page]) await expect.poll(async () => Object.keys(await memberIds(p)).sort(), { timeout: 45_000 }).toEqual(['Alex', 'Sam']);
  // each sees the other's name on the who-picker
  await openTab(A, 'tonight');
  await expect(A.locator('[data-testid^="who-"]', { hasText: 'Sam' })).toBeVisible({ timeout: 45_000 });
  await expect(B.page.locator('[data-testid^="who-"]', { hasText: 'Alex' })).toBeVisible({ timeout: 45_000 });

  // a third phone, joining the same way (the invite now names both)
  const { link: link2 } = await makeInvite(A);
  const C = await newPhone(browser, testInfo);
  g.phones.push(C);
  await openInvite(C.page, link2);
  await expect(tid(C.page, 'invite-title')).toHaveText('Join Alex and Sam');
  await joinAsNew(C.page, 'Kit');
  for (const p of [A, B.page, C.page]) await expect.poll(async () => Object.keys(await memberIds(p)).sort(), { timeout: 45_000 }).toEqual(['Alex', 'Kit', 'Sam']);
});

test('a fourth member joins, a fifth is told the household is full (and can only take a place back)', async ({ group, browser }, testInfo) => {
  const g = await group(['Alex', 'Sam', 'Kit', 'Dee']);
  for (const p of g.pages) await expect.poll(async () => Object.keys(await memberIds(p)).length, { timeout: 45_000 }).toBe(4);
  const { link } = await makeInvite(g.pages[0]); // a full household can still make an invite, for taking a place back
  const E = await newPhone(browser, testInfo);
  g.phones.push(E);
  await openInvite(E.page, link);
  await expect(tid(E.page, 'invite-full')).toBeVisible();
  await expect(tid(E.page, 'join-new')).toHaveCount(0);
  await expect(tid(E.page, 'join-existing')).toBeVisible();
  await expect(tid(E.page, 'invite-members').locator('li')).toHaveCount(4);
  // Settings on a full household says so
  await openSettings(g.pages[0]);
  await expect(tid(g.pages[0], 'invite-rejoin')).toBeVisible();
  await expect(tid(g.pages[0], 'invite-block')).toHaveCount(0);
});

test('a used link is refused with a plain message; so is a wrong code; a duplicate name is refused by the server too', async ({ group, browser }, testInfo) => {
  const g = await group(['Alex']);
  const [A] = g.pages;
  const { link, code } = await makeInvite(A);
  const B = await newPhone(browser, testInfo);
  g.phones.push(B);
  await openInvite(B.page, link);
  await joinAsNew(B.page, 'Sam');

  // the same link on another phone: already used
  const C = await newPhone(browser, testInfo);
  g.phones.push(C);
  await C.page.goto(withDebug(link));
  if (await tid(C.page, 'welcome').isVisible()) await tid(C.page, 'continue-in-browser').click();
  await expect(tid(C.page, 'invite-error')).toBeVisible({ timeout: 30_000 });
  await expect(tid(C.page, 'invite-error')).toContainText(/already been used|isn.t right/i);
  await expect(tid(C.page, 'invite-members')).toHaveCount(0); // nothing about the household is shown
  await expect(tid(C.page, 'invite-error')).not.toContainText(/permission|undefined|Error:/i);

  // a wrong code typed by hand
  await tid(C.page, 'invite-other-code').click();
  await tid(C.page, 'code-input').fill('ZZZ999');
  await tid(C.page, 'code-submit').click();
  await expect(tid(C.page, 'invite-error')).toContainText(/isn.t right|check it/i, { timeout: 30_000 });
  void code;

  // a duplicate name: the screen refuses it, and so does the server if asked directly
  const { link: link2 } = await makeInvite(A);
  const D = await newPhone(browser, testInfo);
  g.phones.push(D);
  await openInvite(D.page, link2);
  await tid(D.page, 'join-new').click();
  await tid(D.page, 'name-input').fill('sam');
  await expect(tid(D.page, 'wizard-next')).toBeDisabled();
  await expect(tid(D.page, 'name-hint')).toContainText('already');
  const code2 = link2.split('join=')[1];
  const outcome = await wtw(
    D.page,
    async (w, c) => {
      try {
        await w.sync.joinWithCode(c, { name: 'SAM', profile: { ...w.engine.emptyProfile(), onboarded: true } });
        return 'joined';
      } catch (e) {
        return (e as Error).message;
      }
    },
    code2,
  );
  expect(outcome).not.toBe('joined');
  expect(outcome).toMatch(/name/i);
  // the code was not burned by the refusal: a good name still works
  await tid(D.page, 'name-input').fill('Dee');
  await tid(D.page, 'wizard-next').click();
  await expect(tid(D.page, 'wizard-favorites')).toBeVisible({ timeout: 45_000 });
});

test('"I\'m already a member": a new phone takes over Sam, sees Sam\'s data, and the old phone is told it is signed out', async ({ group, browser }, testInfo) => {
  const g = await group(['Alex', 'Sam']);
  const [A, B] = g.pages;
  // Sam's data on the old phone: a favourite-ish marker (watched title) and a never-show-me choice
  await wtw(
    B,
    async (w) => {
      const me = w.sync.getDevice().memberId;
      await w.sync.markWatched(me, [{ itemId: 'tv-8592', source: 'manual', snapshot: { title: 'Parks and Recreation', year: 2009, poster: null } }]);
      const p = w.sync.getState().profiles[me];
      await w.sync.saveProfile({ ...p, dealbreakers: { ...p.dealbreakers, scary: true } });
    },
  );
  const { link } = await makeInvite(A);
  const N = await newPhone(browser, testInfo);
  g.phones.push(N);
  await openInvite(N.page, link);
  await joinAsExisting(N.page, 'Sam');
  const mine = await wtw(N.page, (w) => ({ me: w.sync.getDevice().memberId, st: JSON.parse(JSON.stringify(w.sync.getState())) }));
  expect(mine.st.members[mine.me].name).toBe('Sam');
  expect(Object.keys(mine.st.seen[mine.me])).toContain('tv-8592');
  expect(mine.st.profiles[mine.me].dealbreakers.scary).toBe(true);
  await openTab(N.page, 'history');
  await expect(N.page.locator('[data-testid="history-row"][data-item-id="tv-8592"]')).toHaveCount(1);
  // the old phone is signed out with a plain message, and offered the way forward
  await expect(tid(B, 'device-error')).toBeVisible({ timeout: 60_000 });
  await expect(tid(B, 'device-error')).toContainText(/no longer part of the household/i);
  await expect(tid(B, 'device-error-next')).toBeVisible();
  await expect(tid(B, 'tabbar')).toHaveCount(0);
  // nothing was duplicated: still two members
  await expect.poll(async () => Object.keys(await memberIds(A)).length, { timeout: 30_000 }).toBe(2);
});
