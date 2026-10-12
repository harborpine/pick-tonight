import { expect, test } from '../helpers/fixtures';
import { fsStatus, householdId, idToken, openTab, sharedState, strangerToken, tid, wtw } from '../helpers/app';

test.describe.configure({ retries: 1, timeout: 240_000 });

test('two unrelated households cannot see or affect each other, through the screens or through the database rules', async ({ group }) => {
  const one = await group(['Alex']);
  const two = await group(['Zed']);
  const [A] = one.pages;
  const [Z] = two.pages;
  const hid1 = await householdId(A);
  const hid2 = await householdId(Z);
  expect(hid1).not.toBe(hid2);

  // household one fills its lists
  await wtw(
    A,
    async (w, me) => {
      const snap = { title: 'Parks and Recreation', year: 2009, poster: null };
      await w.sync.markWatched(me, [{ itemId: 'tv-8592', source: 'manual', snapshot: snap }]);
      await w.sync.addToWatchlist('ours', 'tv-48891', me, { title: 'Brooklyn Nine-Nine', year: 2013, poster: null });
      await w.sync.setNever(me, 'tv-1434', true);
      await w.sync.addPick({ kind: 'solo', who: [me], itemId: 'tv-8592', snapshot: snap, pick: { type: 'any-episode' }, service: { serviceId: 'hulu', planId: 'ads', adFree: false } });
      await w.sync.flush?.();
    },
    one.ids.Alex,
  );
  await expect.poll(async () => (await sharedState(A)).picks.length).toBe(1);

  // --- through the screens: household two sees none of it, and keeps seeing only itself ---
  await openTab(Z, 'matches');
  await expect(tid(Z, 'matches-empty')).toBeVisible();
  await openTab(Z, 'watchlist');
  await expect(tid(Z, 'watchlist-empty')).toBeVisible();
  await openTab(Z, 'history');
  await expect(tid(Z, 'history-empty')).toBeVisible();
  const st2 = await sharedState(Z);
  expect(Object.values<{ name: string }>(st2.members).map((m) => m.name)).toEqual(['Zed']);
  expect(JSON.stringify(st2)).not.toContain('Alex');
  expect(JSON.stringify(st2)).not.toContain('tv-8592');
  // ...and what household two does does not show up in one
  await wtw(Z, async (w, me) => w.sync.markWatched(me, [{ itemId: 'tv-1668', source: 'manual', snapshot: { title: 'Friends', year: 1994, poster: null } }]), two.ids.Zed);
  await Z.waitForTimeout(4000);
  const st1 = await sharedState(A);
  expect(Object.values<{ name: string }>(st1.members).map((m) => m.name)).toEqual(['Alex']);
  expect(JSON.stringify(st1)).not.toContain('tv-1668');
  expect(JSON.stringify(st1)).not.toContain('Zed');

  // --- through the database rules, with household two's own credentials (and a stranger's) ---
  const tokenZ = await idToken(Z);
  const stranger = await strangerToken();
  expect(await fsStatus(tokenZ, `households/${hid2}`), 'control: Zed can read their own household').toBe(200);
  expect(await fsStatus(tokenZ, `households/${hid2}/data/shared`), 'control: and its shared data').toBe(200);
  const month = new Date().toISOString().slice(0, 7);
  const m1 = one.ids.Alex;
  const targets = [
    `households/${hid1}`,
    `households/${hid1}/data/shared`,
    `households/${hid1}/data/${m1}`,
    `households/${hid1}/seenx/${m1}_0`,
    `households/${hid1}/seenx/${m1}_1`,
    `households/${hid1}/months/${month}`,
    `households/${hid1}/sessions/current`,
    `households`,
    `households/${hid1}/data`,
    `households/${hid1}/seenx`,
    `invites`,
  ];
  for (const path of targets) {
    for (const [who, t] of [['household two', tokenZ], ['a stranger', stranger]] as const) {
      expect(await fsStatus(t, path), `${who} reading ${path}`).toBe(403);
    }
  }
  // writes and deletes are refused too
  for (const [who, t] of [['household two', tokenZ], ['a stranger', stranger]] as const) {
    expect(await fsStatus(t, `households/${hid1}/data/shared`, 'PATCH'), `${who} writing`).toBe(403);
    expect(await fsStatus(t, `households/${hid1}`, 'PATCH'), `${who} editing the household`).toBe(403);
    expect(await fsStatus(t, `households/${hid1}`, 'DELETE'), `${who} deleting the household`).toBe(403);
  }
  // household one is untouched by all of that
  expect(await fsStatus(await idToken(A), `households/${hid1}`)).toBe(200);
  const after = await sharedState(A);
  expect(after.picks).toHaveLength(1);
  expect(Object.keys(after.seen[one.ids.Alex])).toContain('tv-8592');
});
