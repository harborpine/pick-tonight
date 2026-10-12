/**
 * Single-device SyncApi kept in localStorage (when available). For development and tests without a
 * network. Behaves like the Firebase implementation as far as one device can show; because a second real
 * phone is impossible here, `MemorySyncApi` adds two debug helpers (see README.md):
 *   debugAddMember(name, profile)  - a new member joins the household (as if by invite)
 *   debugActAs(memberId)           - this device now acts as that member
 * The Firebase SDK is never imported from this file.
 */
import {
  MAX_MEMBERS,
  type DeviceState,
  type MemberId,
  type NewProfile,
  type SharedState,
  type Settings,
  type SyncApi,
  type TogetherSession,
} from '../contracts';
import { MSG, SyncError } from './errors';
import { INVITE_TTL_MS } from './layout';
import { decideSwipe, normalizeSession, soloPickId } from './match';
import { checkCode, generateCode, isValidCodeShape, nameProblem, nameTaken, normalizeCode, tidyName } from './pairing';
import { mergeSeenInputs, SEEN_MAX } from './seen';

/** Starts with `pt.` so it can never collide with the private app's keys on the shared origin. */
export const MEMORY_KEY = 'pt.memory-sync.v2';
const KEY = MEMORY_KEY;

interface Saved {
  memberId: MemberId | null;
  nextId: number;
  state: SharedState | null;
  invites: Record<string, { expiresAt: number; used: boolean }>;
}

const blank = (): Saved => ({ memberId: null, nextId: 1, state: null, invites: {} });

const hasStorage = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
};
const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export interface MemorySyncApi extends SyncApi {
  /** Debug only: add a member to the household without an invite (simulates another phone joining). Returns the new id. */
  debugAddMember(name: string, profile: NewProfile): Promise<MemberId>;
  /** Debug only: make this device act as another member of the household (simulates using their phone). */
  debugActAs(memberId: MemberId): void;
}

export function createMemorySync(): MemorySyncApi {
  let saved: Saved = blank();
  let device: DeviceState = { status: 'loading', memberId: null, error: null };
  const deviceSubs = new Set<(d: DeviceState) => void>();
  const stateSubs = new Set<(s: SharedState) => void>();

  const persist = () => {
    try {
      if (hasStorage()) localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* storage full or blocked: keep working in memory */
    }
  };
  const setDevice = (d: DeviceState) => {
    device = d;
    deviceSubs.forEach((cb) => cb(device));
  };
  const publish = () => {
    if (saved.state && saved.memberId) stateSubs.forEach((cb) => cb(saved.state!));
  };
  const requireState = (): SharedState => {
    if (!saved.state || !saved.memberId) throw new SyncError(MSG.notPaired);
    return saved.state;
  };
  /** Apply a change to a fresh copy so subscribers always get a new object. */
  const update = (fn: (s: SharedState) => void): void => {
    const next = structuredClone(requireState());
    fn(next);
    saved.state = next;
    persist();
    publish();
  };
  const membersList = (s: SharedState) => Object.values(s.members).map((m) => ({ id: m.id, name: m.name }));
  const requireMember = (s: SharedState, id: MemberId) => {
    if (!s.members[id]) throw new SyncError(MSG.memberGone);
  };
  const addMember = (s: SharedState, name: string, profile: NewProfile): MemberId => {
    const id = `m${saved.nextId++}`;
    s.members[id] = { id, name: tidyName(name), joinedAt: Date.now() };
    s.profiles[id] = { ...profile, id };
    s.seen[id] = {};
    s.never[id] = {};
    s.notTonight[id] = {};
    return id;
  };
  const checkNewMember = (s: SharedState | null, name: string) => {
    const p = nameProblem(name);
    if (p) throw new SyncError(p);
    if (s && Object.keys(s.members).length >= MAX_MEMBERS) throw new SyncError(MSG.full);
    if (s && nameTaken(name, membersList(s))) throw new SyncError(MSG.nameTaken);
  };
  const session = (s: SharedState, id: string): TogetherSession => {
    if (!s.activeSession || s.activeSession.id !== id) throw new SyncError(MSG.sessionGone);
    return s.activeSession;
  };
  const tombstoneOrThrow = (code: string) => {
    if (!isValidCodeShape(code)) throw new SyncError(MSG.badCode);
    const inv = saved.invites[code];
    if (!inv || !saved.state) throw new SyncError(MSG.badCode);
    const c = checkCode({ used: inv.used, expiresAtMs: inv.expiresAt }, Date.now());
    if (c === 'used') throw new SyncError(MSG.usedCode);
    if (c === 'expired') throw new SyncError(MSG.expiredCode);
    return inv;
  };

  const api: MemorySyncApi = {
    async init() {
      if (hasStorage()) {
        try {
          const raw = localStorage.getItem(KEY);
          if (raw) saved = { ...blank(), ...(JSON.parse(raw) as Saved) };
        } catch {
          saved = blank();
        }
      }
      setDevice({ status: saved.state && saved.memberId ? 'paired' : 'unpaired', memberId: saved.memberId, error: null });
    },
    getDevice: () => device,
    onDevice(cb) {
      deviceSubs.add(cb);
      cb(device);
      return () => deviceSubs.delete(cb);
    },

    async createHousehold(name, profile, settings: Settings) {
      checkNewMember(null, name);
      saved = blank();
      const s: SharedState = {
        members: {},
        profiles: {},
        seen: {},
        never: {},
        notTonight: {},
        watchlist: [],
        picks: [],
        settings,
        activeSession: null,
      };
      const id = addMember(s, name, profile);
      saved.state = s;
      saved.memberId = id;
      persist();
      setDevice({ status: 'paired', memberId: id, error: null });
      publish();
    },
    async createInvite() {
      requireState();
      let code = generateCode();
      while (saved.invites[code]) code = generateCode();
      saved.invites[code] = { expiresAt: Date.now() + INVITE_TTL_MS, used: false };
      persist();
      return code;
    },
    async previewInvite(raw) {
      const code = normalizeCode(raw);
      tombstoneOrThrow(code);
      const s = saved.state!;
      return { members: membersList(s), full: Object.keys(s.members).length >= MAX_MEMBERS };
    },
    async joinWithCode(raw, as) {
      const code = normalizeCode(raw);
      const inv = tombstoneOrThrow(code);
      const s = structuredClone(saved.state!);
      let id: MemberId;
      if ('memberId' in as) {
        requireMember(s, as.memberId);
        id = as.memberId;
      } else {
        checkNewMember(s, as.name);
        id = addMember(s, as.name, as.profile);
      }
      inv.used = true;
      saved.state = s;
      saved.memberId = id;
      persist();
      setDevice({ status: 'paired', memberId: id, error: null });
      publish();
    },
    async renameMember(memberId, name) {
      const s = requireState();
      requireMember(s, memberId);
      const p = nameProblem(name);
      if (p) throw new SyncError(p);
      if (nameTaken(name, membersList(s), memberId)) throw new SyncError(MSG.nameTaken);
      update((st) => {
        st.members[memberId]!.name = tidyName(name);
      });
    },
    async removeMember(memberId) {
      const s = requireState();
      requireMember(s, memberId);
      if (Object.keys(s.members).length === 1) return api.deleteHousehold();
      update((st) => {
        delete st.members[memberId];
        delete st.profiles[memberId];
        delete st.seen[memberId];
        delete st.never[memberId];
        delete st.notTonight[memberId];
        st.watchlist = st.watchlist.filter((w) => w.list !== memberId);
        if (st.activeSession?.request.who.includes(memberId)) st.activeSession = null;
      });
      if (memberId === saved.memberId) {
        saved.memberId = null;
        persist();
        setDevice({ status: 'unpaired', memberId: null, error: null });
      }
    },
    async unpair() {
      // The household stays (on a real server it would); only this phone forgets it.
      saved.memberId = null;
      persist();
      setDevice({ status: 'unpaired', memberId: null, error: null });
    },
    async deleteHousehold() {
      requireState();
      saved = blank();
      persist();
      setDevice({ status: 'unpaired', memberId: null, error: null });
    },

    getState: () => (saved.memberId ? saved.state : null),
    onState(cb) {
      stateSubs.add(cb);
      if (saved.state && saved.memberId) cb(saved.state);
      return () => stateSubs.delete(cb);
    },

    async markWatched(member, entries) {
      const s = requireState();
      requireMember(s, member);
      const merged = mergeSeenInputs(entries, s.seen[member]!, Date.now());
      if (new Set([...Object.keys(s.seen[member]!), ...Object.keys(merged)]).size > SEEN_MAX) {
        throw new SyncError(`That would make more than ${SEEN_MAX.toLocaleString('en-US')} watched titles for one person, which is the most this app can keep. Nothing was changed.`);
      }
      update((st) => {
        Object.assign(st.seen[member]!, merged);
      });
    },
    async unmarkWatched(member, itemIds) {
      requireMember(requireState(), member);
      update((s) => {
        for (const id of itemIds) delete s.seen[member]![id];
      });
    },
    async setNever(member, itemId, never) {
      requireMember(requireState(), member);
      update((s) => {
        if (never) s.never[member]![itemId] = Date.now();
        else delete s.never[member]![itemId];
      });
    },
    async setNotTonight(member, itemId, date) {
      requireMember(requireState(), member);
      update((s) => {
        s.notTonight[member]![itemId] = date;
      });
    },
    async addToWatchlist(list, itemId, addedBy, snapshot) {
      requireState();
      update((s) => {
        if (s.watchlist.some((w) => w.list === list && w.itemId === itemId)) return;
        s.watchlist.unshift({ itemId, list, addedBy, at: Date.now(), snapshot });
      });
    },
    async removeFromWatchlist(list, itemId) {
      requireState();
      update((s) => {
        s.watchlist = s.watchlist.filter((w) => !(w.list === list && w.itemId === itemId));
      });
    },
    async addPick(entry) {
      requireState();
      update((s) => {
        const id = entry.kind === 'solo' ? soloPickId(entry.who, entry.itemId) : uid();
        if (s.picks.some((p) => p.id === id || (p.itemId === entry.itemId && p.who.join('+') === entry.who.join('+')))) return;
        s.picks.unshift({ ...entry, id, at: Date.now() });
      });
    },
    async removePick(pickId) {
      requireState();
      update((s) => {
        s.picks = s.picks.filter((p) => p.id !== pickId);
      });
    },
    async saveProfile(profile) {
      requireMember(requireState(), profile.id);
      update((s) => {
        s.profiles[profile.id] = profile;
      });
    },
    async saveSettings(settings) {
      requireState();
      update((s) => {
        s.settings = settings;
      });
    },

    async startSession(startedBy, request, deck) {
      const s = requireState();
      const who = request.who;
      if (who.length < 2 || !who.includes(startedBy) || !who.every((m) => s.members[m])) throw new SyncError(MSG.generic);
      const id = uid();
      update((st) => {
        const yes: Record<string, string[]> = {};
        const passed: Record<string, string[]> = {};
        for (const m of who) {
          yes[m] = [];
          passed[m] = [];
        }
        st.activeSession = { id, startedBy, request, deck, joined: [startedBy], yes, passed, matches: [], status: 'open', createdAt: Date.now() };
      });
      return id;
    },
    async joinSession(sessionId, member) {
      session(requireState(), sessionId);
      update((s) => {
        const sess = session(s, sessionId);
        if (sess.request.who.includes(member) && !sess.joined.includes(member)) sess.joined.push(member);
      });
    },
    async swipeInSession(sessionId, member, itemId, yes, matchSnapshot) {
      session(requireState(), sessionId);
      let matched = false;
      update((s) => {
        const d = decideSwipe(session(s, sessionId), member, itemId, yes, matchSnapshot, Date.now());
        s.activeSession = d.session;
        if (d.pick) s.picks.unshift(d.pick);
        matched = d.matched;
      });
      return matched;
    },
    async appendSessionDeck(sessionId, cards) {
      session(requireState(), sessionId);
      update((s) => {
        const sess = session(s, sessionId);
        const have = new Set(sess.deck.map((c) => c.itemId));
        sess.deck.push(...cards.filter((c) => !have.has(c.itemId)));
        s.activeSession = normalizeSession(sess);
      });
    },
    async endSession(sessionId) {
      requireState();
      update((s) => {
        if (s.activeSession?.id === sessionId) s.activeSession = null;
      });
    },

    async debugAddMember(name, profile) {
      const s = requireState();
      checkNewMember(s, name);
      let id = '';
      update((st) => {
        id = addMember(st, name, profile);
      });
      return id;
    },
    debugActAs(memberId) {
      const s = requireState();
      requireMember(s, memberId);
      saved.memberId = memberId;
      persist();
      setDevice({ status: 'paired', memberId, error: null });
    },
  };
  return api;
}
