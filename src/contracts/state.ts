/**
 * CONTRACT: people, requests, and the shared live data every phone in a household sees.
 * Only the lead edits files in src/contracts/.
 *
 * PUBLIC VERSION: a household has 1 to MAX_MEMBERS members, each with their own
 * phone, name, profile and taste. Nothing about any particular person is built in.
 */
import type { GenreId, MoodId, PlanSelection, ServiceId, TitleKind } from './catalog';

// ---------------------------------------------------------------------------
// Members and audiences
// ---------------------------------------------------------------------------

/**
 * Opaque, stable id for one member of a household. Real households get 'm1', 'm2'…
 * from the sync layer; any non-empty string without dots or slashes is valid
 * (tests use readable ids). Never shown to users — show Member.name.
 */
export type MemberId = string;

export const MAX_MEMBERS = 4;
export const MAX_NAME_LENGTH = 20;

export interface Member {
  id: MemberId;
  /** What the person typed at setup. Unique within the household (case-insensitive), 1..MAX_NAME_LENGTH chars. */
  name: string;
  joinedAt: number;
}

/**
 * Who is watching: one or more member ids, no duplicates, sorted ascending
 * (always build it with `normalizeWho`). One id = that person alone; two or more = together.
 */
export type Who = MemberId[];

export function normalizeWho(ids: Iterable<MemberId>): Who {
  return [...new Set(ids)].sort();
}

/** The people actually watching. (Kept as a function so call sites read the same as before.) */
export function watchers(who: Who): MemberId[] {
  return who;
}

export function isTogether(who: Who): boolean {
  return who.length > 1;
}

export function sameWho(a: Who, b: Who): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** True when the two audiences share at least one member. */
export function whoOverlaps(a: Who, b: Who): boolean {
  return a.some((id) => b.includes(id));
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
  /** Non-empty. */
  who: Who;
  viewing: ViewingType;
  mood: MoodId;
  time: TimeBudget;
  novelty: Novelty;
  /** Optional genre craving. */
  genre: GenreId | null;
}

/** Everything except `who`, which the UI fills in (this phone's member by default). */
export const DEFAULT_REQUEST: Omit<SuggestRequest, 'who'> = {
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
  /**
   * Short plain-language reasons, best first, 0-3 entries. They may name a member
   * ("One of Sam's favourites") — the engine gets names from EngineContext.state.members.
   */
  reasons: string[];
}

export type SwipeAction = 'yes' | 'not-tonight' | 'seen' | 'save' | 'never';

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** "Never show me…" choices. Hard exclusions for any audience that includes this member. */
export interface Dealbreakers {
  horror: boolean;
  trueCrime: boolean;
  /** Nothing frightening, even if it isn't tagged horror. */
  scary: boolean;
  /** Whole genres this person never wants (e.g. 'reality', 'animation', 'documentary'). */
  genres: GenreId[];
  /** Nothing whose original language isn't English (i.e. subtitled or dubbed). */
  subtitled: boolean;
}

export const NO_DEALBREAKERS: Dealbreakers = { horror: false, trueCrime: false, scary: false, genres: [], subtitled: false };

/**
 * A favourite the person picked by search. It carries its own taste data because it
 * may not be on the household's services (or in any loaded catalog). When the same id
 * IS in the catalog, the engine prefers the catalog item's richer data.
 */
export interface FavoriteTitle {
  id: string;
  kind: TitleKind;
  title: string;
  year: number;
  genres: GenreId[];
  /** May be empty. */
  keywords: string[];
  poster: string | null;
}

export const MAX_FAVORITES = 40;

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
  id: MemberId;
  /** At most MAX_FAVORITES. Favourites count as seen and are strong taste signals. May be empty. */
  favorites: FavoriteTitle[];
  dealbreakers: Dealbreakers;
  taste: TasteWeights;
  /** True once this person has finished first-run setup (favourites, never-show-me, seen grid — each skippable). */
  onboarded: boolean;
}

// ---------------------------------------------------------------------------
// Shared live data
// ---------------------------------------------------------------------------

export interface Settings {
  /** Household-wide: which plan the household has for each service. Missing / null = not subscribed. */
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
  /** Title details, so the History tab can show titles that are not in the catalog. */
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

/** A member's own list, or the household's shared list. */
export type WatchlistOwner = MemberId | 'ours';

export interface WatchlistEntry {
  itemId: string;
  /** One entry per (itemId, list). */
  list: WatchlistOwner;
  addedBy: MemberId;
  at: number;
  snapshot: TitleSnapshot;
}

/**
 * One line on the Matches tab: a title someone swiped right on by themselves
 * (kind 'solo', `who` = that one member — or the chosen audience when liked from the New feed)
 * or that everyone watching said yes to in a Together session (kind 'match', `who` = the session audience).
 * A pick is NOT a record of watching — see SeenEntry for that.
 * While a pick exists, its title is left out of new decks for any audience that overlaps `who`.
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
  startedBy: MemberId;
  /** `request.who` is the audience: the members this session is for (2 or more, includes startedBy). */
  request: SuggestRequest;
  /** The shared deck, in order. Everyone swipes exactly this. May be appended to. */
  deck: DeckCard[];
  /** Audience members who have joined (the starter is always included). */
  joined: MemberId[];
  /** Item ids each audience member swiped yes on. A key exists for every audience member. */
  yes: Record<MemberId, string[]>;
  /** Item ids each audience member passed on (any non-yes action). A key exists for every audience member. */
  passed: Record<MemberId, string[]>;
  /** Titles EVERY audience member said yes to, oldest first. */
  matches: SessionMatch[];
  status: 'open' | 'ended';
  createdAt: number;
}

/**
 * Everything the household shares. The per-member records (profiles, seen, never,
 * notTonight) have a key for EVERY current member (empty object when nothing yet).
 */
export interface SharedState {
  /** 1..MAX_MEMBERS entries. */
  members: Record<MemberId, Member>;
  profiles: Record<MemberId, Profile>;
  /** Everything each person has watched — the History tab. (Favourites count as seen too; use Engine.hasSeen.) */
  seen: Record<MemberId, Record<string, SeenEntry>>;
  /** itemId -> ms timestamp tapped Never. */
  never: Record<MemberId, Record<string, number>>;
  /** itemId -> local date (YYYY-MM-DD) it was swiped "not tonight". Hidden for that person on that date only. */
  notTonight: Record<MemberId, Record<string, string>>;
  watchlist: WatchlistEntry[];
  /** The Matches tab: solo right-swipes and Together matches, newest first. */
  picks: PickEntry[];
  settings: Settings;
  /** The open Together session, if any (at most one at a time per household). */
  activeSession: TogetherSession | null;
}

/** Member ids in a stable display order (by join time, then id). */
export function memberOrder(members: Record<MemberId, Member>): MemberId[] {
  return Object.values(members)
    .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
    .map((m) => m.id);
}
