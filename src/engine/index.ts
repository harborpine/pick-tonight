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
 */
import type { Engine } from '../contracts';
import { describeTaste } from './insights';
import { correctTaste, defaultProfile, learnFromSwipe } from './learn';
import { onboardingTitles } from './onboarding';
import { buildDeck, rankNewArrivals } from './rank';
import { availableMoods, choosePick, chooseService, hasSeen, isEligible, isNeverHidden } from './rules';

export function createEngine(): Engine {
  return {
    availableMoods,
    chooseService,
    hasSeen,
    isNeverHidden,
    choosePick: (item, req, ctx) => choosePick(item, req, ctx),
    isEligible,
    buildDeck,
    rankNewArrivals,
    defaultProfile,
    learnFromSwipe,
    describeTaste,
    correctTaste,
    onboardingTitles,
  };
}
