/** Where things live in Firestore (see README.md) plus the shapes stored there. */
import type { MemberId, Settings, TogetherSession } from '../contracts';

export const PATHS = {
  household: (hid: string) => `households/${hid}`,
  shared: (hid: string) => `households/${hid}/data/shared`,
  data: (hid: string) => `households/${hid}/data`,
  /** One document per member: profile, never, not-tonight, own watchlist. */
  memberDoc: (hid: string, m: MemberId) => `households/${hid}/data/${m}`,
  seenColl: (hid: string) => `households/${hid}/seenx`,
  seenShard: (hid: string, docId: string) => `households/${hid}/seenx/${docId}`,
  months: (hid: string) => `households/${hid}/months`,
  month: (hid: string, month: string) => `households/${hid}/months/${month}`,
  sessions: (hid: string) => `households/${hid}/sessions`,
  /** There is only ever one open session per household, so it has a fixed document id. */
  session: (hid: string) => `households/${hid}/sessions/current`,
  invite: (code: string) => `invites/${code}`,
};

/** Most cards one Together deck may hold (keeps the session doc far under 1 MB). */
export const MAX_DECK_CARDS = 400;
/** Invite lifetime. The security rules enforce the same 24 hours. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** Highest member number ever handed out in one household (m1..m999). The rules enforce it too. */
export const MAX_MEMBER_NUMBER = 999;
/** Most entries in the reverse phone->member index (4 live phones + a few displaced ones awaiting tidy-up). */
export const MAX_UID_ENTRIES = 16;

/** households/{hid}. */
export interface HouseholdDoc {
  createdAt?: unknown;
  /** Next member number to hand out; ids are never reused. */
  nextId: number;
  members: Record<string, { name: string; joinedAt: number }>;
  /** `n:<lower-cased name>` -> member id. Makes names unique (case-insensitive) in a way rules can check. */
  names: Record<string, string>;
  /** member id -> uid of the phone that currently is that member. Absent = nobody's phone (unpaired). */
  owners: Record<string, string>;
  /** uid -> member id. A uid only counts while owners[member] === uid (displaced phones go stale). */
  uids: Record<string, string>;
  /** The most recent invite code (may be used/expired). */
  inviteCode?: string;
  /** Set while "Delete everything" is under way: only deletes are accepted. */
  deleting?: boolean;
}

/** invites/{CODE}. Expires 24 h after createdAt (server time). Readable by anyone who knows the exact code; never listable. */
export interface InviteDoc {
  hid: string;
  createdBy: string;
  createdAt?: unknown;
  used: boolean;
  usedBy?: string;
  /** Snapshot kept fresh by every membership change; cleared when the code is used. */
  members: { id: string; name: string }[];
  full: boolean;
  nextId: number;
}

/** data/shared. Watchlist entries are JSON strings (one indexed value each). */
export interface SharedDoc {
  settings?: Settings;
  /** itemId -> JSON of WatchlistEntry */
  ours?: Record<string, string>;
}

/** data/{memberId}. */
export interface MemberDoc {
  profile?: unknown;
  /** itemId -> ms */
  never?: Record<string, number>;
  /** itemId -> YYYY-MM-DD */
  notTonight?: Record<string, string>;
  /** itemId -> JSON of WatchlistEntry */
  watch?: Record<string, string>;
}

/** seenx/{memberId}_{0..7}. e.{itemId} = JSON of a SeenEntry. */
export interface SeenShardDoc {
  e?: Record<string, string>;
}

/** months/{YYYY-MM}. entries.{pickId} = JSON of a PickEntry. */
export interface MonthDoc {
  entries?: Record<string, string>;
}

export type SessionDoc = TogetherSession;

export const nameKey = (name: string): string => `n:${name.trim().toLowerCase()}`;
export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
export const seenDocId = (m: MemberId, shard: number): string => `${m}_${shard}`;
