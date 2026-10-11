/**
 * The picking engine. Pure, synchronous and deterministic: no network, no
 * storage, no clock, no randomness (variety comes only from the `seed` option).
 *
 *   rules.ts        the hard rules (plans, dealbreakers, attention, time, new/rewatch, never)
 *   taste.ts        resemblance to favourites, learned weights, manual corrections
 *   rank.ts         scoring, Together blending, variety, reasons, the New feed
 *   learn.ts        default profiles, learning from swipes, corrections
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
import { correctTaste, defaultProfile, learnFromSwipe } from './learn';
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
    defaultProfile,
    learnFromSwipe,
    describeTaste,
    correctTaste,
    onboardingTitles,
  };
}
