/**
 * Integration suite against the REAL Firebase project (npm run test:sync).
 * Every simulated phone is its own Firebase app instance with its own anonymous identity.
 * Each run creates its own fresh households and deletes them afterwards.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  initializeFirestore,
  memoryLocalCache,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import webConfig from '../../firebase.web-config.json';
import type { SharedState } from '../contracts';
import { createFirebaseSync, type FirebaseSyncApi, type FirebaseSyncOptions } from './firebase';
import { card, profile, requestFor, settings, snap } from './fixtures';
import { PATHS, seenDocId } from './layout';

const run = Math.random().toString(36).slice(2, 8);
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const phones: FirebaseSyncApi[] = [];
const phone = (name: string, extra: FirebaseSyncOptions = {}) => {
  const p = createFirebaseSync({ appName: `${name}-${run}`, persistence: false, storage: mem(), ...extra });
  phones.push(p);
  return p;
};

async function until<T = SharedState>(sync: FirebaseSyncApi, pred: (s: SharedState) => boolean, ms = 30000): Promise<SharedState> {
  return new Promise((resolve, reject) => {
    let off: () => void = () => undefined;
    let done = false;
    const t = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for state; last=${JSON.stringify(sync.getState())?.slice(0, 400)}`));
    }, ms);
    off = sync.onState((s) => {
      if (!done && pred(s)) {
        done = true;
        clearTimeout(t);
        queueMicrotask(() => off());
        resolve(s);
      }
    });
  });
}
async function untilDevice(sync: FirebaseSyncApi, pred: (d: ReturnType<FirebaseSyncApi['getDevice']>) => boolean, ms = 30000) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`device timed out; last=${JSON.stringify(sync.getDevice())}`)), ms);
    const off = sync.onDevice((d) => {
      if (pred(d)) {
        clearTimeout(t);
        queueMicrotask(() => off());
        resolve();
      }
    });
  });
}

async function outsider(): Promise<{ db: Firestore; uid: string }> {
  const app = initializeApp(webConfig, `outsider-${run}-${Math.random().toString(36).slice(2, 6)}`);
  const cred = await signInAnonymously(getAuth(app));
  return { db: initializeFirestore(app, { localCache: memoryLocalCache(), experimentalAutoDetectLongPolling: true }), uid: cred.user.uid };
}
const denied = async (p: Promise<unknown>) => {
  await expect(p).rejects.toMatchObject({ code: expect.stringContaining('permission-denied') });
};
/** Reading this path gives nothing: refused, or the document does not exist. */
const gone = async (db: Firestore, path: string) => {
  try {
    const s = await getDoc(doc(db, path));
    expect(s.exists(), `${path} should not exist`).toBe(false);
  } catch (e) {
    expect((e as { code?: string }).code).toContain('permission-denied');
  }
};

const w = (itemId: string, extra: Record<string, unknown> = {}) => ({ itemId, source: 'manual' as const, snapshot: snap(itemId), ...extra });
const solo = (who: string[], itemId: string) => ({ kind: 'solo' as const, who, itemId, snapshot: snap(), pick: { type: 'movie' as const }, service: card('x').service });

afterAll(async () => {
  for (const p of phones) {
    try {
      if (p.getDevice().status === 'paired') {
        await p.flush();
        await p.deleteHousehold();
      }
    } catch (e) {
      console.warn('cleanup failed', e);
    }
    await p.dispose();
  }
});

// ===================================================================================
describe('a household of four', () => {
  let A: FirebaseSyncApi; // Alex, m1
  let B: FirebaseSyncApi; // Sam, m2
  let C: FirebaseSyncApi; // Kit, m3
  let D: FirebaseSyncApi; // Robin, m4
  let hid: string;
  let codeForOutsiders: string;

  beforeAll(async () => {
    A = phone('A');
    B = phone('B');
    C = phone('C');
    D = phone('D');
    for (const p of [A, B, C, D]) await p.init();
    expect(A.getDevice().status).toBe('unpaired');
  });

  it('create -> invite -> preview -> join as new members; names unique; fifth refused', async () => {
    await A.createHousehold('Alex', profile(['tv-1']), settings());
    expect(A.getDevice()).toMatchObject({ status: 'paired', memberId: 'm1' });
    hid = A.debug().hid!;
    const code = await A.createInvite();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    // Preview works without being a member.
    expect(await B.previewInvite(code.toLowerCase())).toEqual({ members: [{ id: 'm1', name: 'Alex' }], full: false });
    // A duplicate name (any case) is refused with a plain sentence; the code is NOT used up.
    await expect(B.joinWithCode(code, { name: ' ALEX ', profile: profile() })).rejects.toThrow(/already has that name/);
    await expect(B.joinWithCode(code, { name: '', profile: profile() })).rejects.toThrow(/name/);
    await B.joinWithCode(code, { name: 'Sam', profile: profile([], true) });
    expect(B.getDevice()).toMatchObject({ status: 'paired', memberId: 'm2' });

    const a = await until(A, (s) => Object.keys(s.members).length === 2 && !!s.profiles.m2);
    const b = await until(B, (s) => Object.keys(s.members).length === 2 && s.profiles.m1!.favorites.length === 1);
    expect(b.profiles).toEqual(a.profiles);
    expect(b.settings).toEqual(a.settings);
    expect(b.profiles.m2!.dealbreakers.horror).toBe(true);
    expect(Object.keys(a.seen).sort()).toEqual(['m1', 'm2']);

    // The code is used up.
    await expect(C.joinWithCode(code, { name: 'Kit', profile: profile() })).rejects.toThrow(/already been used/);
    await expect(C.previewInvite(code)).rejects.toThrow(/already been used/);
    codeForOutsiders = code;

    const c2 = await A.createInvite();
    expect((await C.previewInvite(c2)).members.map((m) => m.name)).toEqual(['Alex', 'Sam']);
    await C.joinWithCode(c2, { name: 'Kit', profile: profile() });
    const c3 = await B.createInvite(); // any member can invite
    await D.joinWithCode(c3, { name: 'Robin', profile: profile() });
    expect(D.getDevice().memberId).toBe('m4');
    const four = await until(A, (s) => Object.keys(s.members).length === 4);
    expect(Object.values(four.members).map((m) => m.name)).toEqual(['Alex', 'Sam', 'Kit', 'Robin']);

    const c4 = await A.createInvite();
    expect(await phone('E').previewInvite(c4)).toMatchObject({ full: true });
    const E = phone('E2');
    await E.init();
    await expect(E.joinWithCode(c4, { name: 'Fifth', profile: profile() })).rejects.toThrow(/already has 4 people/);
  });

  it('even a hand-made request cannot add a fifth member, or join without the household\'s invite', async () => {
    const c5 = await A.createInvite();
    const { db, uid } = await outsider();
    const batch = writeBatch(db);
    batch.update(doc(db, PATHS.invite(c5)), { used: true, usedBy: uid, members: [] });
    batch.update(
      doc(db, PATHS.household(hid)),
      new FieldPath('members', 'm5'), { name: 'Fifth', joinedAt: Date.now() },
      new FieldPath('names', 'n:fifth'), 'm5',
      new FieldPath('owners', 'm5'), uid,
      new FieldPath('uids', uid), 'm5',
      'nextId', 6,
    );
    await denied(batch.commit());
    // Using up the invite without joining is refused too.
    await denied(updateDoc(doc(db, PATHS.invite(c5)), { used: true, usedBy: uid, members: [] }));
    // Joining without using the invite up is refused.
    await denied(updateDoc(doc(db, PATHS.household(hid)), new FieldPath('owners', 'm1'), uid, new FieldPath('uids', uid), 'm1'));
  });

  it('re-claim: a new phone takes over an existing member; the old phone loses access', async () => {
    const code = await A.createInvite();
    const F = phone('F');
    await F.init();
    const pv = await F.previewInvite(code);
    expect(pv.members.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    await F.joinWithCode(code, { memberId: 'm2' });
    expect(F.getDevice()).toMatchObject({ status: 'paired', memberId: 'm2' });
    const f = await until(F, (s) => Object.keys(s.members).length === 4 && s.profiles.m2!.dealbreakers.horror);
    expect(f.members.m2!.name).toBe('Sam'); // same person, same profile
    // The old phone is signed out with a plain message...
    await untilDevice(B, (d) => d.status === 'unpaired');
    expect(B.getDevice().error).toMatch(/no longer part of the household/);
    // ...and can no longer read or write anything.
    const bdb = B.debug().db!;
    await denied(getDoc(doc(bdb, PATHS.shared(hid))));
    await denied(setDoc(doc(bdb, PATHS.memberDoc(hid, 'm2')), { never: { x: 1 } }, { merge: true }));
    // Nobody new was added and the code is used up.
    expect(Object.keys(A.getState()!.members)).toHaveLength(4);
    B = F; // from here on "Sam's phone" is F
  });

  it('concurrent different edits from three phones all survive', async () => {
    await Promise.all([
      A.setNever('m1', 'tv-100', true),
      B.addToWatchlist('ours', 'tv-200', 'm2', snap('Ours')),
      C.saveProfile({ ...C.getState()!.profiles.m3!, onboarded: true }),
      D.setNotTonight('m4', 'tv-300', '2099-01-01'),
      A.addPick(solo(['m1'], 'tv-400')),
    ]);
    for (const p of [A, B, C, D]) {
      const s = await until(p, (st) => st.never.m1!['tv-100'] !== undefined && st.watchlist.some((x) => x.itemId === 'tv-200') && st.profiles.m3!.onboarded && st.notTonight.m4!['tv-300'] === '2099-01-01' && st.picks.some((x) => x.itemId === 'tv-400'));
      expect(s.watchlist.find((x) => x.itemId === 'tv-200')!.list).toBe('ours');
    }
    // Own watchlists live per member; removing is field-level too.
    await A.addToWatchlist('m1', 'tv-201', 'm1', snap());
    await until(D, (s) => s.watchlist.some((x) => x.itemId === 'tv-201' && x.list === 'm1'));
    await A.removeFromWatchlist('m1', 'tv-201');
    await until(D, (s) => !s.watchlist.some((x) => x.itemId === 'tv-201'));
    // Picks can be removed.
    const pick = A.getState()!.picks.find((x) => x.itemId === 'tv-400')!;
    await A.removePick(pick.id);
    await until(C, (s) => !s.picks.some((x) => x.itemId === 'tv-400'));
  });

  it('markWatched with 3,000 entries reaches another phone; unmark follows', async () => {
    const many = Array.from({ length: 3000 }, (_, i) => w(`tv-${i}`, { source: 'import', at: i + 1, plays: 2 }));
    await A.markWatched('m1', many);
    const s = await until(C, (st) => Object.keys(st.seen.m1!).length === 3000, 90000);
    expect(s.seen.m1!['tv-7']).toEqual({ at: 8, source: 'import', plays: 2, snapshot: snap('tv-7') });
    expect(Object.keys(s.seen.m2!)).toHaveLength(0); // other people's lists untouched
    await A.unmarkWatched('m1', many.slice(0, 1500).map((e) => e.itemId));
    await until(C, (st) => Object.keys(st.seen.m1!).length === 1500, 90000);
    await A.markWatched('m1', [w('tv-9999')]); // small calls work after big ones
    await until(B, (st) => st.seen.m1!['tv-9999'] !== undefined);
  });

  it('Together: a 3-person session matches only when all three say yes, exactly once under simultaneous final yeses', async () => {
    const who = ['m1', 'm2', 'm3'];
    const id = await A.startSession('m1', requestFor(who), [card('tv-1'), card('tv-2')]);
    const s0 = await until(C, (s) => s.activeSession?.id === id);
    expect(s0.activeSession!.request.who).toEqual(who);
    expect(s0.activeSession!.joined).toEqual(['m1']);
    expect(Object.keys(s0.activeSession!.yes).sort()).toEqual(who);
    // The fourth member (not in the audience) can see the session exists.
    const s4 = await until(D, (s) => s.activeSession?.id === id);
    expect(s4.activeSession!.joined).not.toContain('m4');
    await B.joinSession(id, 'm2');
    await C.joinSession(id, 'm3');
    await until(A, (s) => s.activeSession?.joined.length === 3);

    expect(await A.swipeInSession(id, 'm1', 'tv-1', true, snap('One'))).toBe(false);
    expect(await B.swipeInSession(id, 'm2', 'tv-2', false, snap('Two'))).toBe(false);
    // Two yeses are not enough...
    expect(await B.swipeInSession(id, 'm2', 'tv-1', true, snap('One'))).toBe(false);
    expect(A.getState()!.picks.filter((p) => p.kind === 'match')).toHaveLength(0);
    // ...a member outside the audience cannot complete or fake a match...
    expect(await D.swipeInSession(id, 'm4', 'tv-1', true, snap('One'))).toBe(false);
    // ...and the third yes matches.
    expect(await C.swipeInSession(id, 'm3', 'tv-1', true, snap('One'))).toBe(true);
    for (const p of [A, B, C, D]) {
      const s = await until(p, (st) => st.activeSession?.matches.length === 1);
      expect(s.picks.filter((x) => x.kind === 'match')).toHaveLength(1);
      expect(s.picks.find((x) => x.kind === 'match')).toMatchObject({ who, itemId: 'tv-1', sessionId: id });
    }
    await A.endSession(id);
    await until(D, (s) => s.activeSession === null);

    // Simultaneous final yeses from different phones: exactly one match.
    const id2 = await A.startSession('m1', requestFor(who), [card('tv-5')]);
    await until(B, (s) => s.activeSession?.id === id2);
    await until(C, (s) => s.activeSession?.id === id2);
    await A.swipeInSession(id2, 'm1', 'tv-5', true, snap('Five'));
    const [rb, rc] = await Promise.all([B.swipeInSession(id2, 'm2', 'tv-5', true, snap('Five')), C.swipeInSession(id2, 'm3', 'tv-5', true, snap('Five'))]);
    expect([rb, rc].filter(Boolean)).toHaveLength(1);
    const after = await until(A, (s) => s.activeSession?.id === id2 && s.activeSession.matches.length === 1);
    await new Promise((r) => setTimeout(r, 1500));
    expect(A.getState()!.activeSession!.matches).toHaveLength(1);
    expect(A.getState()!.picks.filter((x) => x.sessionId === id2)).toHaveLength(1);
    expect(after.activeSession!.matches[0]!.itemId).toBe('tv-5');
    await A.endSession(id2);
  });

  it('Together: a pair inside a household of four does not need the other two', async () => {
    const pair = ['m2', 'm4'];
    const id = await B.startSession('m2', requestFor(pair), [card('tv-7')]);
    await until(D, (s) => s.activeSession?.id === id);
    expect(await B.swipeInSession(id, 'm2', 'tv-7', true, snap('Seven'))).toBe(false);
    expect(await D.swipeInSession(id, 'm4', 'tv-7', true, snap('Seven'))).toBe(true);
    const s = await until(A, (st) => st.picks.some((p) => p.sessionId === id));
    expect(s.picks.find((p) => p.sessionId === id)!.who).toEqual(pair);
    expect(Object.keys(s.activeSession!.yes).sort()).toEqual(pair);
    // appending cards works from any phone; ending clears it for everyone
    await D.appendSessionDeck(id, [card('tv-7'), card('tv-8')]);
    await until(B, (st) => st.activeSession?.deck.length === 2);
    await B.endSession(id);
    await until(A, (st) => st.activeSession === null);
  });

  it('rename: unique, validated, visible to the others and to the next invite preview', async () => {
    await A.renameMember('m1', 'Alexander');
    await until(C, (s) => s.members.m1!.name === 'Alexander');
    await expect(A.renameMember('m1', 'sam')).rejects.toThrow(/already has that name/);
    await expect(A.renameMember('m1', 'x'.repeat(21))).rejects.toThrow(/at most 20/);
    await expect(A.renameMember('m1', '   ')).rejects.toThrow(/name/);
    await A.renameMember('m1', 'ALEXANDER'); // case-only change
    await A.renameMember('m1', 'Alex');
    const code = await C.createInvite();
    expect((await phone('P1').previewInvite(code)).members.map((m) => m.name)).toEqual(['Alex', 'Sam', 'Kit', 'Robin']);
    await A.renameMember('m3', 'Kit2'); // the outstanding invite's preview stays fresh
    expect((await phone('P2').previewInvite(code)).members.map((m) => m.name)).toEqual(['Alex', 'Sam', 'Kit2', 'Robin']);
    await C.renameMember('m3', 'Kit');
  });

  it('outsiders cannot read, write or list anything; an invite only shows its preview', async () => {
    const { db } = await outsider();
    const paths = [
      PATHS.household(hid),
      PATHS.shared(hid),
      PATHS.memberDoc(hid, 'm1'),
      PATHS.seenShard(hid, seenDocId('m1', 0)),
      PATHS.month(hid, new Date().toISOString().slice(0, 7)),
      PATHS.session(hid),
    ];
    for (const p of paths) await denied(getDoc(doc(db, p)));
    for (const c of [PATHS.data(hid), PATHS.seenColl(hid), PATHS.months(hid), PATHS.sessions(hid), 'households', 'invites']) await denied(getDocs(collection(db, c)));
    await denied(setDoc(doc(db, PATHS.shared(hid)), { settings: { plans: { evil: 'x' } } }));
    await denied(updateDoc(doc(db, PATHS.household(hid)), { deleting: true }));
    await denied(updateDoc(doc(db, PATHS.household(hid)), new FieldPath('owners', 'm1'), 'someone-else'));
    await denied(setDoc(doc(db, PATHS.memberDoc(hid, 'm1')), { never: { x: 1 } }, { merge: true }));
    await denied(setDoc(doc(db, PATHS.seenShard(hid, 'm1_0')), { e: { 'tv-1': 'x' } }));
    await denied(setDoc(doc(db, PATHS.session(hid)), { status: 'open' }));
    await denied(setDoc(doc(db, `households/${hid}/evil/x`), { a: 1 }));
    await denied(setDoc(doc(db, 'evil/x'), { a: 1 }));
    await denied(setDoc(doc(db, 'users/x'), { a: 1 }));

    // Joining a household with a used code, a wrong code, or someone else's invite fails.
    const O = phone('O');
    await O.init();
    await expect(O.joinWithCode(codeForOutsiders, { name: 'Mallory', profile: profile() })).rejects.toThrow(/already been used/);
    await expect(O.joinWithCode('ABCDEF', { name: 'Mallory', profile: profile() })).rejects.toThrow(/isn't right/);
    await expect(O.joinWithCode('12', { name: 'Mallory', profile: profile() })).rejects.toThrow(/isn't right/);
    expect(O.getDevice().status).toBe('unpaired');

    // A valid code shows a preview and nothing more.
    const code = await A.createInvite();
    const raw = await getDoc(doc(db, PATHS.invite(code)));
    expect(raw.exists()).toBe(true);
    expect(Object.keys(raw.data()!).sort()).toEqual(['createdAt', 'createdBy', 'full', 'hid', 'members', 'nextId', 'used']);
    await denied(getDoc(doc(db, PATHS.shared(hid))));
    await denied(getDocs(collection(db, PATHS.data(hid))));
    await denied(setDoc(doc(db, PATHS.invite('QQQQQQ')), { hid, createdBy: 'x', createdAt: serverTimestamp(), used: false, members: [{ id: 'm1', name: 'x' }], full: false, nextId: 2 }));
    // A made-up household cannot be created with two members or someone else's uid.
    const ref = doc(collection(db, 'households'));
    await denied(setDoc(ref, { createdAt: serverTimestamp(), nextId: 3, members: { m1: { name: 'A', joinedAt: 1 }, m2: { name: 'B', joinedAt: 1 } }, names: {}, owners: {}, uids: {} }));
  });

  it('oversized or malformed writes are rejected by the rules', async () => {
    const db = A.debug().db!;
    const many = (n: number, v: unknown) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, v]));
    await denied(setDoc(doc(db, PATHS.shared(hid)), { settings: { plans: {} }, ours: many(1001, '{}') }));
    await denied(setDoc(doc(db, PATHS.memberDoc(hid, 'm1')), { never: many(3001, 1) }));
    await denied(setDoc(doc(db, PATHS.memberDoc(hid, 'm1')), { watch: many(1001, '{}') }));
    await denied(setDoc(doc(db, PATHS.memberDoc(hid, 'm1')), { profile: { favorites: Array.from({ length: 41 }, (_, i) => ({ id: `tv-${i}` })) } }));
    await denied(setDoc(doc(db, PATHS.memberDoc(hid, 'm1')), { surprise: 1 }));
    await denied(setDoc(doc(db, PATHS.memberDoc(hid, 'm77')), { never: {} })); // not a member
    await denied(setDoc(doc(db, PATHS.seenShard(hid, 'm1_0')), { e: many(2501, '{}') }));
    await denied(setDoc(doc(db, PATHS.seenShard(hid, 'm1_9')), { e: {} })); // no such shard
    await denied(setDoc(doc(db, PATHS.seenShard(hid, 'm77_0')), { e: {} }));
    await denied(setDoc(doc(db, PATHS.month(hid, '2026-10')), { entries: many(1501, '{}') }));
    await denied(setDoc(doc(db, PATHS.month(hid, '9999-99')), { entries: {} }));
    await denied(setDoc(doc(db, PATHS.month(hid, 'whenever')), { entries: {} }));
    await denied(setDoc(doc(db, `${PATHS.data(hid)}/other`), { a: 1 }));
    await denied(setDoc(doc(db, `${PATHS.sessions(hid)}/another`), { id: 'x' }));
    await denied(setDoc(doc(db, PATHS.session(hid)), { id: 'x', startedBy: 'm1', request: {}, deck: Array.from({ length: 401 }, () => ({})), joined: [], yes: {}, passed: {}, matches: [], status: 'open', createdAt: 1 }));
    await denied(setDoc(doc(db, `households/${hid}/evil/x`), { a: 1 }));
    await denied(setDoc(doc(db, 'evil/x'), { a: 1 }));
    // Household document: no new members by hand, no rewriting who owns whom.
    await denied(updateDoc(doc(db, PATHS.household(hid)), new FieldPath('members', 'm9'), { name: 'Ghost', joinedAt: 1 }, new FieldPath('names', 'n:ghost'), 'm9'));
    await denied(updateDoc(doc(db, PATHS.household(hid)), new FieldPath('owners', 'm2'), A.debug().uid));
    await denied(updateDoc(doc(db, PATHS.household(hid)), { nextId: 99 }));
    // Sanity: a normal write still works.
    await setDoc(doc(db, PATHS.memberDoc(hid, 'm1')), { never: { 'tv-ok': 1 } }, { merge: true });
  });

  it('removeMember: wipes that person\'s data, keeps ours and matches, unpairs their phone', async () => {
    await D.markWatched('m4', [w('tv-4000'), w('tv-4001')]);
    await D.setNever('m4', 'tv-4002', true);
    await D.addToWatchlist('m4', 'tv-4003', 'm4', snap());
    await D.addToWatchlist('ours', 'tv-4004', 'm4', snap());
    await D.addPick(solo(['m4'], 'tv-4005'));
    await until(A, (s) => s.seen.m4!['tv-4001'] !== undefined && s.picks.some((p) => p.itemId === 'tv-4005'));
    const db = A.debug().db!;
    await A.removeMember('m4');
    const s = await until(A, (st) => !st.members.m4);
    expect(Object.keys(s.members)).toEqual(['m1', 'm2', 'm3']);
    for (const rec of [s.profiles, s.seen, s.never, s.notTonight]) expect(Object.keys(rec).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(s.watchlist.map((x) => x.itemId)).toContain('tv-4004');
    expect(s.watchlist.map((x) => x.itemId)).not.toContain('tv-4003');
    expect(s.picks.some((p) => p.itemId === 'tv-4005')).toBe(true);
    // The documents themselves are gone (a former member can no longer read them; a current member sees nothing).
    expect((await getDoc(doc(db, PATHS.memberDoc(hid, 'm4')))).exists()).toBe(false);
    for (let i = 0; i < 8; i++) expect((await getDoc(doc(db, PATHS.seenShard(hid, seenDocId('m4', i))))).exists()).toBe(false);
    await untilDevice(D, (d) => d.status === 'unpaired');
    expect(D.getDevice().error).toMatch(/no longer part of the household/);
    // The freed id is not reused.
    const code = await A.createInvite();
    const G = phone('G');
    await G.init();
    await G.joinWithCode(code, { name: 'Newcomer', profile: profile() });
    expect(G.getDevice().memberId).toBe('m5');
    // Removing yourself unpairs this phone but not the others.
    await G.removeMember('m5');
    expect(G.getDevice().status).toBe('unpaired');
    await until(A, (st) => !st.members.m5);
  });

  it('unpair: this phone only; the member and data stay and can be claimed again', async () => {
    await C.unpair();
    expect(C.getDevice().status).toBe('unpaired');
    const s = await until(A, (st) => !!st.members.m3);
    expect(s.members.m3!.name).toBe('Kit');
    const code = await A.createInvite();
    await C.joinWithCode(code, { memberId: 'm3' });
    expect(C.getDevice()).toMatchObject({ status: 'paired', memberId: 'm3' });
    await until(C, (st) => st.profiles.m3!.onboarded);
  });
});

// ===================================================================================
describe('"Delete everything" really deletes everything', () => {
  it('leaves nothing behind, closes the household first, and unpairs the other phones', async () => {
    const P = phone('DelP', { testStopBeforeFinalDelete: true });
    const Q = phone('DelQ');
    const R = phone('DelR');
    for (const p of [P, Q, R]) await p.init();
    await P.createHousehold('Pat', profile(['tv-1']), settings());
    const hid = P.debug().hid!;
    await Q.joinWithCode(await P.createInvite(), { name: 'Quinn', profile: profile() });
    await R.joinWithCode(await Q.createInvite(), { name: 'Ray', profile: profile() });
    const outstanding = await P.createInvite();

    // Data of every kind.
    await P.markWatched('m1', Array.from({ length: 40 }, (_, i) => w(`tv-${i}`)));
    await Q.markWatched('m2', Array.from({ length: 40 }, (_, i) => w(`tv-${i + 100}`)));
    await R.setNever('m3', 'tv-9', true);
    await R.setNotTonight('m3', 'tv-8', '2099-01-01');
    await Q.addToWatchlist('m2', 'tv-7', 'm2', snap());
    await P.addToWatchlist('ours', 'tv-6', 'm1', snap());
    await P.addPick(solo(['m1'], 'tv-5'));
    const sid = await P.startSession('m1', requestFor(['m1', 'm2']), [card('tv-1')]);
    await until(Q, (s) => s.activeSession?.id === sid);
    await P.swipeInSession(sid, 'm1', 'tv-1', true, snap());
    await Q.swipeInSession(sid, 'm2', 'tv-1', true, snap()); // a match -> a month document
    await until(R, (s) => s.picks.some((p) => p.kind === 'match') && Object.keys(s.seen.m2!).length === 40 && s.watchlist.length === 2);
    await P.flush();

    // Remember every document that exists.
    const pdb = P.debug().db!;
    const before: string[] = [];
    for (const c of [PATHS.data(hid), PATHS.seenColl(hid), PATHS.months(hid), PATHS.sessions(hid)]) {
      (await getDocs(collection(pdb, c))).forEach((d) => before.push(d.ref.path));
    }
    expect(before.length).toBeGreaterThanOrEqual(10);
    const { db: odb } = await outsider();
    expect((await getDoc(doc(odb, PATHS.invite(outstanding)))).exists()).toBe(true);

    // Step 1: run it up to (not including) the removal of the household document itself.
    await expect(P.deleteHousehold()).rejects.toThrow(/test-stop/);
    for (const c of [PATHS.data(hid), PATHS.seenColl(hid), PATHS.months(hid), PATHS.sessions(hid)]) {
      expect((await getDocs(collection(pdb, c))).size, `${c} should be empty`).toBe(0);
    }
    expect((await getDoc(doc(odb, PATHS.invite(outstanding)))).exists()).toBe(false);
    const hh = await getDoc(doc(pdb, PATHS.household(hid)));
    expect(hh.data()!.deleting).toBe(true);
    // A closing household accepts no new content from anyone.
    await denied(setDoc(doc(Q.debug().db!, PATHS.memberDoc(hid, 'm2')), { never: { late: 1 } }, { merge: true }));
    await denied(setDoc(doc(pdb, PATHS.shared(hid)), { settings: { plans: {} } }));

    // Step 2: the real thing.
    await P.deleteHousehold();
    expect(P.getDevice().status).toBe('unpaired');
    for (const other of [Q, R]) {
      await untilDevice(other, (d) => d.status === 'unpaired');
      expect(other.getDevice().error).toBe('This household was deleted.');
      expect(other.getState()).toBeNull();
    }
    // Try to read every former document path, as a former member and as a stranger.
    const qdb = Q.debug().db!;
    for (const db of [qdb, odb]) {
      for (const path of before) await gone(db, path);
      await gone(db, PATHS.session(hid));
      await gone(db, PATHS.invite(outstanding));
      // The household document itself reads as missing, not merely forbidden: it really is gone.
      expect((await getDoc(doc(db, PATHS.household(hid)))).exists()).toBe(false);
      for (const c of [PATHS.data(hid), PATHS.seenColl(hid), PATHS.months(hid), PATHS.sessions(hid)]) await denied(getDocs(collection(db, c)));
    }
  });
});
