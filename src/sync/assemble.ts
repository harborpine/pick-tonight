/** Builds one SharedState from the handful of Firestore documents (pure). */
import { DEFAULT_PLANS, type PersonId, type PickEntry, type Profile, type SharedState, type TogetherSession } from '../contracts';
import type { MonthDoc, SharedDoc } from './layout';
import { normalizeSeen } from './seen';

export interface RawParts {
  shared: SharedDoc | null;
  /** The legacy per-person map from data/seen_{P}.m: itemId -> ms (older data may be any shape; see normalizeSeen). */
  seen: Record<PersonId, Record<string, unknown>>;
  /** Details from the seenx shards, merged per person: itemId -> JSON string. Absent for old households. */
  seenDetails?: Record<PersonId, Record<string, string>>;
  /** month id (YYYY-MM) -> document */
  months: Record<string, MonthDoc>;
  /** every session document with status 'open' */
  sessions: TogetherSession[];
}

export function normalizeSession(s: TogetherSession): TogetherSession {
  return {
    ...s,
    deck: s.deck ?? [],
    joined: s.joined ?? [],
    yes: { HG: s.yes?.HG ?? [], BG: s.yes?.BG ?? [] },
    passed: { HG: s.passed?.HG ?? [], BG: s.passed?.BG ?? [] },
    matches: s.matches ?? [],
  };
}

const emptyProfile = (id: PersonId): Profile => ({
  id,
  favorites: [],
  dealbreakers: { horror: false, trueCrime: false, scary: false },
  taste: { genres: {}, keywords: {}, traits: {}, corrections: {} },
  onboarded: false,
});

export function assembleState(parts: RawParts): SharedState {
  const sh = parts.shared ?? {};
  // Every pick in every month document: nothing is cut off (the list is small because people remove picks).
  const picks: PickEntry[] = [];
  for (const m of Object.values(parts.months)) picks.push(...Object.values(m.entries ?? {}));
  picks.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));

  const open = parts.sessions
    .filter((s) => s.status === 'open')
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));

  return {
    profiles: {
      HG: sh.profiles?.HG ?? emptyProfile('HG'),
      BG: sh.profiles?.BG ?? emptyProfile('BG'),
    },
    seen: {
      HG: normalizeSeen(parts.seen.HG, parts.seenDetails?.HG),
      BG: normalizeSeen(parts.seen.BG, parts.seenDetails?.BG),
    },
    never: { HG: { ...sh.never?.HG }, BG: { ...sh.never?.BG } },
    notTonight: { HG: { ...sh.notTonight?.HG }, BG: { ...sh.notTonight?.BG } },
    watchlist: Object.values(sh.watchlist ?? {}).sort((a, b) => b.at - a.at),
    picks,
    settings: sh.settings ?? { plans: { ...DEFAULT_PLANS } },
    activeSession: open[0] ? normalizeSession(open[0]) : null,
  };
}
