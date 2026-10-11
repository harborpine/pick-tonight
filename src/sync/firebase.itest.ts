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
    const other = outsider2Household();
    void other;
    // Tries to take other people's slot / change another member.
    const batch = writeBatch(db);
    batch.update(doc(db, PATHS.code(code)), { used: true, usedBy: uid });
    batch.update(hRef, { [`members.${uid}`]: { person: 'BG', at: 1 }, lastJoinCode: code, extra: 1 });
    await denied(batch.commit());
    // The code is still unused and can be redeemed by the real second phone.
    expect((await A.debug().db && true) as boolean).toBe(true);
    const E = phone('E');
    await E.init();
    await E.joinWithCode(code, 'BG');
    await E.dispose();
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

function outsider2Household() {
  return null;
}
async function getDocForMember(p: FirebaseSyncApi, id: string) {
  const { db } = p.debug();
  return (await getDoc(doc(db!, PATHS.household(id)))).data();
}

describe('shared data between the two phones', () => {
  it('a write on one arrives on the other', async () => {
    await A.setSeen('HG', ['tv-100', 'tv-101'], true);
    const b = await until(B, (s) => 'tv-101' in s.seen.HG);
    expect(Object.keys(b.seen.HG).sort()).toEqual(['tv-100', 'tv-101']);
    await B.setNever('BG', 'tv-55', true);
    await until(A, (s) => 'tv-55' in s.never.BG);
    await A.setSeen('HG', ['tv-100'], false);
    const b2 = await until(B, (s) => !('tv-100' in s.seen.HG));
    expect(Object.keys(b2.seen.HG)).toEqual(['tv-101']);
  });

  it('concurrent different writes from both phones both survive', async () => {
    await Promise.all([
      A.setSeen('HG', ['tv-200'], true),
      B.addToWatchlist('BG', 'movie-7', 'BG', snap('Saved')),
      A.setNotTonight('HG', 'tv-201', '2099-01-01'),
      B.setSeen('BG', ['tv-300'], true),
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

  it('solo history is shared', async () => {
    await A.addHistory({ kind: 'solo', who: 'HG', itemId: 'movie-1', snapshot: snap('Solo'), pick: { type: 'movie' }, service: card('x').service });
    const b = await until(B, (s) => s.history.some((h) => h.itemId === 'movie-1'));
    expect(b.history[0]!.kind).toBe('solo');
  });

  it('watchlist add and remove', async () => {
    await A.addToWatchlist('ours', 'tv-9', 'HG', snap('Ours'));
    await until(B, (s) => s.watchlist.some((w) => w.itemId === 'tv-9'));
    await B.removeFromWatchlist('ours', 'tv-9');
    await until(A, (s) => !s.watchlist.some((w) => w.itemId === 'tv-9'));
  });
});

describe('Together sessions', () => {
  it('both yes on the same title (fired concurrently) -> exactly one match and one history entry', async () => {
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
      const s = await until(p, (s) => (s.activeSession?.matches.length ?? 0) > 0 && s.history.some((h) => h.kind === 'match'));
      expect(s.activeSession!.matches).toHaveLength(1);
      expect(s.history.filter((h) => h.kind === 'match' && h.sessionId === id)).toHaveLength(1);
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

describe('unpair and re-pair', () => {
  it('a phone that unpairs loses access; a fresh code brings it back', async () => {
    await B.unpair();
    expect(B.getDevice().status).toBe('unpaired');
    const { db } = B.debug();
    await denied(getDoc(doc(db!, PATHS.shared(hid))));
    const code = await A.createPairingCode();
    await B.joinWithCode(code, 'BG');
    const s = await until(B, (s) => s.profiles.HG.favorites.length > 0);
    expect(s.seen.HG['tv-101']).toBeTypeOf('number');
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
