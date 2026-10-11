/**
 * CONTRACT: the picking engine. Pure, synchronous, runs on the phone.
 * No network, no storage, no Date.now() — everything comes in through arguments
 * so results are deterministic and testable.
 * Only the lead edits files in src/contracts/.
 */
import type { Catalog, CatalogItem, MoodId, NewArrival, NewArrivals, PlanSelection } from './catalog';
import type {
  DeckCard,
  PersonId,
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
  /** Only profiles, seen, never, notTonight and settings are read. */
  state: Pick<SharedState, 'profiles' | 'seen' | 'never' | 'notTonight' | 'settings'>;
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

/** One line on the "what it has learned" page. */
export interface TasteInsight {
  /** Stable key, e.g. 'genre:comedy', 'keyword:sitcom', 'trait:dropIn'. Used for corrections. */
  key: string;
  /** Plain-language sentence, e.g. "You lean towards sitcoms". */
  text: string;
  /** Positive = likes, negative = avoids. Magnitude is relative strength, about -1..1. */
  strength: number;
  /** Where it came from: seeded favourites, swipes, or a manual correction. */
  source: 'favorites' | 'learned' | 'corrected';
  /** The manual correction currently applied, if any. */
  correction: 'more' | 'less' | null;
}

export interface Engine {
  // ---- eligibility (the rules that must hold) ----

  /**
   * The moods to offer for this audience. 'scared' is offered only when no
   * watcher has a horror or scary dealbreaker (i.e. HG watching alone).
   */
  availableMoods(who: Who, ctx: EngineContext): MoodId[];

  /**
   * The household service to send people to for this title under `plans`, or
   * null when the title is not included in any selected plan. When several
   * services carry it, an ad-free one wins.
   */
  chooseService(item: CatalogItem, plans: PlanSelection): ServiceChoice | null;

  /** Favourites count as seen. */
  hasSeen(person: PersonId, itemId: string, ctx: EngineContext): boolean;

  /**
   * True when Never hides this title for this audience: a solo watcher who
   * tapped Never; anyone's Never for Together; and everywhere (any `who`) once
   * both have tapped Never.
   */
  isNeverHidden(itemId: string, who: Who, ctx: EngineContext): boolean;

  /**
   * The exact thing to watch for this request, honouring the time limit, or
   * null if nothing about this title fits the time available.
   */
  choosePick(item: CatalogItem, req: SuggestRequest, ctx: EngineContext): { pick: WatchPick; minutes: number } | null;

  /** True iff the title may appear in a deck for this request (all hard rules pass). */
  isEligible(item: CatalogItem, req: SuggestRequest, ctx: EngineContext): boolean;

  // ---- ranking ----

  /** Eligible titles, best first. Never returns an ineligible title. */
  buildDeck(req: SuggestRequest, ctx: EngineContext, opts?: DeckOptions): DeckCard[];

  /**
   * The New feed: recent arrivals that are on our plans and not hidden for
   * `who` (dealbreakers and Never apply; seen titles are kept only for new
   * seasons), ranked by taste.
   */
  rankNewArrivals(arrivals: NewArrivals, who: Who, ctx: EngineContext): NewCard[];

  // ---- profiles and learning ----

  /** A fresh profile seeded from catalog.seedFavorites and the spec's dealbreakers. */
  defaultProfile(person: PersonId, catalog: Catalog): Profile;

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
