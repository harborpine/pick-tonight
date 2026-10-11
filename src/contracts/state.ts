/**
 * CONTRACT: people, requests, and the shared live data both phones see.
 * Only the lead edits files in src/contracts/.
 */
import type { GenreId, MoodId, PlanSelection, ServiceId } from './catalog';

export type PersonId = 'HG' | 'BG';
export const PEOPLE: PersonId[] = ['HG', 'BG'];
export type Who = PersonId | 'Together';

/** The people actually watching for a given `who`. */
export function watchers(who: Who): PersonId[] {
  return who === 'Together' ? ['HG', 'BG'] : [who];
}

// ---------------------------------------------------------------------------
// Asking for a suggestion
// ---------------------------------------------------------------------------

/** Viewing type is about attention, not taste. 'eating' behaves exactly like 'background'. */
export type ViewingType = 'focused' | 'background' | 'eating';

/** Time available, as the minutes label the user tapped. 'any' = "I don't care". */
export type TimeBudget = 20 | 45 | 60 | 120 | 'any';

/**
 * The longest runtime (minutes) allowed for each budget. "About 20 min" allows a
 * standard 22-25 minute episode; "2+ hrs" has no upper limit. 'any' has no limit
 * AND no preference for long or short (unlike 120, which favours using the time).
 */
export const TIME_LIMIT_MINUTES: Record<TimeBudget, number> = {
  20: 25,
  45: 50,
  60: 65,
  120: Number.POSITIVE_INFINITY,
  any: Number.POSITIVE_INFINITY,
};

/**
 * 'new' and 'rewatch' are hard rules. 'either' is a soft lean towards new:
 * about 1 card in 10 is something a watcher has already seen (EITHER_REWATCH_SHARE).
 */
export type Novelty = 'new' | 'rewatch' | 'either';
export const EITHER_REWATCH_SHARE = 0.1;

export interface SuggestRequest {
  who: Who;
  viewing: ViewingType;
  mood: MoodId;
  time: TimeBudget;
  novelty: Novelty;
  /** Optional genre craving. */
  genre: GenreId | null;
}

export const DEFAULT_REQUEST: SuggestRequest = {
  who: 'Together',
  viewing: 'focused',
  mood: 'laugh',
  time: 60,
  novelty: 'either',
  genre: null,
};

// ---------------------------------------------------------------------------
// What a card tells you to watch
// ---------------------------------------------------------------------------

export type WatchPick =
  | { type: 'movie' }
  | { type: 'series-start' }
  /** A newly released season of a show the watcher already follows (follow-ups only). */
  | { type: 'season'; season: number }
  | { type: 'any-episode' }
  | { type: 'episode'; season: number; episode: number; name: string };

export interface ServiceChoice {
  serviceId: ServiceId;
  /** PlanDef.id of the household plan used. */
  planId: string;
  adFree: boolean;
}

export interface DeckCard {
  itemId: string;
  pick: WatchPick;
  service: ServiceChoice;
  /** Minutes this pick takes (episode length or movie runtime). */
  minutes: number;
  /** Higher is better; only meaningful within one deck. */
  score: number;
  /** Short plain-language reasons, best first, e.g. "Because you love Scrubs". 0-3 entries. */
  reasons: string[];
}

export type SwipeAction = 'yes' | 'not-tonight' | 'seen' | 'save' | 'never';

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface Dealbreakers {
  horror: boolean;
  trueCrime: boolean;
  /** Nothing frightening, even if it isn't tagged horror. */
  scary: boolean;
}

/**
 * What the app has learned from swipes, layered on top of the favourites.
 * Values are deltas in roughly [-1, 1]; 0 / missing = no learned opinion.
 * The engine owns the exact meaning; other code treats this as opaque.
 */
export interface TasteWeights {
  genres: Partial<Record<GenreId, number>>;
  keywords: Record<string, number>;
  /** Other learned traits, keyed by engine-defined names (e.g. 'kind:movie', 'dropIn'). */
  traits: Record<string, number>;
  /**
   * Manual corrections from the "what it has learned" page, keyed by TasteInsight.key.
   * 'more' / 'less' pin the direction; they outrank anything learned.
   */
  corrections: Record<string, 'more' | 'less'>;
}

export interface Profile {
  id: PersonId;
  /** Item ids. Favourites count as seen and are strong taste signals. */
  favorites: string[];
  dealbreakers: Dealbreakers;
  taste: TasteWeights;
  /** True once the first-run "tick what you've seen" grid is finished. */
  onboarded: boolean;
}

// ---------------------------------------------------------------------------
// Shared live data
// ---------------------------------------------------------------------------

export interface Settings {
  plans: PlanSelection;
}

/** Enough to show a title even after it leaves the catalog. */
export interface TitleSnapshot {
  title: string;
  year: number;
  poster: string | null;
}

/** How a title got onto someone's watched list. */
export type SeenSource = 'manual' | 'import' | 'onboarding';

/** One watched title for one person. Only ever created by an explicit "I watched this", the first-run grid, or an import. */
export interface SeenEntry {
  /** ms timestamp it was last watched (for imports: the latest date in the file; otherwise when it was marked). */
  at: number;
  source: SeenSource;
  /** Imports only: how many separate plays (episodes / viewings) the file listed. */
  plays?: number;
  /** Title details, so the History tab can show titles that are not in the catalog. Always set for new entries. */
  snapshot?: TitleSnapshot;
}

/** What to write when marking something watched. */
export interface SeenInput {
  itemId: string;
  /** Defaults to now. */
  at?: number;
  source: SeenSource;
  plays?: number;
  snapshot: TitleSnapshot;
}

export type WatchlistOwner = PersonId | 'ours';

export interface WatchlistEntry {
  itemId: string;
  /** Whose list: mine (HG), hers (BG), or ours. One entry per (itemId, list). */
  list: WatchlistOwner;
  addedBy: PersonId;
  at: number;
  snapshot: TitleSnapshot;
}

/**
 * One line on the Matches tab: a title someone swiped right on by themselves
 * ('solo') or that both said yes to in a Together session ('match').
 * A pick is NOT a record of watching — see SeenEntry for that.
 * While a pick exists, its title is left out of new decks for the people in `who`.
 */
export interface PickEntry {
  id: string;
  at: number;
  kind: 'match' | 'solo';
  who: Who;
  itemId: string;
  snapshot: TitleSnapshot;
  pick: WatchPick;
  service: ServiceChoice;
  /** Set for matches. */
  sessionId?: string;
}

export interface SessionMatch {
  itemId: string;
  at: number;
}

export interface TogetherSession {
  id: string;
  startedBy: PersonId;
  request: SuggestRequest;
  /** The shared deck, in order. Both phones swipe exactly this. May be appended to. */
  deck: DeckCard[];
  /** Who has joined (the starter is always included). */
  joined: PersonId[];
  /** Item ids each person swiped yes on. */
  yes: Record<PersonId, string[]>;
  /** Item ids each person passed on (any non-yes action). */
  passed: Record<PersonId, string[]>;
  /** Titles both said yes to, oldest first. */
  matches: SessionMatch[];
  status: 'open' | 'ended';
  createdAt: number;
}

export interface SharedState {
  profiles: Record<PersonId, Profile>;
  /** Everything each person has watched — the History tab. (Favourites count as seen too; use Engine.hasSeen.) */
  seen: Record<PersonId, Record<string, SeenEntry>>;
  /** itemId -> ms timestamp tapped Never. */
  never: Record<PersonId, Record<string, number>>;
  /** itemId -> local date (YYYY-MM-DD) it was swiped "not tonight". Hidden for that person on that date only. */
  notTonight: Record<PersonId, Record<string, string>>;
  watchlist: WatchlistEntry[];
  /** The Matches tab: solo right-swipes and Together matches, newest first. */
  picks: PickEntry[];
  settings: Settings;
  /** The open Together session, if any (at most one at a time). */
  activeSession: TogetherSession | null;
}
