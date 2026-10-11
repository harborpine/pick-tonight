/**
 * Single-device SyncApi kept in localStorage (when available). For development
 * and tests without a network. Written by the lead as a starting point; the
 * sync teammate owns it from here and must keep its behaviour identical to the
 * Firebase implementation.
 */
import type {
  DeviceState,
  HouseholdSeed,
  PersonId,
  SharedState,
  SyncApi,
  TogetherSession,
} from '../contracts';
import { decideSwipe, soloPickId } from './match';
import { mergeSeenInputs, normalizeSeen, SEEN_MAX } from './seen';

const KEY = 'wtw.memory-sync.v1';

interface Saved {
  person: PersonId | null;
  state: SharedState | null;
}

const hasStorage = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
};
/** Read data saved by the first app version (numeric seen values, `history`) as the new shapes. */
function upgrade(sv: Saved): Saved {
  const st = sv.state as (SharedState & { history?: SharedState['picks'] }) | null;
  if (!st) return sv;
  for (const p of ['HG', 'BG'] as PersonId[]) st.seen[p] = normalizeSeen(st.seen[p] as unknown as Record<string, unknown>);
  if (!st.picks) st.picks = st.history ?? [];
  delete st.history;
  return sv;
}
const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createMemorySync(): SyncApi {
  let saved: Saved = { person: null, state: null };
  let device: DeviceState = { status: 'loading', person: null, error: null };
  const deviceSubs = new Set<(d: DeviceState) => void>();
  const stateSubs = new Set<(s: SharedState) => void>();

  const persist = () => {
    if (hasStorage()) localStorage.setItem(KEY, JSON.stringify(saved));
  };
  const setDevice = (d: DeviceState) => {
    device = d;
    deviceSubs.forEach((cb) => cb(device));
  };
  /** Apply a change to a fresh copy so subscribers always get a new object. */
  const update = (fn: (s: SharedState) => void): void => {
    if (!saved.state) throw new Error('This phone is not paired yet.');
    const next = structuredClone(saved.state);
    fn(next);
    saved.state = next;
    persist();
    stateSubs.forEach((cb) => cb(next));
  };
  const session = (s: SharedState, id: string): TogetherSession => {
    if (!s.activeSession || s.activeSession.id !== id) throw new Error('That session is no longer open.');
    return s.activeSession;
  };

  return {
    async init() {
      if (hasStorage()) {
        const raw = localStorage.getItem(KEY);
        if (raw) saved = upgrade(JSON.parse(raw) as Saved);
      }
      setDevice({ status: saved.state ? 'paired' : 'unpaired', person: saved.person, error: null });
    },
    getDevice: () => device,
    onDevice(cb) {
      deviceSubs.add(cb);
      cb(device);
      return () => deviceSubs.delete(cb);
    },

    async createHousehold(person, seed: HouseholdSeed) {
      saved = {
        person,
        state: {
          profiles: seed.profiles,
          settings: seed.settings,
          seen: { HG: {}, BG: {} },
          never: { HG: {}, BG: {} },
          notTonight: { HG: {}, BG: {} },
          watchlist: [],
          picks: [],
          activeSession: null,
        },
      };
      persist();
      setDevice({ status: 'paired', person, error: null });
      stateSubs.forEach((cb) => cb(saved.state!));
    },
    async createPairingCode() {
      return 'LOCAL1';
    },
    async joinWithCode() {
      throw new Error('Pairing a second phone needs the online mode.');
    },
    async unpair() {
      saved = { person: null, state: null };
      persist();
      setDevice({ status: 'unpaired', person: null, error: null });
    },

    getState: () => saved.state,
    onState(cb) {
      stateSubs.add(cb);
      if (saved.state) cb(saved.state);
      return () => stateSubs.delete(cb);
    },

    async markWatched(person, entries) {
      update((s) => {
        const merged = mergeSeenInputs(entries, s.seen[person], Date.now());
        if (new Set([...Object.keys(s.seen[person]), ...Object.keys(merged)]).size > SEEN_MAX) {
          throw new Error(`That would make more than ${SEEN_MAX.toLocaleString('en-US')} watched titles for one person, which is the most this app can keep. Nothing was changed.`);
        }
        Object.assign(s.seen[person], merged);
      });
    },
    async unmarkWatched(person, itemIds) {
      update((s) => {
        for (const id of itemIds) delete s.seen[person][id];
      });
    },
    async setNever(person, itemId, never) {
      update((s) => {
        if (never) s.never[person][itemId] = Date.now();
        else delete s.never[person][itemId];
      });
    },
    async setNotTonight(person, itemId, date) {
      update((s) => {
        s.notTonight[person][itemId] = date;
      });
    },
    async addToWatchlist(list, itemId, addedBy, snapshot) {
      update((s) => {
        if (s.watchlist.some((w) => w.list === list && w.itemId === itemId)) return;
        s.watchlist.unshift({ itemId, list, addedBy, at: Date.now(), snapshot });
      });
    },
    async removeFromWatchlist(list, itemId) {
      update((s) => {
        s.watchlist = s.watchlist.filter((w) => !(w.list === list && w.itemId === itemId));
      });
    },
    async addPick(entry) {
      update((s) => {
        if (s.picks.some((p) => p.itemId === entry.itemId && p.who === entry.who)) return;
        const id = entry.kind === 'solo' ? soloPickId(entry.who, entry.itemId) : uid();
        s.picks.unshift({ ...entry, id, at: Date.now() });
      });
    },
    async removePick(pickId) {
      update((s) => {
        s.picks = s.picks.filter((p) => p.id !== pickId);
      });
    },
    async saveProfile(profile) {
      update((s) => {
        s.profiles[profile.id] = profile;
      });
    },
    async saveSettings(settings) {
      update((s) => {
        s.settings = settings;
      });
    },

    async startSession(startedBy, request, deck) {
      const id = uid();
      update((s) => {
        s.activeSession = {
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
      });
      return id;
    },
    async joinSession(sessionId, person) {
      update((s) => {
        const sess = session(s, sessionId);
        if (!sess.joined.includes(person)) sess.joined.push(person);
      });
    },
    async swipeInSession(sessionId, person, itemId, yes, matchSnapshot) {
      let matched = false;
      update((s) => {
        const sess = session(s, sessionId);
        const d = decideSwipe(sess, person, itemId, yes, matchSnapshot, Date.now());
        s.activeSession = d.session;
        if (d.pick) s.picks.unshift(d.pick);
        matched = d.matched;
      });
      return matched;
    },
    async appendSessionDeck(sessionId, cards) {
      update((s) => {
        const sess = session(s, sessionId);
        const have = new Set(sess.deck.map((c) => c.itemId));
        sess.deck.push(...cards.filter((c) => !have.has(c.itemId)));
      });
    },
    async endSession(sessionId) {
      update((s) => {
        if (s.activeSession?.id === sessionId) s.activeSession = null;
      });
    },
  };
}
