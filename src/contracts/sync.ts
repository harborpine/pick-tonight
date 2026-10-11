/**
 * CONTRACT: shared live data between the two phones (pairing, seen, watchlist,
 * never, history, profiles, settings, Together sessions).
 * Only the lead edits files in src/contracts/.
 */
import type {
  DeckCard,
  HistoryEntry,
  PersonId,
  Profile,
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
   * unpaired — this phone has not joined a household yet.
   * paired   — joined; shared data is live.
   */
  status: 'loading' | 'unpaired' | 'paired';
  /** Which person this phone belongs to (chosen at pairing). */
  person: PersonId | null;
  /** Set when something went wrong (plain-language message for the UI). */
  error: string | null;
}

/** The starting data written when the first phone creates the household. */
export interface HouseholdSeed {
  profiles: Record<PersonId, Profile>;
  settings: Settings;
}

export interface SyncApi {
  // ---- device / pairing ----

  /** Start up: sign in and restore any saved pairing. Safe to call once at boot. */
  init(): Promise<void>;
  getDevice(): DeviceState;
  /** Fires immediately with the current value, then on every change. */
  onDevice(cb: (device: DeviceState) => void): Unsubscribe;

  /** First phone: create the household as `person`, seeded with starting data. Leaves this phone paired. */
  createHousehold(person: PersonId, seed: HouseholdSeed): Promise<void>;
  /** A paired phone: make a short one-time code (6 characters) for the other phone. Expires after 15 minutes or first use. */
  createPairingCode(): Promise<string>;
  /** Second phone: join using the code, as `person`. Rejects with a plain-language Error if the code is wrong, used or expired. */
  joinWithCode(code: string, person: PersonId): Promise<void>;
  /** Forget the pairing on this phone only. */
  unpair(): Promise<void>;

  // ---- shared state ----

  /** Current shared data, or null until paired and first loaded. */
  getState(): SharedState | null;
  /** Fires immediately if state is loaded, then on every change (local or from the other phone). */
  onState(cb: (state: SharedState) => void): Unsubscribe;

  // ---- mutations (all resolve once accepted locally; they sync in the background) ----

  setSeen(person: PersonId, itemIds: string[], seen: boolean): Promise<void>;
  setNever(person: PersonId, itemId: string, never: boolean): Promise<void>;
  /** Hide from this person for `date` (YYYY-MM-DD, the phone's local date). */
  setNotTonight(person: PersonId, itemId: string, date: string): Promise<void>;
  addToWatchlist(list: WatchlistOwner, itemId: string, addedBy: PersonId, snapshot: TitleSnapshot): Promise<void>;
  removeFromWatchlist(list: WatchlistOwner, itemId: string): Promise<void>;
  /** Log a solo pick. (Matches are logged automatically by swipeInSession.) `id` and `at` are filled in. */
  addHistory(entry: Omit<HistoryEntry, 'id' | 'at'>): Promise<void>;
  saveProfile(profile: Profile): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;

  // ---- Together sessions ----

  /** Start a session (ends any open one). The other phone sees it as state.activeSession with themselves not in `joined`. */
  startSession(startedBy: PersonId, request: SuggestRequest, deck: DeckCard[]): Promise<string>;
  joinSession(sessionId: string, person: PersonId): Promise<void>;
  /**
   * Record a swipe. When this is a yes and the other person has already said yes
   * to the same title, a match is added to the session and to history exactly once
   * (`matchSnapshot` supplies the title details for the history entry).
   * Resolves to true iff this swipe created a match.
   */
  swipeInSession(
    sessionId: string,
    person: PersonId,
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
