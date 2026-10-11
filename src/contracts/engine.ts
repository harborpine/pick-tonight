/**
 * CONTRACT: the picking engine. Pure, synchronous, runs on the phone.
 * No network, no storage, no Date.now() — everything comes in through arguments
 * so results are deterministic and testable.
 * Only the lead edits files in src/contracts/.
 */
import type { Catalog, CatalogItem, MoodId, NewArrival, NewArrivals, PlanSelection, TitleIndex, TitleIndexEntry } from './catalog';
import type {
  DeckCard,
  MemberId,
  Profile,
  ServiceChoice,
  SharedState,
  SuggestRequest,
  SwipeAction,
  WatchPick,
  Who,
} from './state';

/** Everything the engine needs besides the request. */
export interface EngineContext {
  catalog: Catalog;
  /**
   * Only members, profiles, seen, never, notTonight, picks and settings are read.
   * `members` is the whole household (1..MAX_MEMBERS); a request's `who` is a subset of it.
   * The engine must work for ANY household size and ANY non-empty audience.
   */
  state: Pick<SharedState, 'members' | 'profiles' | 'seen' | 'never' | 'notTonight' | 'picks' | 'settings'>;
  /** Local date, YYYY-MM-DD. Used for "not tonight" (hidden only on the date it was swiped). */
  today: string;
}

export interface DeckOptions {
  /** Max cards to return. Default 30. */
  limit?: number;
  /** Item ids to leave out (e.g. cards already dealt when extending a Together deck). */
  exclude?: string[];
  /**
   * Seed for the small amount of variety shuffling among near-equal scores.
   * Same inputs + same seed = same deck. Default 0 = pure score order.
   */
  seed?: number;
}

export interface NewCard extends DeckCard {
  arrival: NewArrival;
}

export interface FollowUp extends DeckCard {
  type: 'new-season' | 'spinoff';
  /** For 'new-season': the season number. */
  season?: number;
  /** The watched title this follows from (itself for 'new-season'). */
  becauseItemId: string;
  /** Plain-language line, e.g. "Season 4 is out" or "A spinoff of Game of Thrones". */
  text: string;
  /** Stable key for "have I shown this yet" tracking, e.g. 'season:tv-136315:4' or 'spinoff:tv-94997'. */
  key: string;
  /** YYYY-MM-DD the season started, when known. */
  date?: string;
}

export interface HistoryRow {
  /** The title text exactly as it appeared in the file. */
  raw: string;
  /** ms timestamp when the file gave a date. */
  at?: number;
}

export interface ParsedHistory {
  format: 'netflix' | 'csv' | 'json' | 'list' | 'unknown';
  rows: HistoryRow[];
}

export interface ImportedTitle {
  entry: TitleIndexEntry;
  /** Number of rows that collapsed into this title (episodes / viewings). */
  plays: number;
  /** Latest date seen for it in the file, when dates were present. */
  lastWatched?: number;
}

export interface ImportResult {
  matched: ImportedTitle[];
  /** Names that could not be matched confidently, most-played first. */
  unmatched: { name: string; plays: number }[];
}

/** One line on the "what it has learned" page. */
export interface TasteInsight {
  /** Stable key, e.g. 'genre:comedy', 'keyword:sitcom', 'trait:dropIn'. Used for corrections. */
  key: string;
  /** Plain-language sentence, e.g. "You lean towards sitcoms". */
  text: string;
  /** Positive = likes, negative = avoids. Magnitude is relative strength, about -1..1. */
  strength: number;
  /** Where it came from: the person's favourites, swipes / imports, or a manual correction. */
  source: 'favorites' | 'learned' | 'corrected';
  /** The manual correction currently applied, if any. */
  correction: 'more' | 'less' | null;
}

export interface Engine {
  // ---- eligibility (the rules that must hold) ----

  /**
   * The moods to offer for this audience. 'scared' is offered only when no
   * watcher has a horror or scary dealbreaker.
   */
  availableMoods(who: Who, ctx: EngineContext): MoodId[];

  /**
   * The household service to send people to for this title under `plans`, or
   * null when the title is not included in any selected plan. When several
   * services carry it, an ad-free one wins.
   */
  chooseService(item: CatalogItem, plans: PlanSelection): ServiceChoice | null;

  /** Favourites count as seen. */
  hasSeen(member: MemberId, itemId: string, ctx: EngineContext): boolean;

  /**
   * True when Never hides this title for this audience: any watcher in `who` tapped
   * Never; and everywhere (any `who`) once EVERY member of the household has tapped Never
   * (in a household of one, that person's Never hides it everywhere).
   */
  isNeverHidden(itemId: string, who: Who, ctx: EngineContext): boolean;

  /**
   * The exact thing to watch for this request, honouring the time limit, or
   * null if nothing about this title fits the time available.
   */
  choosePick(item: CatalogItem, req: SuggestRequest, ctx: EngineContext): { pick: WatchPick; minutes: number } | null;

  /**
   * True when the title is sitting on the Matches tab for any of these watchers
   * (a pick whose `who` shares at least one member with this audience). Such titles are left out
   * of decks, the New feed and follow-ups until the pick is removed or the title is marked watched.
   */
  isPicked(itemId: string, who: Who, ctx: EngineContext): boolean;

  /** True iff the title may appear in a deck for this request (all hard rules pass, and it is not already picked). */
  isEligible(item: CatalogItem, req: SuggestRequest, ctx: EngineContext): boolean;

  // ---- ranking ----

  /**
   * Eligible titles, best first. Never returns an ineligible title.
   * Novelty 'either' leans new: across a deck about EITHER_REWATCH_SHARE of the cards
   * are titles a watcher has seen, spread through the deck rather than bunched; it is a
   * lean, not a rule (fewer when there are few good rewatches, never forced).
   * Time 'any' applies no limit and no length preference.
   */
  buildDeck(req: SuggestRequest, ctx: EngineContext, opts?: DeckOptions): DeckCard[];

  /**
   * The New feed: recent arrivals that are on our plans and not hidden for
   * `who` (dealbreakers and Never apply; seen titles are kept only for new
   * seasons), ranked by taste.
   */
  rankNewArrivals(arrivals: NewArrivals, who: Who, ctx: EngineContext): NewCard[];

  /**
   * "Because you watched…": for the watchers in `who`, (a) shows they have watched whose
   * latest season started AFTER they last watched it (or within the last 60 days when the
   * watch date is unknown, e.g. favourites), and (b) spinoffs / continuations
   * (item.spinoffOf) of titles they have watched that they have not seen themselves.
   * Only titles on our plans that pass dealbreakers, Never and isPicked. Newest / strongest first.
   */
  followUps(who: Who, ctx: EngineContext): FollowUp[];

  // ---- watch-history import (pure text in, structured data out) ----

  /**
   * Read an exported watch-history file or a pasted list. Recognises Netflix's
   * viewing-activity CSV ("Title","Date"), other CSV/TSV exports with a recognisable
   * title column, JSON arrays of objects with a title-like field, and plain text with
   * one title per line. Never throws: unreadable input gives format 'unknown' and no rows.
   */
  parseWatchHistory(text: string, filename?: string): ParsedHistory;

  /**
   * Collapse rows to titles ("Show: Season 2: Episode" -> the show, counting plays) and
   * match them against the lookup by name (case, punctuation, articles, year suffixes and
   * `aka` names tolerated; popularity breaks ties). Nothing is guessed loosely: a name
   * with no confident match is reported as unmatched.
   */
  matchWatchHistory(parsed: ParsedHistory, index: TitleIndex): ImportResult;

  /**
   * Returns an updated COPY of the profile, learning taste from imported titles, weighted by
   * plays (with diminishing returns, so one 200-episode show cannot swamp everything) and
   * bounded like swipe learning. Manual corrections are never overwritten.
   */
  learnFromImport(profile: Profile, matched: ImportedTitle[], catalog: Catalog): Profile;

  /** Find titles by name for "add something I've watched" (best first, at most `limit`). */
  searchTitles(query: string, index: TitleIndex, limit: number): TitleIndexEntry[];

  // ---- profiles and learning ----

  /**
   * An empty starting profile: no favourites, no dealbreakers, no learned taste, not onboarded.
   * Nothing about any particular person is built in — the engine must give sensible,
   * quality-led picks for a profile with NO favourites and NO history, and improve as
   * favourites, imports and swipes arrive.
   */
  emptyProfile(): Omit<Profile, 'id'>;

  /** Returns an updated copy of the profile after a card action. Never mutates. */
  learnFromSwipe(profile: Profile, item: CatalogItem, action: SwipeAction, catalog: Catalog): Profile;

  /** The plain-language summary of a profile's taste, strongest first (about 8-16 lines). */
  describeTaste(profile: Profile, catalog: Catalog): TasteInsight[];

  /** Apply or clear (null) a manual correction. Returns an updated copy. */
  correctTaste(profile: Profile, insightKey: string, correction: 'more' | 'less' | null): Profile;

  /** Popular, widely-known catalog titles for the first-run "tick what you've seen" grid. */
  onboardingTitles(catalog: Catalog, plans: PlanSelection, count: number): CatalogItem[];
}

/** src/engine/index.ts must export: `export function createEngine(): Engine` */
export type CreateEngine = () => Engine;
