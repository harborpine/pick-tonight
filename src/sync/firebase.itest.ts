/**
 * Integration suite against the REAL Firebase project (npm run test:sync).
 * Three separate Firebase app instances act as phone A, phone B and an outsider.
 * Every run creates its own household and deletes it afterwards.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  deleteField,
  serverTimestamp,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  memoryLocalCache,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import webConfig from '../../firebase.web-config.json';
import type { SharedState } from '../contracts';
import { createFirebaseSync, type FirebaseSyncApi } from './firebase';
import { card, request, seed, snap } from './fixtures';
import { PATHS } from './layout';
import { shardOf } from './seen';

const run = Math.random().toString(36).slice(2, 8);
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const phone = (name: string) => createFirebaseSync({ appName: `${name}-${run}`, persistence: false, storage: mem() });

async function until(sync: FirebaseSyncApi, pred: (s: SharedState) => boolean, ms = 20000): Promise<SharedState> {
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

async function outsider(): Promise<{ db: Firestore; uid: string }> {
  const app = initializeApp(webConfig, `outsider-${run}-${Math.random().toString(36).slice(2, 6)}`);
  const cred = await signInAnonymously(getAuth(app));
  return { db: initializeFirestore(app, { localCache: memoryLocalCache(), experimentalAutoDetectLongPolling: true }), uid: cred.user.uid };
}
const denied = async (p: Promise<unknown>) => {
  await expect(p).rejects.toMatchObject({ code: expect.stringContaining('permission-denied') });
};

const w = (itemId: string, extra: Record<string, unknown> = {}) => ({ itemId, source: 'manual' as const, snapshot: snap(itemId), ...extra });

let A: FirebaseSyncApi;
let B: FirebaseSyncApi;
let hid: string;

beforeAll(async () => {
  A = phone('A');
  B = phone('B');
  await A.init();
  await B.init();
  expect(A.getDevice().status).toBe('unpaired');
});

afterAll(async () => {
  try {
    await A.flush();
    await A.destroyHousehold();
  } catch (e) {
    console.warn('cleanup failed', e);
  }
  await A.dispose();
  await B.dispose();
});

describe('pairing', () => {
  it('create household -> code -> second phone joins -> both see the same state', async () => {
    await A.createHousehold('HG', seed());
    expect(A.getDevice()).toMatchObject({ status: 'paired', person: 'HG' });
    hid = A.debug().hid!;
    const code = await A.createPairingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await B.joinWithCode(code.toLowerCase(), 'BG');
    expect(B.getDevice()).toMatchObject({ status: 'paired', person: 'BG' });

    const a = await until(A, (s) => s.profiles.HG.favorites.length > 0);
    const b = await until(B, (s) => s.profiles.HG.favorites.length > 0);
    expect(b.profiles).toEqual(a.profiles);
    expect(b.settings).toEqual(a.settings);
    expect(b.profiles.BG.dealbreakers.horror).toBe(true);
  });

  it('wrong code, malformed code, same person as the code maker are refused in plain language', async () => {
    const O = phone('O');
    await O.init();
    await expect(O.joinWithCode('ABCDEF', 'BG')).rejects.toThrow(/isn't right/);
    await expect(O.joinWithCode('12', 'BG')).rejects.toThrow(/isn't right/);
    const code = await A.createPairingCode();
    await expect(O.joinWithCode(code, 'HG')).rejects.toThrow(/should be BG/);
    await O.dispose();
  });
});

describe('outsiders cannot touch the household', () => {
  it('cannot read or write household data, or list anything', async () => {
    const { db } = await outsider();
    await denied(getDoc(doc(db, PATHS.household(hid))));
    await denied(getDoc(doc(db, PATHS.shared(hid))));
    await denied(getDoc(doc(db, PATHS.seen(hid, 'HG'))));
    await denied(getDoc(doc(db, PATHS.seenShard(hid, 'HG_0'))));
    await denied(getDocs(collection(db, PATHS.seenDetails(hid))));
    await denied(setDoc(doc(db, PATHS.seenShard(hid, 'HG_0')), { e: { 'tv-1': 'x' } }));
    await denied(updateDoc(doc(db, PATHS.seen(hid, 'HG')), { 'm.tv-666': 1 }));
    await denied(getDocs(collection(db, PATHS.months(hid))));
    await denied(getDocs(collection(db, PATHS.sessions(hid))));
    await denied(setDoc(doc(db, PATHS.shared(hid)), { settings: { evil: true } }));
    await denied(updateDoc(doc(db, PATHS.shared(hid)), { never: {} }));
    await denied(setDoc(doc(db, PATHS.session(hid, 'x')), { status: 'open' }));
    // Cannot enumerate households or codes.
    await denied(getDocs(collection(db, 'households')));
    await denied(getDocs(collection(db, 'pairingCodes')));
  });

  it('cannot add itself to the household without a code, or with a code it did not redeem', async () => {
    const { db, uid } = await outsider();
    const hRef = doc(db, PATHS.household(hid));
    await denied(updateDoc(hRef, { [`members.${uid}`]: { person: 'BG', at: 1 } }));

    const code = await A.createPairingCode();
    // Claims the code but does not mark it used.
    await denied(updateDoc(hRef, { [`members.${uid}`]: { person: 'BG', at: 1 }, lastJoinCode: code }));
    // Marks the code used but claims a different household: the code belongs to ours.
    // Tries to take other people's slot / change another member.
    const batch = writeBatch(db);
    batch.update(doc(db, PATHS.code(code)), { used: true, usedBy: uid });
    batch.update(hRef, { [`members.${uid}`]: { person: 'BG', at: 1 }, lastJoinCode: code, extra: 1 });
    await denied(batch.commit());
    // The code is still unused (A can read it; nothing was redeemed).
    const stillThere = await getDoc(doc(A.debug().db!, PATHS.code(code)));
    expect(stillThere.data()?.used).toBe(false);
  });

  it('cannot create, list or tamper with pairing codes for our household', async () => {
    const { db, uid } = await outsider();
    await denied(
      setDoc(doc(db, PATHS.code('QQQQQQ')), { hid, person: 'BG', createdBy: uid, used: false, createdAt: new Date() }),
    );
    const code = await A.createPairingCode();
    await denied(updateDoc(doc(db, PATHS.code(code)), { used: true, usedBy: uid }));
    await denied(setDoc(doc(db, PATHS.code(code)), { hid, person: 'BG', used: false }));
  });

  it('cannot remove members or delete the household', async () => {
    const { db } = await outsider();
    const members = Object.keys(
      ((await getDocForMember(A, hid)) as { members: Record<string, unknown> }).members,
    );
    await denied(updateDoc(doc(db, PATHS.household(hid)), { [`members.${members[0]}`]: deleteField() }));
    const { deleteDoc } = await import('firebase/firestore');
    await denied(deleteDoc(doc(db, PATHS.household(hid))));
  });

  it('can create its own separate household without affecting ours', async () => {
    const O = phone('Own');
    await O.init();
    await O.createHousehold('BG', seed());
    expect(O.debug().hid).not.toBe(hid);
    await O.flush();
    await O.destroyHousehold();
    await O.dispose();
  });
});

async function getDocForMember(p: FirebaseSyncApi, id: string) {
  const { db } = p.debug();
  return (await getDoc(doc(db!, PATHS.household(id)))).data();
}

describe('shared data between the two phones', () => {
  it('a write on one arrives on the other', async () => {
    await A.markWatched('HG', [w('tv-100'), w('tv-101', { source: 'import', plays: 2 })]);
    const b = await until(B, (s) => 'tv-101' in s.seen.HG);
    expect(Object.keys(b.seen.HG).sort()).toEqual(['tv-100', 'tv-101']);
    expect(b.seen.HG['tv-101']).toMatchObject({ source: 'import', plays: 2, snapshot: snap('tv-101') });
    await B.setNever('BG', 'tv-55', true);
    await until(A, (s) => 'tv-55' in s.never.BG);
    await A.unmarkWatched('HG', ['tv-100']);
    const b2 = await until(B, (s) => !('tv-100' in s.seen.HG));
    expect(Object.keys(b2.seen.HG)).toEqual(['tv-101']);
  });

  it('concurrent different writes from both phones both survive', async () => {
    await Promise.all([
      A.markWatched('HG', [w('tv-200')]),
      B.addToWatchlist('BG', 'movie-7', 'BG', snap('Saved')),
      A.setNotTonight('HG', 'tv-201', '2099-01-01'),
      B.markWatched('BG', [w('tv-300')]),
      A.saveSettings({ plans: { ...seed().settings.plans, hulu: null } }),
      B.setNever('BG', 'tv-301', true),
    ]);
    await Promise.all([A.flush(), B.flush()]);
    for (const p of [A, B]) {
      const s = await until(p, (s) => 'tv-200' in s.seen.HG && s.watchlist.length === 1 && 'tv-300' in s.seen.BG && 'tv-301' in s.never.BG && s.settings.plans.hulu === null);
      expect(s.notTonight.HG['tv-201']).toBe('2099-01-01');
      expect(s.watchlist[0]).toMatchObject({ itemId: 'movie-7', list: 'BG' });
    }
  });

  it('solo picks are shared, de-duplicated and removable', async () => {
    const e = { kind: 'solo' as const, who: 'HG' as const, itemId: 'movie-1', snapshot: snap('Solo'), pick: { type: 'movie' as const }, service: card('x').service };
    await A.addPick(e);
    const b = await until(B, (s) => s.picks.some((h) => h.itemId === 'movie-1'));
    expect(b.picks[0]!.kind).toBe('solo');
    await B.addPick(e); // same title, same person: does nothing
    await A.addPick({ ...e, itemId: 'movie-2' });
    const b2 = await until(B, (s) => s.picks.some((h) => h.itemId === 'movie-2'));
    expect(b2.picks.filter((h) => h.itemId === 'movie-1')).toHaveLength(1);
    // Removing on one phone removes it on the other.
    await B.removePick(b2.picks.find((h) => h.itemId === 'movie-1')!.id);
    const a = await until(A, (s) => !s.picks.some((h) => h.itemId === 'movie-1'));
    expect(a.picks.some((h) => h.itemId === 'movie-2')).toBe(true);
    // And it can be picked again afterwards.
    await A.addPick(e);
    await until(B, (s) => s.picks.some((h) => h.itemId === 'movie-1'));
  });

  it('markWatched with 3,000 titles (an import) reaches the other phone complete, in one call', async () => {
    const entries = Array.from({ length: 3000 }, (_, i) => w(`imp-${i}`, { source: 'import', at: 1_000_000 + i, plays: (i % 7) + 1 }));
    await A.markWatched('BG', entries);
    await A.flush();
    const b = await until(B, (s) => Object.keys(s.seen.BG).filter((k) => k.startsWith('imp-')).length === 3000, 60000);
    expect(b.seen.BG['imp-2999']).toMatchObject({ at: 1_000_000 + 2999, source: 'import', plays: (2999 % 7) + 1, snapshot: snap('imp-2999') });
    expect(b.seen.BG['imp-0']).toMatchObject({ at: 1_000_000, plays: 1 });
    // Re-running the same import is safe: nothing doubles or changes.
    await A.markWatched('BG', entries);
    await A.flush();
    expect(Object.keys(A.getState()!.seen.BG).filter((k) => k.startsWith('imp-'))).toHaveLength(3000);
    // Un-marking a thousand of them from the other phone.
    await B.unmarkWatched('BG', entries.slice(0, 1000).map((x) => x.itemId));
    await B.flush();
    const a = await until(A, (s) => Object.keys(s.seen.BG).filter((k) => k.startsWith('imp-')).length === 2000, 60000);
    expect('imp-0' in a.seen.BG).toBe(false);
    expect('imp-1000' in a.seen.BG).toBe(true);
    // Tidy so the next checks see a small list.
    await A.unmarkWatched('BG', entries.slice(1000).map((x) => x.itemId));
    await A.flush();
  }, 120000);

  it('a refused part of a big import rejects in plain words and leaves the earlier part saved; re-running is safe', async () => {
    // 1,000 ordinary titles, then 1,000 whose details all land in ONE shard and together exceed Firestore's 1 MiB document limit.
    const fine = Array.from({ length: 1000 }, (_, i) => w(`ok-${i}`));
    const sameShard: string[] = [];
    for (let i = 0; sameShard.length < 1000; i++) if (shardOf(`big-${i}`) === 0) sameShard.push(`big-${i}`);
    const huge = sameShard.map((id) => w(id, { snapshot: { title: 'x'.repeat(2000), year: 2000, poster: null } }));
    let err: unknown;
    try {
      await A.markWatched('HG', [...fine, ...huge]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/1000 of 2000 titles were saved/);
    expect((err as Error).message).not.toMatch(/Firebase|invalid-argument/i);
    await A.flush();
    const b = await until(B, (s) => 'ok-999' in s.seen.HG, 30000);
    expect(Object.keys(b.seen.HG).some((k) => k.startsWith('big-'))).toBe(false);
    // Re-running with sensible data finishes the job.
    const again = [...fine, ...sameShard.map((id) => w(id))];
    await A.markWatched('HG', again);
    await A.flush();
    await until(B, (s) => Object.keys(s.seen.HG).filter((k) => k.startsWith('big-')).length === 1000, 30000);
    await A.unmarkWatched('HG', again.map((x) => x.itemId));
    await A.flush();
  }, 120000);

  it('watchlist add and remove', async () => {
    await A.addToWatchlist('ours', 'tv-9', 'HG', snap('Ours'));
    await until(B, (s) => s.watchlist.some((w) => w.itemId === 'tv-9'));
    await B.removeFromWatchlist('ours', 'tv-9');
    await until(A, (s) => !s.watchlist.some((w) => w.itemId === 'tv-9'));
  });
});

describe('Together sessions', () => {
  it('both yes on the same title (fired concurrently) -> exactly one match and one pick', async () => {
    const id = await A.startSession('HG', request, [card('tv-1'), card('tv-2'), card('tv-3')]);
    const seenByB = await until(B, (s) => s.activeSession?.id === id);
    expect(seenByB.activeSession!.joined).toEqual(['HG']);
    await B.joinSession(id, 'BG');
    await until(A, (s) => s.activeSession?.joined.includes('BG') === true);

    const results = await Promise.all([
      A.swipeInSession(id, 'HG', 'tv-1', true, snap('One')),
      B.swipeInSession(id, 'BG', 'tv-1', true, snap('One')),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    for (const p of [A, B]) {
      const s = await until(p, (s) => (s.activeSession?.matches.length ?? 0) > 0 && s.picks.some((h) => h.kind === 'match'));
      expect(s.activeSession!.matches).toHaveLength(1);
      expect(s.picks.filter((h) => h.kind === 'match' && h.sessionId === id)).toHaveLength(1);
    }
    // Swiping again never duplicates.
    expect(await A.swipeInSession(id, 'HG', 'tv-1', true, snap('One'))).toBe(false);
    expect(await B.swipeInSession(id, 'BG', 'tv-1', true, snap('One'))).toBe(false);
  });

  it('sequential yes-then-yes matches once; pass does not match; deck append dedupes; end clears', async () => {
    const id = await A.startSession('HG', request, [card('tv-1'), card('tv-2')]);
    await until(B, (s) => s.activeSession?.id === id);
    await B.joinSession(id, 'BG');
    expect(await A.swipeInSession(id, 'HG', 'tv-2', true, snap('Two'))).toBe(false);
    expect(await B.swipeInSession(id, 'BG', 'tv-1', false, snap())).toBe(false);
    expect(await B.swipeInSession(id, 'BG', 'tv-2', true, snap('Two'))).toBe(true);
    await B.appendSessionDeck(id, [card('tv-2'), card('tv-4')]);
    const a = await until(A, (s) => s.activeSession?.deck.length === 3);
    expect(a.activeSession!.deck.map((c) => c.itemId)).toEqual(['tv-1', 'tv-2', 'tv-4']);
    expect(a.activeSession!.passed.BG).toContain('tv-1');
    await A.endSession(id);
    await until(B, (s) => s.activeSession === null);
  });

  it('starting a new session replaces the open one', async () => {
    const one = await A.startSession('HG', request, [card('tv-1')]);
    await until(B, (s) => s.activeSession?.id === one);
    const two = await B.startSession('BG', request, [card('tv-2')]);
    await until(A, (s) => s.activeSession?.id === two);
    await A.endSession(two);
    await until(B, (s) => s.activeSession === null);
  });
});

describe('one-time codes, unpair and re-pair (these replace phone B, so they run last)', () => {
  it('a code works exactly once', async () => {
    const code = await A.createPairingCode();
    const C = phone('C');
    await C.init();
    await C.joinWithCode(code, 'BG');
    const D = phone('D');
    await D.init();
    await expect(D.joinWithCode(code, 'BG')).rejects.toThrow(/code/i);
    expect(D.getDevice().status).toBe('unpaired');
    await C.dispose();
    await D.dispose();
  });

  it('a phone that unpairs loses access; a fresh code brings it back', async () => {
    await B.unpair();
    expect(B.getDevice().status).toBe('unpaired');
    const { db } = B.debug();
    await denied(getDoc(doc(db!, PATHS.shared(hid))));
    const code = await A.createPairingCode();
    await B.joinWithCode(code, 'BG');
    const s = await until(B, (s) => s.profiles.HG.favorites.length > 0);
    expect(s.seen.HG['tv-101']!.at).toBeTypeOf('number');
  });

  it('restores the saved pairing on init()', async () => {
    const storage = mem();
    const P = createFirebaseSync({ appName: `P-${run}`, persistence: false, storage });
    await P.init();
    const code = await A.createPairingCode();
    await P.joinWithCode(code, 'BG');
    await until(P, (s) => s.profiles.HG.favorites.length > 0);
    await P.dispose();
    // Same storage, same app instance (same sign-in): a restart finds its way back.
    const P2 = createFirebaseSync({ appName: `P-${run}`, persistence: false, storage });
    await P2.init();
    expect(P2.getDevice()).toMatchObject({ status: 'paired', person: 'BG' });
    await until(P2, (s) => s.profiles.HG.favorites.length > 0);
    await P2.dispose();
  });
});

describe('a household written by the FIRST app version (old layout) keeps working', () => {
  const oldPick = (id: string, at: number, itemId: string) => ({
    id, at, kind: 'solo', who: 'HG', itemId, snapshot: snap(itemId), pick: { type: 'movie' }, service: card('x').service,
  });
  it('is read with nothing lost; new writes keep the legacy numbers numeric; old-style writes are understood', async () => {
    // Build the household by hand, exactly as the previous version stored it.
    const appName = `old-${run}`;
    const app = initializeApp(webConfig, appName);
    const uid = (await signInAnonymously(getAuth(app))).user.uid;
    const db = initializeFirestore(app, { localCache: memoryLocalCache(), experimentalAutoDetectLongPolling: true });
    const oldHid = doc(collection(db, 'households')).id;
    await setDoc(doc(db, PATHS.household(oldHid)), { createdAt: serverTimestamp(), members: { [uid]: { person: 'HG', at: 1 } } });
    await setDoc(doc(db, PATHS.shared(oldHid)), {
      profiles: seed().profiles,
      settings: seed().settings,
      never: { HG: { 'tv-50': 5 }, BG: {} },
      notTonight: { HG: {}, BG: {} },
      watchlist: { 'ours__tv-60': { itemId: 'tv-60', list: 'ours', addedBy: 'HG', at: 9, snapshot: snap('Saved') } },
    });
    await setDoc(doc(db, PATHS.seen(oldHid, 'HG')), { m: { 'tv-1': 111, 'tv-2': 222 } });
    await setDoc(doc(db, PATHS.seen(oldHid, 'BG')), { m: { 'tv-3': 333 } });
    // History month documents: one far older than the old 12-month window, one recent.
    await setDoc(doc(db, PATHS.month(oldHid, '2024-02')), {
      entries: { 'old-a': oldPick('old-a', Date.UTC(2024, 1, 3), 'tv-70'), 'old-b': oldPick('old-b', Date.UTC(2024, 1, 4), 'tv-71') },
    });
    await setDoc(doc(db, PATHS.month(oldHid, '2026-10')), { entries: { 'new-a': oldPick('new-a', Date.UTC(2026, 9, 5), 'tv-72') } });

    const storage = mem();
    storage.setItem(`wtw.sync.pairing.v1:${appName}`, JSON.stringify({ hid: oldHid, person: 'HG', uid }));
    const Z = createFirebaseSync({ appName, persistence: false, storage });
    await Z.init();
    try {
      const s = await until(Z, (s) => s.picks.length === 3 && 'tv-3' in s.seen.BG);
      expect(s.seen.HG).toEqual({ 'tv-1': { at: 111, source: 'manual' }, 'tv-2': { at: 222, source: 'manual' } });
      expect(s.seen.BG).toEqual({ 'tv-3': { at: 333, source: 'manual' } });
      expect(s.picks.map((p) => p.id)).toEqual(['new-a', 'old-b', 'old-a']); // the 2024 entries are NOT cut off
      expect(s.never.HG['tv-50']).toBe(5);
      expect(s.watchlist.map((x) => x.itemId)).toEqual(['tv-60']);
      expect(s.profiles.BG.dealbreakers.horror).toBe(true);

      // New code writes: mark one old title again (with details) and one new title.
      await Z.markWatched('HG', [w('tv-2', { source: 'import', plays: 5, at: 900 }), w('tv-4', { at: 444 })]);
      await Z.flush();
      const s2 = await until(Z, (s) => s.seen.HG['tv-2']?.source === 'import');
      expect(s2.seen.HG['tv-1']).toEqual({ at: 111, source: 'manual' }); // untouched, still readable
      expect(s2.seen.HG['tv-2']).toMatchObject({ at: 900, plays: 5, snapshot: snap('tv-2') });

      // An OLD-shape reader reads data/seen_HG.m and expects plain numbers: they must still be numbers.
      const raw = (await getDoc(doc(db, PATHS.seen(oldHid, 'HG')))).data()!;
      expect(Object.keys(raw)).toEqual(['m']); // nothing else added to the document the old app reads
      expect(raw.m).toEqual({ 'tv-1': 111, 'tv-2': 900, 'tv-4': 444 });
      for (const v of Object.values(raw.m as Record<string, unknown>)) expect(typeof v).toBe('number');
      // Old-shape month documents are untouched.
      expect((await getDoc(doc(db, PATHS.month(oldHid, '2024-02')))).data()).toEqual({
        entries: { 'old-a': oldPick('old-a', Date.UTC(2024, 1, 3), 'tv-70'), 'old-b': oldPick('old-b', Date.UTC(2024, 1, 4), 'tv-71') },
      });

      // The OLD app marks a title (number only) and un-marks another: the new code follows.
      await updateDoc(doc(db, PATHS.seen(oldHid, 'HG')), { 'm.tv-9': 999, 'm.tv-4': deleteField() });
      const s3 = await until(Z, (s) => 'tv-9' in s.seen.HG && !('tv-4' in s.seen.HG));
      expect(s3.seen.HG['tv-9']).toEqual({ at: 999, source: 'manual' });
      // The OLD app re-marks tv-2 later: its newer time wins, details are kept.
      await updateDoc(doc(db, PATHS.seen(oldHid, 'HG')), { 'm.tv-2': 5000 });
      const s4 = await until(Z, (s) => s.seen.HG['tv-2']?.at === 5000);
      expect(s4.seen.HG['tv-2']).toMatchObject({ source: 'import', plays: 5 });

      // removePick works on an entry stored in an old month.
      await Z.removePick('old-a');
      await Z.flush();
      const s5 = await until(Z, (s) => s.picks.length === 2);
      expect(s5.picks.map((p) => p.id)).toEqual(['new-a', 'old-b']);
      expect(Object.keys((await getDoc(doc(db, PATHS.month(oldHid, '2024-02')))).data()!.entries)).toEqual(['old-b']);

      // A new pick lands in the same old-shape month document the old app reads, with exactly the old fields.
      await Z.addPick({ kind: 'solo', who: 'BG', itemId: 'tv-80', snapshot: snap('N'), pick: { type: 'movie' }, service: card('x').service });
      await Z.flush();
      const thisMonth = new Date().toISOString().slice(0, 7);
      const entries = (await getDoc(doc(db, PATHS.month(oldHid, thisMonth)))).data()!.entries as Record<string, Record<string, unknown>>;
      const fresh = Object.values(entries).find((e) => e.itemId === 'tv-80')!;
      expect(Object.keys(fresh).sort()).toEqual(['at', 'id', 'itemId', 'kind', 'pick', 'service', 'snapshot', 'who']);

      // Details live in separate shard documents the old app never reads.
      expect((await getDocs(collection(db, PATHS.seenDetails(oldHid)))).size).toBeGreaterThan(0);
      await Z.destroyHousehold();
    } finally {
      await Z.dispose();
    }
  }, 120000);
});
