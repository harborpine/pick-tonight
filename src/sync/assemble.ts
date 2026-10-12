/** Builds one SharedState from the Firestore documents of a household (pure). */
import {
  memberOrder,
  NO_DEALBREAKERS,
  type Member,
  type MemberId,
  type PickEntry,
  type Profile,
  type SharedState,
  type TogetherSession,
  type WatchlistEntry,
} from '../contracts';
import type { HouseholdDoc, MemberDoc, MonthDoc, SharedDoc } from './layout';
import { normalizeSession } from './match';
import { decodeSeenMap } from './seen';

export interface RawParts {
  household: HouseholdDoc | null;
  shared: SharedDoc | null;
  /** data/{memberId} documents. */
  memberDocs: Record<MemberId, MemberDoc>;
  /** member id -> merged `e` maps of that member's seen shards (itemId -> JSON). */
  seen: Record<MemberId, Record<string, string>>;
  /** month id (YYYY-MM) -> document */
  months: Record<string, MonthDoc>;
  /** The session document, if there is one. */
  session: TogetherSession | null;
}

export const freshParts = (): RawParts => ({ household: null, shared: null, memberDocs: {}, seen: {}, months: {}, session: null });

export const emptyProfile = (id: MemberId): Profile => ({
  id,
  favorites: [],
  dealbreakers: { ...NO_DEALBREAKERS, genres: [] },
  taste: { genres: {}, keywords: {}, traits: {}, corrections: {} },
  onboarded: false,
});

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as T;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function readWatch(map: Record<string, string> | undefined, list: string, into: WatchlistEntry[]): void {
  for (const raw of Object.values(map ?? {})) {
    const e = parseJson<WatchlistEntry>(raw);
    if (e && typeof e.itemId === 'string') into.push({ ...e, list });
  }
}

export function assembleState(parts: RawParts): SharedState {
  const hh = parts.household;
  const sh = parts.shared ?? {};
  const members: Record<MemberId, Member> = {};
  for (const [id, m] of Object.entries(hh?.members ?? {})) members[id] = { id, name: m.name, joinedAt: m.joinedAt };
  const ids = memberOrder(members);

  const profiles: SharedState['profiles'] = {};
  const seen: SharedState['seen'] = {};
  const never: SharedState['never'] = {};
  const notTonight: SharedState['notTonight'] = {};
  const watchlist: WatchlistEntry[] = [];
  for (const id of ids) {
    const md = parts.memberDocs[id] ?? {};
    const p = md.profile as Profile | undefined;
    profiles[id] = p && typeof p === 'object' ? { ...emptyProfile(id), ...p, id } : emptyProfile(id);
    seen[id] = decodeSeenMap(parts.seen[id]);
    never[id] = { ...md.never };
    notTonight[id] = { ...md.notTonight };
    readWatch(md.watch, id, watchlist);
  }
  readWatch(sh.ours, 'ours', watchlist);
  watchlist.sort((a, b) => b.at - a.at || (a.itemId < b.itemId ? -1 : 1));

  // Every pick in every month document: nothing is cut off (the list is small because people remove picks).
  const picks: PickEntry[] = [];
  for (const m of Object.values(parts.months)) {
    for (const raw of Object.values(m.entries ?? {})) {
      const e = parseJson<PickEntry>(raw);
      if (e && typeof e.id === 'string') picks.push(e);
    }
  }
  picks.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));

  const s = parts.session && parts.session.status === 'open' ? normalizeSession(parts.session) : null;

  return {
    members,
    profiles,
    seen,
    never,
    notTonight,
    watchlist,
    picks,
    settings: sh.settings ?? { plans: {} },
    activeSession: s,
  };
}
