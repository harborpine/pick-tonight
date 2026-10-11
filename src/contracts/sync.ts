/**
 * CONTRACT: shared live data between the phones of one household (membership,
 * invites, seen, watchlist, never, picks, profiles, settings, Together sessions).
 * Only the lead edits files in src/contracts/.
 *
 * PUBLIC VERSION: anyone on the internet can create a household. There is no
 * sign-in: a phone is a member because it holds the household's saved pairing.
 * Households are strictly isolated from each other.
 */
import type {
  DeckCard,
  Member,
  MemberId,
  PickEntry,
  Profile,
  SeenInput,
  Settings,
  SharedState,
  SuggestRequest,
  TitleSnapshot,
  WatchlistOwner,
} from './state';

export type Unsubscribe = () => void;

export interface DeviceState {
  /**
   * loading  — signing in / reading saved pairing.
   * unpaired — this phone is not in a household.
   * paired   — in a household; shared data is live.
   */
  status: 'loading' | 'unpaired' | 'paired';
  /** Which member this phone is. Set whenever status is 'paired'. */
  memberId: MemberId | null;
  /** Set when something went wrong (plain-language message for the UI; no jargon or error codes). */
  error: string | null;
}

/** A new member's starting profile (the sync layer assigns the id). */
export type NewProfile = Omit<Profile, 'id'>;

/** What someone holding an invite code may see before joining. */
export interface InvitePreview {
  /** Current members (id + name), in join order — so a returning person can pick themselves. */
  members: Pick<Member, 'id' | 'name'>[];
  /** True when the household already has MAX_MEMBERS, so only "I'm already a member" is possible. */
  full: boolean;
}

/** How to join: as a brand-new member, or re-claiming an existing member (new phone / lost pairing). */
export type JoinAs = { name: string; profile: NewProfile } | { memberId: MemberId };

export interface SyncApi {
  // ---- device / membership ----

  /** Start up: sign in anonymously and restore any saved pairing. Safe to call once at boot. */
  init(): Promise<void>;
  getDevice(): DeviceState;
  /** Fires immediately with the current value, then on every change. */
  onDevice(cb: (device: DeviceState) => void): Unsubscribe;

  /**
   * Create a household with this phone as its first member. Leaves this phone paired.
   * Rejects with a plain-language Error when offline or when the name is invalid.
   */
  createHousehold(name: string, profile: NewProfile, settings: Settings): Promise<void>;

  /**
   * A paired phone: make a one-time invite code (6 characters, unambiguous alphabet) for
   * someone else. Expires after 24 hours or first use. The UI turns it into a link
   * (`<site>?join=CODE`) and also shows the bare code.
   */
  createInvite(): Promise<string>;

  /** Look at an invite before joining. Rejects with a plain-language Error if the code is wrong, used or expired. */
  previewInvite(code: string): Promise<InvitePreview>;

  /**
   * Join with an invite code. As a new member: the name must be unique in the household and
   * there must be room. Re-claiming an existing member: this phone takes over that member
   * (the member's previous phone, if any, is signed out). Uses up the code either way.
   * Rejects with a plain-language Error (wrong / used / expired code, household full, name taken, offline).
   */
  joinWithCode(code: string, as: JoinAs): Promise<void>;

  /** Change a member's display name (same validity rules as at creation). */
  renameMember(memberId: MemberId, name: string): Promise<void>;

  /**
   * Remove a member and their personal data (profile, watched list, never, not-tonight, their own
   * watchlist) from the household. Any member may do this (a household is a group that trusts each
   * other). Removing yourself also unpairs this phone. Removing the LAST member deletes the household.
   * Shared things (the 'ours' watchlist, matches) stay.
   */
  removeMember(memberId: MemberId): Promise<void>;

  /** Forget the household on this phone only. The member and their data stay; they can come back with an invite. */
  unpair(): Promise<void>;

  /**
   * "Delete everything": permanently delete the whole household — every member, list, profile,
   * session and invite — for everyone, and unpair this phone. Needs a connection; resolves only once
   * the server has confirmed the deletion.
   */
  deleteHousehold(): Promise<void>;

  // ---- shared state ----

  /** Current shared data, or null until paired and first loaded. */
  getState(): SharedState | null;
  /** Fires immediately if state is loaded, then on every change (local or from another phone). */
  onState(cb: (state: SharedState) => void): Unsubscribe;

  // ---- mutations (all resolve once accepted locally; they sync in the background) ----

  /**
   * Add titles to a member's watched list (History tab). Re-marking a title updates its `at`
   * (keeping the larger `plays`). Must cope with a few thousand entries in one call (an import).
   */
  markWatched(member: MemberId, entries: SeenInput[]): Promise<void>;
  /** Remove titles from a member's watched list. */
  unmarkWatched(member: MemberId, itemIds: string[]): Promise<void>;
  setNever(member: MemberId, itemId: string, never: boolean): Promise<void>;
  /** Hide from this member for `date` (YYYY-MM-DD, the phone's local date). */
  setNotTonight(member: MemberId, itemId: string, date: string): Promise<void>;
  addToWatchlist(list: WatchlistOwner, itemId: string, addedBy: MemberId, snapshot: TitleSnapshot): Promise<void>;
  removeFromWatchlist(list: WatchlistOwner, itemId: string): Promise<void>;
  /**
   * Add a solo right-swipe to the Matches tab. (Together matches are added automatically by swipeInSession.)
   * `id` and `at` are filled in. Adding a title that already has a pick for the same `who` does nothing.
   */
  addPick(entry: Omit<PickEntry, 'id' | 'at'>): Promise<void>;
  /** Remove one line from the Matches tab (by PickEntry.id). */
  removePick(pickId: string): Promise<void>;
  saveProfile(profile: Profile): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;

  // ---- Together sessions ----

  /**
   * Start a session for the audience `request.who` (2+ members, must include `startedBy`).
   * Ends any open session. Other audience members see it as state.activeSession with
   * themselves not yet in `joined`; members outside the audience are not prompted.
   */
  startSession(startedBy: MemberId, request: SuggestRequest, deck: DeckCard[]): Promise<string>;
  joinSession(sessionId: string, member: MemberId): Promise<void>;
  /**
   * Record a swipe. When this is a yes and EVERY other audience member has already said yes
   * to the same title, a match is added to the session and to `picks` exactly once — also when
   * the last yeses arrive at the same moment from different phones
   * (`matchSnapshot` supplies the title details for the pick entry).
   * Resolves to true iff this swipe completed a match.
   */
  swipeInSession(
    sessionId: string,
    member: MemberId,
    itemId: string,
    yes: boolean,
    matchSnapshot: TitleSnapshot,
  ): Promise<boolean>;
  /** Add more cards to the end of the shared deck ("keep swiping"). Ignores ids already in the deck. */
  appendSessionDeck(sessionId: string, cards: DeckCard[]): Promise<void>;
  endSession(sessionId: string): Promise<void>;
}

export interface CreateSyncOptions {
  /**
   * firebase — the real thing (Firestore + anonymous sign-in).
   * memory   — single-device, kept in localStorage; for development and tests without a network.
   */
  mode: 'firebase' | 'memory';
}

/** src/sync/index.ts must export: `export function createSync(opts: CreateSyncOptions): SyncApi` */
export type CreateSync = (opts: CreateSyncOptions) => SyncApi;
