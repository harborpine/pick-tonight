/** Where things live in Firestore (see README.md) plus the shapes stored there. */
import type { HistoryEntry, PersonId, Profile, Settings, TogetherSession, WatchlistEntry } from '../contracts';

export const PATHS = {
  household: (hid: string) => `households/${hid}`,
  shared: (hid: string) => `households/${hid}/data/shared`,
  seen: (hid: string, p: PersonId) => `households/${hid}/data/seen_${p}`,
  months: (hid: string) => `households/${hid}/months`,
  month: (hid: string, month: string) => `households/${hid}/months/${month}`,
  sessions: (hid: string) => `households/${hid}/sessions`,
  session: (hid: string, id: string) => `households/${hid}/sessions/${id}`,
  code: (code: string) => `pairingCodes/${code}`,
};

/** Newest entries kept in SharedState.history. */
export const HISTORY_CAP = 300;
/** How many monthly history documents the live listener covers. */
export const HISTORY_MONTHS_LISTENED = 12;
/** Most cards one Together deck may hold (keeps the session doc far under 1 MB). */
export const MAX_DECK_CARDS = 400;
/** Device slots per household (re-pairing after an iOS storage wipe uses a new slot). */
export const MAX_MEMBERS = 8;
/** Pairing code lifetime. The security rules enforce the same 15 minutes. */
export const CODE_TTL_MS = 15 * 60 * 1000;

/** data/shared document. */
export interface SharedDoc {
  profiles?: Partial<Record<PersonId, Profile>>;
  settings?: Settings;
  never?: Partial<Record<PersonId, Record<string, number>>>;
  notTonight?: Partial<Record<PersonId, Record<string, string>>>;
  /** key = `${list}__${itemId}` */
  watchlist?: Record<string, WatchlistEntry>;
}

/** months/{YYYY-MM} document. */
export interface MonthDoc {
  entries?: Record<string, HistoryEntry>;
}

export const watchKey = (list: string, itemId: string): string => `${list}__${itemId}`;
export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
