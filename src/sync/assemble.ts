/** Builds one SharedState from the handful of Firestore documents (pure). */
import { DEFAULT_PLANS, type HistoryEntry, type PersonId, type Profile, type SharedState, type TogetherSession } from '../contracts';
import { HISTORY_CAP, type MonthDoc, type SharedDoc } from './layout';

export interface RawParts {
  shared: SharedDoc | null;
  seen: Record<PersonId, Record<string, number>>;
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
  const history: HistoryEntry[] = [];
  for (const m of Object.values(parts.months)) history.push(...Object.values(m.entries ?? {}));
  history.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));

  const open = parts.sessions
    .filter((s) => s.status === 'open')
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));

  return {
    profiles: {
      HG: sh.profiles?.HG ?? emptyProfile('HG'),
      BG: sh.profiles?.BG ?? emptyProfile('BG'),
    },
    seen: { HG: { ...parts.seen.HG }, BG: { ...parts.seen.BG } },
    never: { HG: { ...sh.never?.HG }, BG: { ...sh.never?.BG } },
    notTonight: { HG: { ...sh.notTonight?.HG }, BG: { ...sh.notTonight?.BG } },
    watchlist: Object.values(sh.watchlist ?? {}).sort((a, b) => b.at - a.at),
    history: history.slice(0, HISTORY_CAP),
    settings: sh.settings ?? { plans: { ...DEFAULT_PLANS } },
    activeSession: open[0] ? normalizeSession(open[0]) : null,
  };
}
