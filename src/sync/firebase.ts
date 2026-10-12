/**
 * SyncApi on Firebase (Firestore + anonymous sign-in). Layout and rules: see README.md.
 * Importing this module has no side effects; Firebase starts in init().
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, signOut, type Auth } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  waitForPendingWrites,
  writeBatch,
  type Firestore,
  type Timestamp,
  type WriteBatch,
} from 'firebase/firestore';
import webConfig from '../../firebase.web-config.json';
import {
  MAX_MEMBERS,
  type DeckCard,
  type DeviceState,
  type InvitePreview,
  type JoinAs,
  type MemberId,
  type NewProfile,
  type PickEntry,
  type Profile,
  type Settings,
  type SharedState,
  type SuggestRequest,
  type SyncApi,
  type TitleSnapshot,
  type TogetherSession,
  type Unsubscribe,
  type WatchlistEntry,
  type WatchlistOwner,
} from '../contracts';
import { assembleState, freshParts, type RawParts } from './assemble';
import { friendlyError, MSG, SyncError, withTimeout } from './errors';
import {
  INVITE_TTL_MS,
  MAX_DECK_CARDS,
  MAX_MEMBER_NUMBER,
  monthOf,
  nameKey,
  PATHS,
  seenDocId,
  type HouseholdDoc,
  type InviteDoc,
  type MemberDoc,
  type MonthDoc,
  type SeenShardDoc,
  type SharedDoc,
} from './layout';
import { decideSwipe, normalizeSession, soloPickId } from './match';
import { checkCode, generateCode, isValidCodeShape, nameProblem, nameTaken, normalizeCode, tidyName } from './pairing';
import { chunk, encodeSeen, mergeSeenInputs, SEEN_CHUNK, SEEN_MAX, SEEN_SHARDS, shardOf } from './seen';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface FirebaseSyncOptions {
  /** Name of the Firebase app instance (tests use one per simulated phone). */
  appName?: string;
  /** Use the on-device offline cache. Default: yes when the browser has IndexedDB. */
  persistence?: boolean;
  /** Where the saved pairing is kept. Default: localStorage (or memory when unavailable). */
  storage?: KeyValueStore;
  /** Tests only: make deleteHousehold() stop (with an error) just before it removes the household document itself. */
  testStopBeforeFinalDelete?: boolean;
}

/** The SyncApi plus a few extras used by tests. Not part of the contract. */
export interface FirebaseSyncApi extends SyncApi {
  /** Resolves when every queued write has reached the server. */
  flush(): Promise<void>;
  /** Stop listeners and timers (tests). */
  dispose(): Promise<void>;
  /** Identity details for tests. */
  debug(): { hid: string | null; memberId: string | null; uid: string | null; db: Firestore | null };
}

interface Saved {
  hid: string;
  memberId: MemberId;
  uid: string;
}

/** Every browser-storage key this app uses starts with `pt.` (the private app shares our origin). */
export const STORE_KEY = 'pt.sync.pairing.v1';
/** Name of the Firebase app instance (also names Firestore's on-device database and the sign-in storage). */
export const DEFAULT_APP_NAME = 'pt';
const ONLINE_MS = 15000;
/** How long a big watched-list write waits for the server before treating the phone as offline. */
const SEEN_CONFIRM_MS = 8000;
const EMIT_DELAY_MS = 25;
/** Deletes per batch (keeps each request well inside the rules' document-access limits). */
const DELETE_BATCH = 10;
const LISTENERS = 5;

function defaultStore(): KeyValueStore {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.getItem('pt.probe');
      return localStorage;
    }
  } catch {
    /* fall through */
  }
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const codeOf = (e: unknown): string => (e as { code?: string } | null)?.code ?? '';
const isDenied = (e: unknown): boolean => codeOf(e).includes('permission-denied');
const isNotFound = (e: unknown): boolean => codeOf(e).includes('not-found');
const millis = (t: unknown): number => (t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0);

export function createFirebaseSync(opts: FirebaseSyncOptions = {}): FirebaseSyncApi {
  const store = opts.storage ?? defaultStore();
  const storeKey = opts.appName ? `${STORE_KEY}:${opts.appName}` : STORE_KEY;

  let app: FirebaseApp | null = null;
  let auth: Auth | null = null;
  let db: Firestore | null = null;

  let device: DeviceState = { status: 'loading', memberId: null, error: null };
  let state: SharedState | null = null;
  const deviceSubs = new Set<(d: DeviceState) => void>();
  const stateSubs = new Set<(s: SharedState) => void>();

  let saved: Saved | null = null;
  let unsubs: Unsubscribe[] = [];
  let parts: RawParts = freshParts();
  let got = new Set<string>();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let pruning = false;
  let diagnosing = false;
  let stopOnce = !!opts.testStopBeforeFinalDelete;

  // ---------------------------------------------------------------- device ----
  const setDevice = (d: DeviceState) => {
    device = d;
    deviceSubs.forEach((cb) => cb(device));
  };
  const setError = (message: string | null) => {
    if (device.error !== message) setDevice({ ...device, error: message });
  };

  function setup(): { auth: Auth; db: Firestore } {
    if (!app) {
      app = getApps().find((a) => a.name === (opts.appName ?? DEFAULT_APP_NAME)) ?? initializeApp(webConfig, opts.appName ?? DEFAULT_APP_NAME);
      auth = getAuth(app);
      const persist = opts.persistence ?? typeof indexedDB !== 'undefined';
      try {
        db = initializeFirestore(app, {
          localCache: persist ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache(),
          ignoreUndefinedProperties: true,
          ...(typeof window !== 'undefined' ? { experimentalAutoDetectLongPolling: true } : {}),
        });
      } catch {
        db = getFirestore(app); // already initialised (e.g. dev hot reload)
      }
    }
    return { auth: auth!, db: db! };
  }

  let signingIn: Promise<string> | null = null;
  /** Resolves to this phone's anonymous uid. Concurrent callers share one sign-in. */
  function ensureUser(ms: number): Promise<string> {
    const { auth } = setup();
    if (!signingIn) {
      signingIn = (async () => {
        await auth.authStateReady();
        if (auth.currentUser) return auth.currentUser.uid;
        return (await signInAnonymously(auth)).user.uid;
      })();
      signingIn.catch(() => {
        signingIn = null; // allow a retry later
      });
    }
    return withTimeout(signingIn, ms, MSG.offline).catch((e) => {
      throw new SyncError(friendlyError(e, MSG.offline));
    });
  }

  const loadSaved = (): Saved | null => {
    try {
      const raw = store.getItem(storeKey);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<Saved>;
      return s.hid && s.memberId && s.uid ? (s as Saved) : null;
    } catch {
      return null;
    }
  };
  const persistSaved = () => {
    try {
      if (saved) store.setItem(storeKey, JSON.stringify(saved));
      else store.removeItem(storeKey);
    } catch {
      /* private mode etc. */
    }
  };

  // -------------------------------------------------------------- listeners ----
  const stopListeners = () => {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = null;
    unsubs.forEach((u) => u());
    unsubs = [];
    got = new Set();
    parts = freshParts();
  };

  /**
   * Tell subscribers about new data. One change on the server reaches us as several separate listener
   * callbacks, so wait a moment and publish once with everything that arrived.
   */
  const emit = () => {
    if (got.size < LISTENERS || emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      if (got.size < LISTENERS || !parts.household) return;
      state = assembleState(parts);
      stateSubs.forEach((cb) => cb(state!));
    }, EMIT_DELAY_MS);
  };

  /** This phone is no longer in the household (deleted, removed, taken over by another phone). */
  function lostAccess(message: string) {
    if (retryTimer) clearTimeout(retryTimer);
    stopListeners();
    state = null;
    saved = null;
    persistSaved();
    setDevice({ status: 'unpaired', memberId: null, error: message });
  }

  /** After a refusal on a listener: was the household deleted, or was this phone removed? */
  async function diagnoseLoss(hid: string) {
    if (diagnosing) return;
    diagnosing = true;
    try {
      const { db } = setup();
      const snap = await withTimeout(getDocFromServer(doc(db, PATHS.household(hid))), 10000);
      if (!snap.exists()) lostAccess(MSG.deleted);
    } catch (e) {
      if (isDenied(e)) lostAccess(MSG.removed);
      /* offline: stay as we are; the listener will be retried by the SDK or on the next start */
    } finally {
      diagnosing = false;
    }
  }

  function startListeners(hid: string) {
    const { db } = setup();
    stopListeners();
    const onErr = (e: unknown) => {
      if ((globalThis as { __PICK_DEBUG?: boolean }).__PICK_DEBUG) console.warn('[sync] listener error', e);
      if (isDenied(e)) void diagnoseLoss(hid);
      else setError(friendlyError(e));
    };
    const mark = (key: string, fromCache: boolean) => {
      got.add(key);
      if (!fromCache && (device.error === MSG.offline || device.error === MSG.quota)) setError(null);
      emit();
    };
    unsubs.push(
      onSnapshot(
        doc(db, PATHS.household(hid)),
        (snap) => {
          if (!snap.exists()) {
            // Only believe "missing" when the server said so.
            if (!snap.metadata.fromCache) lostAccess(MSG.deleted);
            return;
          }
          const h = snap.data() as HouseholdDoc;
          parts.household = h;
          mark('household', snap.metadata.fromCache);
          if (!snap.metadata.fromCache) void pruneStale(hid, h);
        },
        onErr,
      ),
    );
    unsubs.push(
      onSnapshot(
        collection(db, PATHS.data(hid)),
        (snap) => {
          let shared: SharedDoc | null = null;
          const memberDocs: Record<string, MemberDoc> = {};
          snap.forEach((d) => {
            if (d.id === 'shared') shared = d.data() as SharedDoc;
            else memberDocs[d.id] = d.data() as MemberDoc;
          });
          parts.shared = shared;
          parts.memberDocs = memberDocs;
          mark('data', snap.metadata.fromCache);
        },
        onErr,
      ),
    );
    unsubs.push(
      onSnapshot(
        collection(db, PATHS.seenColl(hid)),
        (snap) => {
          const seen: Record<string, Record<string, string>> = {};
          snap.forEach((d) => {
            const member = d.id.split('_')[0]!;
            Object.assign((seen[member] ??= {}), (d.data() as SeenShardDoc).e ?? {});
          });
          parts.seen = seen;
          mark('seen', snap.metadata.fromCache);
        },
        onErr,
      ),
    );
    // Every month document, so the Matches tab never silently drops an old pick.
    unsubs.push(
      onSnapshot(
        collection(db, PATHS.months(hid)),
        (snap) => {
          const months: Record<string, MonthDoc> = {};
          snap.forEach((d) => {
            months[d.id] = d.data() as MonthDoc;
          });
          parts.months = months;
          mark('months', snap.metadata.fromCache);
        },
        onErr,
      ),
    );
    unsubs.push(
      onSnapshot(
        collection(db, PATHS.sessions(hid)),
        (snap) => {
          const d = snap.docs[0];
          parts.session = d ? (d.data() as TogetherSession) : null;
          mark('session', snap.metadata.fromCache);
        },
        onErr,
      ),
    );
  }

  /** Drop phone entries that no longer own their member (a displaced old phone). Best effort. */
  async function pruneStale(hid: string, h: HouseholdDoc) {
    if (pruning) return;
    const stale = Object.keys(h.uids ?? {}).filter((k) => h.owners?.[h.uids[k]!] !== k);
    if (stale.length === 0) return;
    pruning = true;
    try {
      const { db } = setup();
      const args: unknown[] = [];
      for (const k of stale) args.push(new FieldPath('uids', k), deleteField());
      const [f, v, ...rest] = args as [FieldPath, unknown, ...unknown[]];
      await updateDoc(doc(db, PATHS.household(hid)), f, v, ...rest);
    } catch {
      /* try again on the next snapshot */
    } finally {
      pruning = false;
    }
  }

  /** Sign in (retrying while offline) and start listening for a saved pairing. */
  async function attach(): Promise<void> {
    if (disposed || !saved) return;
    try {
      const uid = await ensureUser(8000);
      if (disposed || !saved) return;
      if (uid !== saved.uid) {
        // The phone got a new identity (iOS wiped its storage): it must join again.
        lostAccess(MSG.removed);
        return;
      }
      startListeners(saved.hid);
    } catch {
      if (disposed) return;
      retryTimer = setTimeout(() => void attach(), 10000);
    }
  }

  const requirePaired = (): { hid: string; memberId: MemberId; uid: string; db: Firestore } => {
    if (!saved || device.status !== 'paired') throw new SyncError(MSG.notPaired);
    return { hid: saved.hid, memberId: saved.memberId, uid: saved.uid, db: setup().db };
  };
  const requireMemberLocal = (m: MemberId) => {
    if (state && !state.members[m]) throw new SyncError(MSG.memberGone);
  };

  /** Fire a write in the background; it resolves locally at once and reports problems in device.error. */
  const send = (p: Promise<unknown>): Promise<void> => {
    p.catch((e) => setError(friendlyError(e)));
    return Promise.resolve();
  };

  /** Replace ONE whole field of a document (creating the document if it does not exist yet). */
  const replaceField = (path: string, field: string, value: unknown): Promise<void> => {
    const { db } = setup();
    const ref = doc(db, path);
    return updateDoc(ref, field, value).catch((e) => {
      if (isNotFound(e)) return setDoc(ref, { [field]: value }, { merge: true });
      throw e;
    });
  };

  /**
   * Write a (possibly large) set of watched-title changes in chunks of SEEN_CHUNK titles, each chunk one
   * atomic batch. Small calls behave like every other edit (resolve at once, sync in the background).
   * Large calls wait for the server so a refusal can be reported: the promise rejects with a plain sentence
   * and says how many titles were saved. Re-running is always safe (same values are simply written again).
   * Offline, the first chunk cannot be confirmed within a few seconds, so everything is queued on the phone
   * (the app already shows the change) and uploads by itself when the connection returns.
   */
  async function writeSeen(ids: string[], fill: (batch: WriteBatch, part: string[]) => void, db: Firestore): Promise<void> {
    const pieces = chunk(ids, SEEN_CHUNK);
    const build = (part: string[]): Promise<void> => {
      const batch = writeBatch(db);
      fill(batch, part);
      return batch.commit();
    };
    if (ids.length <= 25) return send(build(ids));
    let done = 0;
    let queued = false;
    for (const part of pieces) {
      const p = build(part);
      if (queued) {
        p.catch((e) => setError(friendlyError(e)));
        done += part.length;
        continue;
      }
      try {
        const r = await Promise.race([p.then(() => 'ok' as const), new Promise<'slow'>((res) => setTimeout(() => res('slow'), SEEN_CONFIRM_MS))]);
        if (r === 'slow') {
          queued = true;
          p.catch((e) => setError(friendlyError(e)));
        }
        done += part.length;
      } catch (e) {
        const why = friendlyError(e);
        throw new SyncError(
          done > 0 ? `${why} ${done} of ${ids.length} titles were saved. Run it again to finish; nothing will be doubled.` : why,
        );
      }
    }
  }

  /** The invite preview snapshot for a household document. */
  const snapshotOf = (h: HouseholdDoc): Pick<InviteDoc, 'members' | 'full' | 'nextId'> => {
    const members = Object.entries(h.members)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
      .map(([id, m]) => ({ id, name: m.name }));
    return { members, full: members.length >= MAX_MEMBERS, nextId: h.nextId };
  };

  /** Read an invite from the server and turn the usual problems into plain sentences. */
  async function readInvite(code: string): Promise<InviteDoc> {
    const { db } = setup();
    let snap;
    try {
      snap = await withTimeout(getDocFromServer(doc(db, PATHS.invite(code))), ONLINE_MS);
    } catch (e) {
      if (isDenied(e)) throw new SyncError(MSG.badCode);
      throw e;
    }
    if (!snap.exists()) throw new SyncError(MSG.badCode);
    const inv = snap.data() as InviteDoc;
    const verdict = checkCode({ used: inv.used, expiresAtMs: millis(inv.createdAt) + INVITE_TTL_MS }, Date.now());
    if (verdict === 'used') throw new SyncError(MSG.usedCode);
    if (verdict === 'expired') throw new SyncError(MSG.expiredCode);
    return inv;
  }

  /** Change household membership in one transaction, keeping the outstanding invite's preview fresh. */
  async function changeMembers(
    hid: string,
    change: (h: HouseholdDoc) => { fields: unknown[]; next: HouseholdDoc },
  ): Promise<void> {
    const { db } = setup();
    const hRef = doc(db, PATHS.household(hid));
    await withTimeout(
      runTransaction(
        db,
        async (tx) => {
          const hs = await tx.get(hRef);
          if (!hs.exists()) throw new SyncError(MSG.deleted);
          const h = hs.data() as HouseholdDoc;
          const iRef = h.inviteCode ? doc(db, PATHS.invite(h.inviteCode)) : null;
          const is = iRef ? await tx.get(iRef) : null;
          const { fields, next } = change(h);
          const [f, v, ...rest] = fields as [FieldPath, unknown, ...unknown[]];
          tx.update(hRef, f, v, ...rest);
          if (iRef && is?.exists() && !(is.data() as InviteDoc).used) tx.update(iRef, { ...snapshotOf(next) });
        },
        { maxAttempts: 8 },
      ),
      ONLINE_MS,
      MSG.needsOnline,
    );
  }

  /** The documents that make up one member's data (everything removeMember wipes). */
  const memberDocPaths = (hid: string, m: MemberId): string[] => [
    PATHS.memberDoc(hid, m),
    ...Array.from({ length: SEEN_SHARDS }, (_, i) => PATHS.seenShard(hid, seenDocId(m, i))),
  ];

  async function deleteAll(paths: string[]): Promise<void> {
    const { db } = setup();
    for (const group of chunk(paths, DELETE_BATCH)) {
      const batch = writeBatch(db);
      for (const p of group) batch.delete(doc(db, p));
      await withTimeout(batch.commit(), ONLINE_MS, MSG.needsOnline);
    }
  }

  const memberDocWrite = (hid: string, m: MemberId, profile: Profile, db: Firestore, batch: WriteBatch) =>
    batch.set(doc(db, PATHS.memberDoc(hid, m)), { profile, never: {}, notTonight: {}, watch: {} });

  // ------------------------------------------------------------------- API ----
  const api: FirebaseSyncApi = {
    async init() {
      saved = loadSaved();
      if (!saved) {
        setDevice({ status: 'unpaired', memberId: null, error: null });
        // Warm up sign-in in the background so joining is quick later.
        void ensureUser(15000).catch(() => undefined);
        return;
      }
      setDevice({ status: 'paired', memberId: saved.memberId, error: null });
      void attach();
    },
    getDevice: () => device,
    onDevice(cb) {
      deviceSubs.add(cb);
      cb(device);
      return () => deviceSubs.delete(cb);
    },

    async createHousehold(name: string, profile: NewProfile, settings: Settings) {
      const problem = nameProblem(name);
      if (problem) throw new SyncError(problem);
      const clean = tidyName(name);
      try {
        const uid = await ensureUser(ONLINE_MS);
        const { db } = setup();
        const hRef = doc(collection(db, 'households'));
        const hid = hRef.id;
        const memberId = 'm1';
        const household = {
          createdAt: serverTimestamp(),
          nextId: 2,
          members: { [memberId]: { name: clean, joinedAt: Date.now() } },
          names: { [nameKey(clean)]: memberId },
          owners: { [memberId]: uid },
          uids: { [uid]: memberId },
        };
        await withTimeout(setDoc(hRef, household), ONLINE_MS);
        const batch = writeBatch(db);
        batch.set(doc(db, PATHS.shared(hid)), { settings, ours: {} });
        memberDocWrite(hid, memberId, { ...profile, id: memberId }, db, batch);
        try {
          await withTimeout(batch.commit(), ONLINE_MS);
        } catch (e) {
          await deleteDoc(hRef).catch(() => undefined); // do not leave an empty household behind
          throw e;
        }
        saved = { hid, memberId, uid };
        persistSaved();
        setDevice({ status: 'paired', memberId, error: null });
        startListeners(hid);
      } catch (e) {
        throw new SyncError(friendlyError(e));
      }
    },

    async createInvite() {
      const { hid, uid, db } = requirePaired();
      try {
        const hRef = doc(db, PATHS.household(hid));
        let made = '';
        await withTimeout(
          runTransaction(
            db,
            async (tx) => {
              const hs = await tx.get(hRef);
              if (!hs.exists()) throw new SyncError(MSG.deleted);
              const h = hs.data() as HouseholdDoc;
              // Read everything before writing.
              const old = h.inviteCode ? doc(db, PATHS.invite(h.inviteCode)) : null;
              const oldSnap = old ? await tx.get(old) : null;
              let code = '';
              for (let attempt = 0; attempt < 6; attempt++) {
                const c = generateCode();
                if (c === h.inviteCode) continue;
                if (!(await tx.get(doc(db, PATHS.invite(c)))).exists()) {
                  code = c;
                  break;
                }
              }
              if (!code) throw new SyncError(MSG.generic);
              if (old && oldSnap?.exists()) tx.delete(old);
              const inv: Record<string, unknown> = {
                hid,
                createdBy: uid,
                createdAt: serverTimestamp(),
                used: false,
                ...snapshotOf(h),
              };
              tx.set(doc(db, PATHS.invite(code)), inv);
              tx.update(hRef, { inviteCode: code });
              made = code;
            },
            { maxAttempts: 8 },
          ),
          ONLINE_MS,
          MSG.needsOnline,
        );
        return made;
      } catch (e) {
        throw new SyncError(friendlyError(e, MSG.needsOnline));
      }
    },

    async previewInvite(rawCode): Promise<InvitePreview> {
      const code = normalizeCode(rawCode);
      if (!isValidCodeShape(code)) throw new SyncError(MSG.badCode);
      try {
        await ensureUser(ONLINE_MS);
        const inv = await readInvite(code);
        return { members: inv.members.map((m) => ({ id: m.id, name: m.name })), full: inv.full };
      } catch (e) {
        throw new SyncError(friendlyError(e, MSG.needsOnline));
      }
    },

    async joinWithCode(rawCode, as: JoinAs) {
      const code = normalizeCode(rawCode);
      if (!isValidCodeShape(code)) throw new SyncError(MSG.badCode);
      if (!('memberId' in as)) {
        const p = nameProblem(as.name);
        if (p) throw new SyncError(p);
      }
      try {
        const uid = await ensureUser(ONLINE_MS);
        const { db } = setup();
        const inv = await readInvite(code);
        const hid = inv.hid;
        const iRef = doc(db, PATHS.invite(code));
        const hRef = doc(db, PATHS.household(hid));
        const fields: unknown[] = [];
        let memberId: MemberId;
        let profile: Profile | null = null;
        if ('memberId' in as) {
          memberId = as.memberId;
          if (!inv.members.some((m) => m.id === memberId)) throw new SyncError(MSG.memberGone);
          fields.push(new FieldPath('owners', memberId), uid, new FieldPath('uids', uid), memberId);
        } else {
          const clean = tidyName(as.name);
          if (inv.full) throw new SyncError(MSG.full);
          if (nameTaken(clean, inv.members)) throw new SyncError(MSG.nameTaken);
          if (inv.nextId > MAX_MEMBER_NUMBER) throw new SyncError(MSG.full);
          memberId = `m${inv.nextId}`;
          profile = { ...as.profile, id: memberId };
          fields.push(
            new FieldPath('members', memberId),
            { name: clean, joinedAt: Date.now() },
            new FieldPath('names', nameKey(clean)),
            memberId,
            new FieldPath('owners', memberId),
            uid,
            new FieldPath('uids', uid),
            memberId,
            'nextId',
            inv.nextId + 1,
          );
        }
        const batch = writeBatch(db);
        batch.update(iRef, { used: true, usedBy: uid, members: [] });
        const [f, v, ...rest] = fields as [FieldPath, unknown, ...unknown[]];
        batch.update(hRef, f, v, ...rest);
        try {
          await withTimeout(batch.commit(), ONLINE_MS);
        } catch (e) {
          if (isDenied(e)) {
            // Find out why: used / expired in the meantime, or just wrong.
            await readInvite(code);
            throw new SyncError(MSG.badCode);
          }
          throw e;
        }
        if (retryTimer) clearTimeout(retryTimer);
        stopListeners();
        saved = { hid, memberId, uid };
        persistSaved();
        setDevice({ status: 'paired', memberId, error: null });
        if (profile) {
          const pb = writeBatch(db);
          memberDocWrite(hid, memberId, profile, db, pb);
          try {
            await withTimeout(pb.commit(), ONLINE_MS);
          } catch (e) {
            setError(friendlyError(e));
          }
        }
        startListeners(hid);
      } catch (e) {
        throw new SyncError(friendlyError(e));
      }
    },

    async renameMember(memberId, name) {
      const { hid } = requirePaired();
      const problem = nameProblem(name);
      if (problem) throw new SyncError(problem);
      const clean = tidyName(name);
      try {
        await changeMembers(hid, (h) => {
          const cur = h.members[memberId];
          if (!cur) throw new SyncError(MSG.memberGone);
          const others = Object.entries(h.members).map(([id, m]) => ({ id, name: m.name }));
          if (nameTaken(clean, others, memberId)) throw new SyncError(MSG.nameTaken);
          const next: HouseholdDoc = {
            ...h,
            members: { ...h.members, [memberId]: { ...cur, name: clean } },
            names: { ...h.names },
          };
          delete next.names[nameKey(cur.name)];
          next.names[nameKey(clean)] = memberId;
          const fields: unknown[] = [new FieldPath('members', memberId, 'name'), clean];
          if (nameKey(cur.name) !== nameKey(clean)) fields.push(new FieldPath('names', nameKey(cur.name)), deleteField());
          fields.push(new FieldPath('names', nameKey(clean)), memberId);
          return { fields, next };
        });
      } catch (e) {
        throw new SyncError(friendlyError(e, MSG.needsOnline));
      }
    },

    async removeMember(memberId) {
      const { hid, memberId: me } = requirePaired();
      requireMemberLocal(memberId);
      if (state && Object.keys(state.members).length <= 1) return api.deleteHousehold();
      try {
        // 1) The person's data (while we are still allowed to touch it).
        const paths = memberDocPaths(hid, memberId);
        if (state?.activeSession?.request.who.includes(memberId)) paths.push(PATHS.session(hid));
        await deleteAll(paths);
        // 2) The membership itself (one transaction).
        await changeMembers(hid, (h) => {
          const cur = h.members[memberId];
          if (!cur) throw new SyncError(MSG.memberGone);
          if (Object.keys(h.members).length <= 1) throw new SyncError(MSG.generic);
          const next: HouseholdDoc = {
            ...h,
            members: { ...h.members },
            names: { ...h.names },
            owners: { ...h.owners },
            uids: { ...h.uids },
          };
          delete next.members[memberId];
          delete next.names[nameKey(cur.name)];
          delete next.owners[memberId];
          const fields: unknown[] = [
            new FieldPath('members', memberId),
            deleteField(),
            new FieldPath('names', nameKey(cur.name)),
            deleteField(),
            new FieldPath('owners', memberId),
            deleteField(),
          ];
          for (const [u, m] of Object.entries(h.uids)) {
            if (m === memberId) {
              delete next.uids[u];
              fields.push(new FieldPath('uids', u), deleteField());
            }
          }
          return { fields, next };
        });
      } catch (e) {
        throw new SyncError(friendlyError(e, MSG.needsOnline));
      }
      if (memberId === me) {
        if (retryTimer) clearTimeout(retryTimer);
        stopListeners();
        state = null;
        saved = null;
        persistSaved();
        setDevice({ status: 'unpaired', memberId: null, error: null });
      }
    },

    async unpair() {
      const current = saved;
      if (retryTimer) clearTimeout(retryTimer);
      stopListeners();
      state = null;
      saved = null;
      persistSaved();
      setDevice({ status: 'unpaired', memberId: null, error: null });
      if (current && db) {
        // Best effort: free this member for someone else to claim.
        try {
          const hRef = doc(db, PATHS.household(current.hid));
          await withTimeout(
            runTransaction(db, async (tx) => {
              const hs = await tx.get(hRef);
              if (!hs.exists()) return;
              const h = hs.data() as HouseholdDoc;
              if (h.owners?.[current.memberId] !== current.uid) return;
              tx.update(hRef, new FieldPath('owners', current.memberId), deleteField(), new FieldPath('uids', current.uid), deleteField());
            }),
            4000,
          );
        } catch {
          /* offline or already gone: nothing more to do */
        }
        // Take a fresh anonymous identity, so this phone can never reuse the old one's place.
        try {
          if (auth) await signOut(auth);
        } catch {
          /* ignore */
        }
        signingIn = null;
        void ensureUser(15000).catch(() => undefined);
      }
    },

    async deleteHousehold() {
      const { hid } = requirePaired();
      const { db } = setup();
      try {
        const hRef = doc(db, PATHS.household(hid));
        // Needs the server: refuse early (and clearly) when offline.
        const hs = await withTimeout(getDocFromServer(hRef), ONLINE_MS, MSG.needsOnline);
        if (!hs.exists()) {
          lostAccess(MSG.deleted);
          return;
        }
        const h = hs.data() as HouseholdDoc;
        stopListeners();
        // 1) Close the household to new writes, so nothing can be added while we clear it out.
        if (!h.deleting) await withTimeout(updateDoc(hRef, { deleting: true }), ONLINE_MS, MSG.needsOnline);
        // 2) Outstanding invite codes.
        if (h.inviteCode) {
          const iRef = doc(db, PATHS.invite(h.inviteCode));
          const is = await withTimeout(getDocFromServer(iRef), ONLINE_MS, MSG.needsOnline);
          if (is.exists()) await withTimeout(deleteDoc(iRef), ONLINE_MS, MSG.needsOnline);
        }
        // 3) Every document in every subcollection, until a fresh look finds nothing left.
        for (let round = 0; round < 6; round++) {
          let any = false;
          for (const coll of [PATHS.data(hid), PATHS.seenColl(hid), PATHS.months(hid), PATHS.sessions(hid)]) {
            const snap = await withTimeout(getDocsFromServer(collection(db, coll)), ONLINE_MS, MSG.needsOnline);
            if (snap.empty) continue;
            any = true;
            await deleteAll(snap.docs.map((d) => d.ref.path));
          }
          if (!any) break;
        }
        if (stopOnce) {
          stopOnce = false;
          throw new SyncError('test-stop');
        }
        // 4) The household itself, confirmed by the server.
        await withTimeout(deleteDoc(hRef), ONLINE_MS, MSG.needsOnline);
      } catch (e) {
        // Re-attach so the phone keeps showing live data if it is still a member.
        if (saved && !disposed) void attach();
        throw new SyncError(friendlyError(e, MSG.needsOnline));
      }
      if (retryTimer) clearTimeout(retryTimer);
      saved = null;
      persistSaved();
      state = null;
      setDevice({ status: 'unpaired', memberId: null, error: null });
    },

    getState: () => state,
    onState(cb) {
      stateSubs.add(cb);
      if (state) cb(state);
      return () => stateSubs.delete(cb);
    },

    // ---- mutations ----
    async markWatched(member, entries) {
      const { hid, db } = requirePaired();
      if (entries.length === 0) return;
      requireMemberLocal(member);
      const merged = mergeSeenInputs(entries, state?.seen[member] ?? {}, Date.now());
      const ids = Object.keys(merged);
      const total = new Set([...Object.keys(state?.seen[member] ?? {}), ...ids]).size;
      if (total > SEEN_MAX) {
        throw new SyncError(`That would make more than ${SEEN_MAX.toLocaleString('en-US')} watched titles for one person, which is the most this app can keep. Nothing was changed.`);
      }
      return writeSeen(
        ids,
        (batch, part) => {
          const byShard = new Map<number, Record<string, string>>();
          for (const id of part) {
            const sh = shardOf(id);
            byShard.set(sh, { ...byShard.get(sh), [id]: encodeSeen(merged[id]!) });
          }
          for (const [sh, e] of byShard) batch.set(doc(db, PATHS.seenShard(hid, seenDocId(member, sh))), { e }, { merge: true });
        },
        db,
      );
    },
    async unmarkWatched(member, itemIds) {
      const { hid, db } = requirePaired();
      const ids = [...new Set(itemIds)];
      if (ids.length === 0) return;
      requireMemberLocal(member);
      return writeSeen(
        ids,
        (batch, part) => {
          const byShard = new Map<number, Record<string, unknown>>();
          for (const id of part) {
            const sh = shardOf(id);
            byShard.set(sh, { ...byShard.get(sh), [id]: deleteField() });
          }
          for (const [sh, e] of byShard) batch.set(doc(db, PATHS.seenShard(hid, seenDocId(member, sh))), { e }, { merge: true });
        },
        db,
      );
    },
    async setNever(member, itemId, never) {
      const { hid, db } = requirePaired();
      requireMemberLocal(member);
      return send(setDoc(doc(db, PATHS.memberDoc(hid, member)), { never: { [itemId]: never ? Date.now() : deleteField() } }, { merge: true }));
    },
    async setNotTonight(member, itemId, date) {
      const { hid, db } = requirePaired();
      requireMemberLocal(member);
      const map: Record<string, unknown> = { [itemId]: date };
      // Tidy: dates in the past no longer hide anything.
      const today = todayLocal();
      for (const [id, d] of Object.entries(state?.notTonight[member] ?? {})) if (d < today && id !== itemId) map[id] = deleteField();
      return send(setDoc(doc(db, PATHS.memberDoc(hid, member)), { notTonight: map }, { merge: true }));
    },
    async addToWatchlist(list: WatchlistOwner, itemId, addedBy, snapshot: TitleSnapshot) {
      const { hid, db } = requirePaired();
      if (state?.watchlist.some((w) => w.list === list && w.itemId === itemId)) return;
      const entry: WatchlistEntry = { itemId, list, addedBy, at: Date.now(), snapshot };
      const json = JSON.stringify(entry);
      return send(
        list === 'ours'
          ? setDoc(doc(db, PATHS.shared(hid)), { ours: { [itemId]: json } }, { merge: true })
          : setDoc(doc(db, PATHS.memberDoc(hid, list)), { watch: { [itemId]: json } }, { merge: true }),
      );
    },
    async removeFromWatchlist(list, itemId) {
      const { hid, db } = requirePaired();
      return send(
        list === 'ours'
          ? setDoc(doc(db, PATHS.shared(hid)), { ours: { [itemId]: deleteField() } }, { merge: true })
          : setDoc(doc(db, PATHS.memberDoc(hid, list)), { watch: { [itemId]: deleteField() } }, { merge: true }),
      );
    },
    async addPick(entry) {
      const { hid, db } = requirePaired();
      const key = entry.who.join('+');
      if (state?.picks.some((p) => p.itemId === entry.itemId && p.who.join('+') === key)) return;
      const at = Date.now();
      const id = entry.kind === 'solo' ? soloPickId(entry.who, entry.itemId) : newId();
      const full: PickEntry = { ...entry, id, at };
      return send(setDoc(doc(db, PATHS.month(hid, monthOf(at))), { entries: { [full.id]: JSON.stringify(full) } }, { merge: true }));
    },
    async removePick(pickId) {
      const { hid, db } = requirePaired();
      // The entry lives in whichever month document it was written to (any month, old or new).
      const month = Object.keys(parts.months).find((mid) => parts.months[mid]?.entries?.[pickId] !== undefined);
      if (!month) return;
      return send(setDoc(doc(db, PATHS.month(hid, month)), { entries: { [pickId]: deleteField() } }, { merge: true }));
    },
    async saveProfile(profile) {
      const { hid } = requirePaired();
      requireMemberLocal(profile.id);
      return send(replaceField(PATHS.memberDoc(hid, profile.id), 'profile', profile));
    },
    async saveSettings(settings) {
      const { hid } = requirePaired();
      return send(replaceField(PATHS.shared(hid), 'settings', settings));
    },

    // ---- Together ----
    async startSession(startedBy: MemberId, request: SuggestRequest, deck: DeckCard[]) {
      const { hid, db } = requirePaired();
      const who = request.who;
      if (who.length < 2 || !who.includes(startedBy) || (state && !who.every((m) => state!.members[m]))) throw new SyncError(MSG.generic);
      if (deck.length > MAX_DECK_CARDS) throw new SyncError(MSG.generic);
      const id = newId();
      const yes: Record<string, string[]> = {};
      const passed: Record<string, string[]> = {};
      for (const m of who) {
        yes[m] = [];
        passed[m] = [];
      }
      const session: TogetherSession = {
        id,
        startedBy,
        request,
        deck,
        joined: [startedBy],
        yes,
        passed,
        matches: [],
        status: 'open',
        createdAt: Date.now(),
      };
      await send(setDoc(doc(db, PATHS.session(hid)), session)); // replaces any earlier session
      return id;
    },
    async joinSession(sessionId, member) {
      const { hid, db } = requirePaired();
      if (state && state.activeSession?.id !== sessionId) throw new SyncError(MSG.sessionGone);
      return send(updateDoc(doc(db, PATHS.session(hid)), 'joined', arrayUnion(member)));
    },
    async swipeInSession(sessionId, member, itemId, yes, matchSnapshot) {
      const { hid, db } = requirePaired();
      const ref = doc(db, PATHS.session(hid));
      if (!yes) {
        if (state && state.activeSession?.id !== sessionId) throw new SyncError(MSG.sessionGone);
        await send(updateDoc(ref, new FieldPath('passed', member), arrayUnion(itemId)));
        return false;
      }
      try {
        return await withTimeout(
          runTransaction(
            db,
            async (tx) => {
              const snap = await tx.get(ref);
              const cur = snap.exists() ? (snap.data() as TogetherSession) : null;
              if (!cur || cur.status !== 'open' || cur.id !== sessionId) throw new SyncError(MSG.sessionGone);
              const now = Date.now();
              const d = decideSwipe(normalizeSession(cur), member, itemId, true, matchSnapshot, now);
              tx.update(ref, { yes: d.session.yes, matches: d.session.matches });
              if (d.pick) {
                tx.set(doc(db, PATHS.month(hid, monthOf(now))), { entries: { [d.pick.id]: JSON.stringify(d.pick) } }, { merge: true });
              }
              return d.matched;
            },
            { maxAttempts: 10 },
          ),
          20000,
          MSG.needsOnline,
        );
      } catch (e) {
        throw new SyncError(friendlyError(e, MSG.needsOnline));
      }
    },
    async appendSessionDeck(sessionId, cards) {
      const { hid, db } = requirePaired();
      const ref = doc(db, PATHS.session(hid));
      try {
        await withTimeout(
          runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists() || (snap.data() as TogetherSession).id !== sessionId) throw new SyncError(MSG.sessionGone);
            const deck = (snap.data() as TogetherSession).deck ?? [];
            const have = new Set(deck.map((c) => c.itemId));
            const add = cards.filter((c) => !have.has(c.itemId));
            if (add.length === 0) return;
            tx.update(ref, { deck: [...deck, ...add].slice(0, MAX_DECK_CARDS) });
          }),
          20000,
          MSG.needsOnline,
        );
      } catch (e) {
        throw new SyncError(friendlyError(e, MSG.needsOnline));
      }
    },
    async endSession(sessionId) {
      const { hid, db } = requirePaired();
      if (state?.activeSession && state.activeSession.id !== sessionId) return; // already replaced by a newer one
      return send(deleteDoc(doc(db, PATHS.session(hid))));
    },

    // ---- extras (not in the contract) ----
    async flush() {
      if (db) await waitForPendingWrites(db);
    },
    async dispose() {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopListeners();
    },
    debug: () => ({ hid: saved?.hid ?? null, memberId: saved?.memberId ?? null, uid: saved?.uid ?? auth?.currentUser?.uid ?? null, db }),
  };

  return api;
}
