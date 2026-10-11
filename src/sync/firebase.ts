/**
 * SyncApi on Firebase (Firestore + anonymous sign-in). Layout: see README.md.
 * Importing this module has no side effects; Firebase starts in init().
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  waitForPendingWrites,
  where,
  writeBatch,
  type WriteBatch,
  type Firestore,
} from 'firebase/firestore';
import webConfig from '../../firebase.web-config.json';
import type {
  DeckCard,
  DeviceState,
  HouseholdSeed,
  PersonId,
  PickEntry,
  SharedState,
  SuggestRequest,
  SyncApi,
  TitleSnapshot,
  TogetherSession,
  Unsubscribe,
  WatchlistEntry,
  WatchlistOwner,
} from '../contracts';
import { assembleState, type RawParts } from './assemble';
import { friendlyError, MSG, SyncError, withTimeout } from './errors';
import {
  MAX_DECK_CARDS,
  monthOf,
  PATHS,
  watchKey,
  type MonthDoc,
  type SeenShardDoc,
  type SharedDoc,
} from './layout';
import { decideSwipe, soloPickId } from './match';
import { chunk, mergeSeenInputs, normalizeSeen, SEEN_CHUNK, SEEN_MAX, SEEN_SHARDS, shardDocId, shardOf, encodeDetail } from './seen';
import { generateCode, isValidCodeShape, normalizeCode } from './pairing';

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
}

/** The SyncApi plus a few extras used by tests and cleanup. Not part of the contract. */
export interface FirebaseSyncApi extends SyncApi {
  /** Resolves when every queued write has reached the server. */
  flush(): Promise<void>;
  /** Stop listeners and timers (tests). */
  dispose(): Promise<void>;
  /** Identity details for tests. */
  debug(): { hid: string | null; uid: string | null; db: Firestore | null };
  /** Permanently delete this household and everything in it (tests / manual cleanup). Needs internet. */
  destroyHousehold(): Promise<void>;
}

interface Saved {
  hid: string;
  person: PersonId;
  uid: string;
}

const STORE_KEY = 'wtw.sync.pairing.v1';
const ONLINE_MS = 15000;
/** How long a big watched-list write waits for the server before treating the phone as offline. */
const SEEN_CONFIRM_MS = 8000;
const EMIT_DELAY_MS = 25;

function defaultStore(): KeyValueStore {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.getItem('x');
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

export function createFirebaseSync(opts: FirebaseSyncOptions = {}): FirebaseSyncApi {
  const store = opts.storage ?? defaultStore();
  const storeKey = opts.appName ? `${STORE_KEY}:${opts.appName}` : STORE_KEY;

  let app: FirebaseApp | null = null;
  let auth: Auth | null = null;
  let db: Firestore | null = null;

  let device: DeviceState = { status: 'loading', person: null, error: null };
  let state: SharedState | null = null;
  const deviceSubs = new Set<(d: DeviceState) => void>();
  const stateSubs = new Set<(s: SharedState) => void>();

  let saved: Saved | null = null;
  let unsubs: Unsubscribe[] = [];
  let parts: RawParts = freshParts();
  let got = new Set<string>();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let lastCode: string | null = null;
  const madeCodes = new Set<string>();

  function freshParts(): RawParts {
    return { shared: null, seen: { HG: {}, BG: {} }, seenDetails: { HG: {}, BG: {} }, months: {}, sessions: [] };
  }

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
      app = getApps().find((a) => a.name === (opts.appName ?? '[DEFAULT]')) ?? initializeApp(webConfig, opts.appName);
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
      return s.hid && s.person && s.uid ? (s as Saved) : null;
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
   * callbacks (the watched-number map and its details live in different documents), so wait a moment and
   * publish once with everything that arrived, instead of a half-updated state.
   */
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  const emit = () => {
    if (got.size < 6 || emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      if (got.size < 6) return;
      state = assembleState(parts);
      stateSubs.forEach((cb) => cb(state!));
    }, EMIT_DELAY_MS);
  };

  function lostAccess() {
    stopListeners();
    state = null;
    saved = null;
    persistSaved();
    setDevice({
      status: 'unpaired',
      person: null,
      error: 'This phone is no longer connected to your household. Pair it again with a new code.',
    });
  }

  function startListeners(hid: string) {
    const { db } = setup();
    stopListeners();
    const onErr = (e: unknown) => {
      if ((globalThis as { __WTW_DEBUG?: boolean }).__WTW_DEBUG) console.warn('[sync] listener error', e);
      const code = (e as { code?: string }).code ?? '';
      if (code.includes('permission-denied')) lostAccess();
      else setError(friendlyError(e));
    };
    const mark = (key: string, fromCache: boolean) => {
      got.add(key);
      if (!fromCache && device.error === MSG.offline) setError(null);
      emit();
    };
    unsubs.push(
      onSnapshot(
        doc(db, PATHS.shared(hid)),
        (snap) => {
          parts.shared = snap.exists() ? (snap.data() as SharedDoc) : null;
          mark('shared', snap.metadata.fromCache);
        },
        onErr,
      ),
    );
    for (const p of ['HG', 'BG'] as PersonId[]) {
      unsubs.push(
        onSnapshot(
          doc(db, PATHS.seen(hid, p)),
          (snap) => {
            parts.seen[p] = (snap.exists() ? (snap.data() as { m?: Record<string, unknown> }).m : undefined) ?? {};
            mark(`seen${p}`, snap.metadata.fromCache);
          },
          onErr,
        ),
      );
    }
    unsubs.push(
      onSnapshot(
        collection(db, PATHS.seenDetails(hid)),
        (snap) => {
          const details: Record<PersonId, Record<string, string>> = { HG: {}, BG: {} };
          snap.forEach((d) => {
            const person = d.id.startsWith('BG_') ? 'BG' : d.id.startsWith('HG_') ? 'HG' : null;
            if (person) Object.assign(details[person], (d.data() as SeenShardDoc).e ?? {});
          });
          parts.seenDetails = details;
          mark('seenDetails', snap.metadata.fromCache);
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
        query(collection(db, PATHS.sessions(hid)), where('status', '==', 'open')),
        (snap) => {
          parts.sessions = snap.docs.map((d) => d.data() as TogetherSession);
          mark('sessions', snap.metadata.fromCache);
        },
        onErr,
      ),
    );
  }

  /** Sign in (retrying while offline) and start listening for a saved pairing. */
  async function attach(): Promise<void> {
    if (disposed || !saved) return;
    try {
      const uid = await ensureUser(8000);
      if (disposed || !saved) return;
      if (uid !== saved.uid) {
        // The phone got a new identity (iOS wiped its storage): it must pair again.
        lostAccess();
        return;
      }
      startListeners(saved.hid);
    } catch {
      if (disposed) return;
      retryTimer = setTimeout(() => void attach(), 10000);
    }
  }

  const requirePaired = (): { hid: string; person: PersonId; db: Firestore } => {
    if (!saved || device.status !== 'paired') throw new SyncError(MSG.notPaired);
    return { hid: saved.hid, person: saved.person, db: setup().db };
  };

  /** Fire a write in the background; it resolves locally at once and reports problems in device.error. */
  const send = (p: Promise<unknown>): Promise<void> => {
    p.catch((e) => setError(friendlyError(e)));
    return Promise.resolve();
  };

  /**
   * Write a (possibly large) set of watched-title changes in chunks of SEEN_CHUNK titles, each chunk one
   * atomic batch. Small calls behave like every other edit (resolve at once, sync in the background).
   * Large calls wait for the server so a refusal can be reported: the promise rejects with a plain sentence
   * and says how many titles were saved. Re-running is always safe (same values are simply written again).
   * Offline, the first chunk cannot be confirmed within a few seconds, so everything is queued on the phone
   * (the app already shows the change) and uploads by itself when the connection returns; later
   * problems then show up in device.error instead of rejecting.
   */
  async function writeSeen(ids: string[], fill: (batch: WriteBatch, part: string[]) => void, db: Firestore): Promise<void> {
    const parts = chunk(ids, SEEN_CHUNK);
    const build = (part: string[]): Promise<void> => {
      const batch = writeBatch(db);
      fill(batch, part);
      return batch.commit();
    };
    if (ids.length <= 25) return send(build(ids));
    let done = 0;
    let queued = false;
    for (const part of parts) {
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
          done > 0
            ? `${why} ${done} of ${ids.length} titles were saved. Run it again to finish; nothing will be doubled.`
            : why,
        );
      }
    }
  }

  // ------------------------------------------------------------------- API ----
  const api: FirebaseSyncApi = {
    async init() {
      saved = loadSaved();
      if (!saved) {
        setDevice({ status: 'unpaired', person: null, error: null });
        // Warm up sign-in in the background so pairing is quick later.
        void ensureUser(15000).catch(() => undefined);
        return;
      }
      setDevice({ status: 'paired', person: saved.person, error: null });
      void attach();
    },
    getDevice: () => device,
    onDevice(cb) {
      deviceSubs.add(cb);
      cb(device);
      return () => deviceSubs.delete(cb);
    },

    async createHousehold(person, seed: HouseholdSeed) {
      try {
        const uid = await ensureUser(ONLINE_MS);
        const { db } = setup();
        const hidRef = doc(collection(db, 'households'));
        const hid = hidRef.id;
        await withTimeout(
          setDoc(hidRef, { createdAt: serverTimestamp(), members: { [uid]: { person, at: Date.now() } } }),
          ONLINE_MS,
        );
        const shared: SharedDoc = {
          profiles: seed.profiles,
          settings: seed.settings,
          never: { HG: {}, BG: {} },
          notTonight: { HG: {}, BG: {} },
          watchlist: {},
        };
        const batch = writeBatch(db);
        batch.set(doc(db, PATHS.shared(hid)), shared);
        batch.set(doc(db, PATHS.seen(hid, 'HG')), { m: {} });
        batch.set(doc(db, PATHS.seen(hid, 'BG')), { m: {} });
        await withTimeout(batch.commit(), ONLINE_MS);
        saved = { hid, person, uid };
        persistSaved();
        setDevice({ status: 'paired', person, error: null });
        startListeners(hid);
      } catch (e) {
        throw new SyncError(friendlyError(e));
      }
    },

    async createPairingCode() {
      const { hid, person, db } = requirePaired();
      const uid = saved!.uid;
      try {
        if (lastCode) void deleteDoc(doc(db, PATHS.code(lastCode))).catch(() => undefined);
        for (let attempt = 0; attempt < 6; attempt++) {
          const code = generateCode();
          try {
            await withTimeout(
              setDoc(doc(db, PATHS.code(code)), {
                hid,
                person,
                createdBy: uid,
                createdAt: serverTimestamp(),
                used: false,
              }),
              ONLINE_MS,
              MSG.needsOnline,
            );
            lastCode = code;
            madeCodes.add(code);
            return code;
          } catch (e) {
            // A code that already exists is refused by the rules; try another.
            if (!(e as { code?: string }).code?.includes('permission-denied')) throw e;
          }
        }
        throw new SyncError(MSG.generic);
      } catch (e) {
        throw new SyncError(friendlyError(e));
      }
    },

    async joinWithCode(rawCode, person) {
      const code = normalizeCode(rawCode);
      if (!isValidCodeShape(code)) throw new SyncError(MSG.badCode);
      try {
        const uid = await ensureUser(ONLINE_MS);
        const { db } = setup();
        const codeRef = doc(db, PATHS.code(code));
        let snap;
        try {
          snap = await withTimeout(getDocFromServer(codeRef), ONLINE_MS);
        } catch (e) {
          if ((e as { code?: string }).code?.includes('permission-denied')) throw new SyncError(MSG.badCode);
          throw e;
        }
        if (!snap.exists()) throw new SyncError(MSG.badCode);
        const data = snap.data() as { hid: string; person: PersonId; used: boolean };
        if (data.used) throw new SyncError(MSG.badCode); // expiry is enforced by the server rules
        if (data.person === person) {
          throw new SyncError(`That code was made on ${data.person}'s phone, so this phone should be ${data.person === 'HG' ? 'BG' : 'HG'}.`);
        }
        const hid = data.hid;
        const batch = writeBatch(db);
        batch.update(codeRef, { used: true, usedBy: uid });
        batch.update(doc(db, PATHS.household(hid)), {
          [`members.${uid}`]: { person, at: Date.now() },
          lastJoinCode: code,
        });
        try {
          await withTimeout(batch.commit(), ONLINE_MS);
        } catch (e) {
          if ((e as { code?: string }).code?.includes('permission-denied')) throw new SyncError(MSG.badCode);
          throw e;
        }
        saved = { hid, person, uid };
        persistSaved();
        setDevice({ status: 'paired', person, error: null });
        startListeners(hid);
        void pruneStaleSlots(hid, uid, person);
      } catch (e) {
        throw new SyncError(friendlyError(e));
      }
    },

    async unpair() {
      const current = saved;
      if (retryTimer) clearTimeout(retryTimer);
      stopListeners();
      state = null;
      saved = null;
      persistSaved();
      setDevice({ status: 'unpaired', person: null, error: null });
      if (current && db) {
        // Best effort: free this phone's device slot.
        try {
          await withTimeout(
            updateDoc(doc(db, PATHS.household(current.hid)), { [`members.${current.uid}`]: deleteField() }),
            4000,
          );
        } catch {
          /* offline or already gone: nothing more to do */
        }
      }
    },

    getState: () => state,
    onState(cb) {
      stateSubs.add(cb);
      if (state) cb(state);
      return () => stateSubs.delete(cb);
    },

    // ---- mutations ----
    async markWatched(person, entries) {
      const { hid, db } = requirePaired();
      if (entries.length === 0) return;
      const merged = mergeSeenInputs(entries, state?.seen[person] ?? {}, Date.now());
      const ids = Object.keys(merged);
      const total = new Set([...Object.keys(state?.seen[person] ?? {}), ...ids]).size;
      if (total > SEEN_MAX) {
        throw new SyncError(`That would make more than ${SEEN_MAX.toLocaleString('en-US')} watched titles for one person, which is the most this app can keep. Nothing was changed.`);
      }
      return writeSeen(ids, (batch, part) => {
        const m: Record<string, number> = {};
        const byShard = new Map<number, Record<string, string>>();
        for (const id of part) {
          const e = merged[id]!;
          m[id] = e.at;
          const sh = shardOf(id);
          byShard.set(sh, { ...byShard.get(sh), [id]: encodeDetail(e) });
        }
        for (const [sh, e] of byShard) batch.set(doc(db, PATHS.seenShard(hid, shardDocId(person, sh))), { e }, { merge: true });
        batch.set(doc(db, PATHS.seen(hid, person)), { m }, { merge: true });
      }, db);
    },
    async unmarkWatched(person, itemIds) {
      const { hid, db } = requirePaired();
      const ids = [...new Set(itemIds)];
      if (ids.length === 0) return;
      return writeSeen(ids, (batch, part) => {
        const m: Record<string, unknown> = {};
        const byShard = new Map<number, Record<string, unknown>>();
        for (const id of part) {
          m[id] = deleteField();
          const sh = shardOf(id);
          byShard.set(sh, { ...byShard.get(sh), [id]: deleteField() });
        }
        for (const [sh, e] of byShard) batch.set(doc(db, PATHS.seenShard(hid, shardDocId(person, sh))), { e }, { merge: true });
        batch.set(doc(db, PATHS.seen(hid, person)), { m }, { merge: true });
      }, db);
    },
    async setNever(person, itemId, never) {
      const { hid, db } = requirePaired();
      return send(
        updateDoc(doc(db, PATHS.shared(hid)), new FieldPath('never', person, itemId), never ? Date.now() : deleteField()),
      );
    },
    async setNotTonight(person, itemId, date) {
      const { hid, db } = requirePaired();
      const args: unknown[] = [new FieldPath('notTonight', person, itemId), date];
      // Tidy: dates in the past no longer hide anything.
      const today = todayLocal();
      for (const [id, d] of Object.entries(state?.notTonight[person] ?? {})) {
        if (d < today && id !== itemId) args.push(new FieldPath('notTonight', person, id), deleteField());
      }
      const [f, v, ...rest] = args as [FieldPath, unknown, ...unknown[]];
      return send(updateDoc(doc(db, PATHS.shared(hid)), f, v, ...rest));
    },
    async addToWatchlist(list: WatchlistOwner, itemId, addedBy, snapshot: TitleSnapshot) {
      const { hid, db } = requirePaired();
      if (state?.watchlist.some((w) => w.list === list && w.itemId === itemId)) return;
      const entry: WatchlistEntry = { itemId, list, addedBy, at: Date.now(), snapshot };
      return send(updateDoc(doc(db, PATHS.shared(hid)), new FieldPath('watchlist', watchKey(list, itemId)), entry));
    },
    async removeFromWatchlist(list, itemId) {
      const { hid, db } = requirePaired();
      return send(
        updateDoc(doc(db, PATHS.shared(hid)), new FieldPath('watchlist', watchKey(list, itemId)), deleteField()),
      );
    },
    async addPick(entry) {
      const { hid, db } = requirePaired();
      if (state?.picks.some((p) => p.itemId === entry.itemId && p.who === entry.who)) return;
      const at = Date.now();
      const id = entry.kind === 'solo' ? soloPickId(entry.who, entry.itemId) : newId();
      const full: PickEntry = { ...entry, id, at };
      return send(setDoc(doc(db, PATHS.month(hid, monthOf(at))), { entries: { [full.id]: full } }, { merge: true }));
    },
    async removePick(pickId) {
      const { hid, db } = requirePaired();
      // The entry lives in whichever month document it was written to (any month, old or new).
      const month = Object.keys(parts.months).find((mid) => parts.months[mid]?.entries?.[pickId]);
      if (!month) return;
      return send(updateDoc(doc(db, PATHS.month(hid, month)), new FieldPath('entries', pickId), deleteField()));
    },
    async saveProfile(profile) {
      const { hid, db } = requirePaired();
      return send(updateDoc(doc(db, PATHS.shared(hid)), new FieldPath('profiles', profile.id), profile));
    },
    async saveSettings(settings) {
      const { hid, db } = requirePaired();
      return send(updateDoc(doc(db, PATHS.shared(hid)), 'settings', settings));
    },

    // ---- Together ----
    async startSession(startedBy: PersonId, request: SuggestRequest, deck: DeckCard[]) {
      const { hid, db } = requirePaired();
      if (deck.length > MAX_DECK_CARDS) throw new SyncError(MSG.generic);
      const id = newId();
      const session: TogetherSession = {
        id,
        startedBy,
        request,
        deck,
        joined: [startedBy],
        yes: { HG: [], BG: [] },
        passed: { HG: [], BG: [] },
        matches: [],
        status: 'open',
        createdAt: Date.now(),
      };
      const batch = writeBatch(db);
      const prev = state?.activeSession;
      if (prev) batch.delete(doc(db, PATHS.session(hid, prev.id)));
      batch.set(doc(db, PATHS.session(hid, id)), session);
      await send(batch.commit());
      return id;
    },
    async joinSession(sessionId, person) {
      const { hid, db } = requirePaired();
      return send(updateDoc(doc(db, PATHS.session(hid, sessionId)), 'joined', arrayUnion(person)));
    },
    async swipeInSession(sessionId, person, itemId, yes, matchSnapshot) {
      const { hid, db } = requirePaired();
      const ref = doc(db, PATHS.session(hid, sessionId));
      if (!yes) {
        await send(updateDoc(ref, new FieldPath('passed', person), arrayUnion(itemId)));
        return false;
      }
      try {
        return await withTimeout(
          runTransaction(
            db,
            async (tx) => {
              const snap = await tx.get(ref);
              if (!snap.exists() || (snap.data() as TogetherSession).status !== 'open') throw new SyncError(MSG.sessionGone);
              const now = Date.now();
              const d = decideSwipe(snap.data() as TogetherSession, person, itemId, true, matchSnapshot, now);
              tx.update(ref, { yes: d.session.yes, matches: d.session.matches });
              if (d.pick) {
                tx.set(
                  doc(db, PATHS.month(hid, monthOf(now))),
                  { entries: { [d.pick.id]: d.pick } },
                  { merge: true },
                );
              }
              return d.matched;
            },
            { maxAttempts: 8 },
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
      const ref = doc(db, PATHS.session(hid, sessionId));
      try {
        await withTimeout(
          runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new SyncError(MSG.sessionGone);
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
      return send(deleteDoc(doc(db, PATHS.session(hid, sessionId))));
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
    debug: () => ({ hid: saved?.hid ?? null, uid: saved?.uid ?? auth?.currentUser?.uid ?? null, db }),
    async destroyHousehold() {
      const { hid, db } = requirePaired();
      stopListeners();
      for (const c of [PATHS.months(hid), PATHS.sessions(hid), PATHS.seenDetails(hid)]) {
        const snap = await getDocs(collection(db, c));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await Promise.all(
        [PATHS.shared(hid), PATHS.seen(hid, 'HG'), PATHS.seen(hid, 'BG')].map((p) => deleteDoc(doc(db, p))),
      );
      for (const code of madeCodes) await deleteDoc(doc(db, PATHS.code(code))).catch(() => undefined);
      await deleteDoc(doc(db, PATHS.household(hid)));
      saved = null;
      persistSaved();
      state = null;
      setDevice({ status: 'unpaired', person: null, error: null });
    },
  };

  /** After re-pairing, drop older device slots held by the same person (a wiped phone). */
  async function pruneStaleSlots(hid: string, myUid: string, person: PersonId): Promise<void> {
    try {
      const { db } = setup();
      const snap = await withTimeout(getDoc(doc(db, PATHS.household(hid))), 8000);
      const members = (snap.data() as { members?: Record<string, { person: PersonId }> } | undefined)?.members ?? {};
      for (const [uid, m] of Object.entries(members)) {
        if (uid !== myUid && m.person === person) {
          await withTimeout(updateDoc(doc(db, PATHS.household(hid)), { [`members.${uid}`]: deleteField() }), 8000);
        }
      }
    } catch {
      /* best effort */
    }
  }

  return api;
}
