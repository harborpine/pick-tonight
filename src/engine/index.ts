/**
 * The picking engine. Pure, synchronous and deterministic: no network, no
 * storage, no clock, no randomness (variety comes only from the `seed` option).
 * Nothing about any particular person or household is built in: it works for a
 * household of one to four, any audience drawn from it, and any set of services.
 *
 *   rules.ts        the hard rules (plans, never-show-me, attention, time, new/rewatch, never, picked)
 *   taste.ts        resemblance to favourites, learned weights, manual corrections
 *   rank.ts         scoring, cold start, blending for 2-4 watchers, variety, reasons, the New feed
 *   learn.ts        the empty starting profile, learning from swipes, corrections
 *   insights.ts     the plain-language "what it has learned" page
 *   onboarding.ts   the first-run "tick what you've seen" grid
 *   followups.ts    "because you watched…": new seasons and spinoffs
 *   history/        watch-history import: reading files, matching names, learning, title search
 */
import type { Engine } from '../contracts';
import { followUps } from './followups';
import { learnFromImport } from './history/learnImport';
import { matchWatchHistory } from './history/match';
import { parseWatchHistory } from './history/parse';
import { searchTitles } from './history/search';
import { describeTaste } from './insights';
import { correctTaste, emptyProfile, learnFromSwipe } from './learn';
import { onboardingTitles } from './onboarding';
import { buildDeck, rankNewArrivals } from './rank';
import { availableMoods, choosePick, chooseService, hasSeen, isEligible, isNeverHidden, isPicked } from './rules';

export function createEngine(): Engine {
  return {
    availableMoods,
    chooseService,
    hasSeen,
    isNeverHidden,
    choosePick: (item, req, ctx) => choosePick(item, req, ctx),
    isPicked,
    isEligible,
    buildDeck,
    rankNewArrivals,
    followUps,
    parseWatchHistory,
    matchWatchHistory,
    learnFromImport,
    searchTitles,
    emptyProfile,
    learnFromSwipe,
    describeTaste,
    correctTaste,
    onboardingTitles,
  };
}
