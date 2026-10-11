/**
 * RANKING: turns the eligible titles into a deck, best first.
 *
 * How a title is scored for ONE person (all parts 0..1 unless noted):
 *
 *   base  = taste        resemblance to their favourites            (W_TASTE)
 *         + shape        the general kind of thing they love, -1..1 (W_SHAPE)
 *         + learned      what their swipes have taught, -1..1       (W_LEARN)
 *         + quality      rating, discounted when few people voted   (W_QUALITY)
 *         + familiarity  "you've heard of it" (votes, popularity)   (W_POP)
 *         + length fit   how well it uses the time available        (W_LENGTH)
 *         + format fit   suits the viewing type                     (W_FORMAT)
 *
 *   score = base x (MOOD_FLOOR..1 by mood fit)   <- a poor mood fit shrinks everything
 *         + W_MOOD x mood fit                    <- and a good one adds on top
 *         + novelty adjustment (rewatch-vs-new, see noveltyAdjust)
 *         + manual corrections (W_CORRECTION each, capped)
 *         - acquired tastes they haven't shown (anime, kids' shows; see taste.nichePenalty)
 *
 * Together: each person is scored separately and blended with a "least
 * misery" rule — mostly the LOWER of the two scores — because a match needs
 * two yeses. A title one of them loves and the other is lukewarm on loses to
 * one they both like.
 *
 * Mood: when enough titles genuinely fit the requested mood, titles with no
 * fit are dropped outright rather than ranked low.
 *
 * Genre craving: titles with the craved genre ALWAYS come before titles
 * without it. Others are only used to fill the end of the deck, so a craving
 * with few matches still gives something to swipe.
 *
 * Variety: the final order is built greedily, nudging down a title that is
 * very like the few just before it (same genres / format / service / related).
 * A non-zero seed adds a small deterministic shuffle among near-equal scores.
 *
 * New / rewatch / either: "new" and "rewatch" are hard rules (rules.ts).
 * "Either" leans new: the deck is the NEW deck with about one card in ten
 * (EITHER_REWATCH_SHARE) given to a good rewatch — see dealEither.
 *
 * Time "any": no limit and no opinion about length (every title gets the same
 * length credit), unlike "2+ hrs", which favours things that use the evening.
 */
import {
  EITHER_REWATCH_SHARE,
  GENRES,
  TIME_LIMIT_MINUTES,
  watchers,
  type CatalogItem,
  type DeckCard,
  type DeckOptions,
  type EngineContext,
  type MoodId,
  type NewArrivals,
  type NewCard,
  type PersonId,
  type ServiceChoice,
  type SuggestRequest,
  type WatchPick,
  type Who,
} from '../contracts';
import { getIndex, sameTitleKey, type CatalogIndex, type ItemInfo } from './catalogIndex';
import { GENRE_NOUNS } from './phrases';
import {
  attentionOk,
  chooseService,
  hasSeen,
  hitsDealbreaker,
  isNeverHidden,
  isNotTonight,
  pickedIds,
  pickFor,
  scaredOffered,
  type PickResult,
} from './rules';
import {
  OWN_FAVOURITE_TASTE,
  correctionDelta,
  nichePenalty,
  traitFit,
  getFavModel,
  learnedScore,
  learnedView,
  type FavMatch,
  type FavModel,
  type LearnedView,
} from './taste';
import { clamp, hash01, round4 } from './util';

// ---- weights (tuned with src/engine/dev/review.ts) -------------------------
const W_TASTE = 0.5;
const W_LEARN = 0.3;
const W_SHAPE = 0.14;
const W_QUALITY = 0.18;
const W_POP = 0.12;
const W_LENGTH = 0.16;
const W_FORMAT = 0.05;
const W_MOOD = 0.4;
const MOOD_FLOOR = 0.25;
const W_CORRECTION = 0.3;
const CORRECTION_CAP = 0.5;
/** Together: weight on the less keen person's score. */
const TOGETHER_MIN_WEIGHT = 0.78;
/** Mood: drop titles under MOOD_DROP_BELOW when at least MOOD_POOL titles reach MOOD_GOOD. */
const MOOD_GOOD = 0.4;
const MOOD_DROP_BELOW = 0.2;
const MOOD_POOL = 12;
/** With at least MOOD_FEW good fits, titles whose fit (incl. neighbouring moods) is under MOOD_NOTHING go. */
const MOOD_FEW = 3;
const MOOD_NOTHING = 0.2;
/** Size of the random nudge a non-zero seed adds. */
const SEED_JITTER = 0.045;
const DEFAULT_LIMIT = 30;
/** Time "any": the same length credit for everything, so length cannot affect the order. */
const ANY_LENGTH_FIT = 0.8;

// ---- "either": the lean towards new ----------------------------------------
/** One rewatch slot per this many cards (10 for a share of 0.1). */
const REWATCH_EVERY = Math.max(2, Math.round(1 / EITHER_REWATCH_SHARE));
/** Where in each run of REWATCH_EVERY cards the rewatch may sit (0-based): never the first two, never the last. */
const REWATCH_SLOT_FROM = 2;
const REWATCH_SLOT_TO = REWATCH_EVERY - 2;
const REWATCH_SLOT_DEFAULT = Math.min(REWATCH_SLOT_TO, 4);
/**
 * A rewatch is only dealt if the title is GOOD for this request: judged as if
 * it were new (taste, mood, quality, length — everything but the fact that
 * they've seen it), it must score at least as well as the REWATCH_BAR_DEPTH-th
 * best new title (the kind of title that would be in the first couple of
 * decks anyway), give or take REWATCH_SLACK.
 */
const REWATCH_BAR_DEPTH = 60;
const REWATCH_SLACK = 0.03;
/** With a seed, which of the good rewatches get the slots rotates by about this much score. */
const REWATCH_JITTER = 0.12;

/**
 * When a title has nothing for the requested mood, a neighbouring mood earns
 * partial credit (so "want to laugh" falls back to feel-good before thrillers).
 */
const MOOD_NEIGHBOURS: Record<MoodId, Partial<Record<MoodId, number>>> = {
  laugh: { feelgood: 0.6, brainoff: 0.4, cozy: 0.4 },
  cozy: { feelgood: 0.7, brainoff: 0.5, laugh: 0.4, romantic: 0.3 },
  brainoff: { laugh: 0.6, cozy: 0.6, feelgood: 0.4 },
  gripped: { hyped: 0.6, think: 0.4, scared: 0.3 },
  feelgood: { cozy: 0.7, laugh: 0.6, romantic: 0.4 },
  think: { gripped: 0.5, cry: 0.2 },
  romantic: { feelgood: 0.4, cry: 0.4, cozy: 0.4 },
  scared: {}, // nothing stands in for scary
  cry: { romantic: 0.5, think: 0.3 },
  hyped: { gripped: 0.6 },
};
const NEIGHBOUR_CREDIT = 0.4;

/** Moods where an old favourite is exactly what's wanted. */
const COMFORT_MOODS = new Set<MoodId>(['cozy', 'brainoff', 'laugh', 'feelgood']);

const MOOD_REASONS: Record<MoodId, string> = {
  laugh: 'Reliably funny',
  cozy: 'Pure comfort viewing',
  brainoff: 'Easy watching, no effort needed',
  gripped: 'Hard to stop watching',
  feelgood: 'Leaves you smiling',
  think: 'Gives you something to think about',
  romantic: 'Properly romantic',
  scared: 'Genuinely creepy',
  cry: 'Good for a proper cry',
  hyped: 'Big, loud and exciting',
};

// ---------------------------------------------------------------------------
// Request-independent pieces
// ---------------------------------------------------------------------------

/**
 * raw  = the catalog's fit for the requested mood (used for the keep/drop gates);
 * near = raw, or partial credit from a neighbouring mood (also a gate);
 * eff  = what scoring uses: `near` on MOOD_CURVE, which is close to a straight
 *        line. (An earlier catalog had crude mood tags and needed the top of
 *        the scale flattened; the tags are now trustworthy, so 0.7 vs 0.95
 *        counts for what it says. The catalog tops out at 0.95, treated as full.)
 */
/** [catalog mood fit, value used for scoring], joined by straight lines. */
const MOOD_CURVE: [number, number][] = [
  [0, 0],
  [0.3, 0.25],
  [0.5, 0.5],
  [0.7, 0.72],
  [0.85, 0.89],
  [0.95, 1],
  [1, 1],
];
function moodCurve(x: number): number {
  for (let k = 1; k < MOOD_CURVE.length; k++) {
    const [x1, y1] = MOOD_CURVE[k];
    if (x <= x1) {
      const [x0, y0] = MOOD_CURVE[k - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}

function moodFit(item: CatalogItem, mood: MoodId): { raw: number; near: number; eff: number } {
  const raw = clamp(item.moods?.[mood] ?? 0);
  let best = 0;
  const neighbours = MOOD_NEIGHBOURS[mood];
  for (const m in neighbours) {
    const v = (item.moods?.[m as MoodId] ?? 0) * (neighbours[m as MoodId] ?? 0);
    if (v > best) best = v;
  }
  const near = Math.max(raw, NEIGHBOUR_CREDIT * clamp(best));
  return { raw, near, eff: moodCurve(near) };
}

/**
 * How well this pick uses the time available, 0..1.
 * A single sitting that fills the slot is ideal. Series get partial credit for
 * "watch a few": several sitcom episodes do fill an hour, but a 22-minute
 * sitcom is a fine-not-ideal answer to "2+ hrs", where films fit best.
 */
function lengthFit(item: CatalogItem, minutes: number, req: SuggestRequest): number {
  if (req.time === 'any') return ANY_LENGTH_FIT; // "I don't care": no preference at all
  const target = req.time === 120 ? 100 : req.time === 20 ? 21 : req.time;
  const single = Math.min(1, minutes / target);
  let fit = single;
  if (item.kind === 'tv') {
    const cap = req.time === 120 ? 130 : TIME_LIMIT_MINUTES[req.time];
    const several = Math.min(1, (Math.floor(cap / minutes) * minutes) / target);
    const severalShare = req.time === 120 ? 0.3 : item.dropIn ? 0.5 : 0.4;
    fit = (1 - severalShare) * single + severalShare * several;
    // With a whole evening, an hour-long drama you can settle into is a real answer.
    if (req.time === 120 && minutes >= 40) fit = Math.max(fit, 0.75);
  } else if (minutes > 165) {
    fit = 0.85; // very long films are a commitment even with 2+ hrs
  }
  return fit;
}

/**
 * Suits the viewing type, 0..1. Focused: something that rewards attention gets
 * a small edge. Background / eating (identical): drop-in shows are ideal, a
 * story you have to follow in order is less so.
 */
function formatFit(item: CatalogItem, req: SuggestRequest): number {
  if (req.viewing === 'focused') return item.attention === 'low' ? 0.6 : 1;
  if (item.kind === 'tv') return item.dropIn ? 1 : 0.45;
  return 0.5;
}

/**
 * How good a REWATCH something already seen makes, as a score adjustment.
 * "Either": used to choose and to vet the roughly-one-in-ten rewatch cards.
 * A story you'd be repeating is marked down heavily, a drop-in show lightly —
 * except in comfort moods (cozy, brain-off, laugh, feel-good), where an old
 * favourite is a great answer.
 * "Rewatch": favourites and drop-in shows rewatch best.
 */
function noveltyAdjust(item: CatalogItem, seen: boolean, isFav: boolean, req: SuggestRequest): number {
  if (!seen) return 0;
  const comfort = COMFORT_MOODS.has(req.mood);
  const easyRewatch = item.kind === 'tv' && item.dropIn;
  if (req.novelty === 'rewatch') return (isFav ? 0.08 : 0) + (easyRewatch ? 0.04 : 0);
  if (isFav) return comfort ? (easyRewatch ? 0.02 : -0.06) : easyRewatch ? -0.1 : -0.2;
  return comfort ? (easyRewatch ? -0.02 : -0.1) : easyRewatch ? -0.1 : -0.18;
}

// ---------------------------------------------------------------------------
// Per-person scoring
// ---------------------------------------------------------------------------

export interface PersonCtx {
  person: PersonId;
  fav: FavModel;
  view: LearnedView;
}

export function personCtx(person: PersonId, ctx: EngineContext): PersonCtx {
  const profile = ctx.state.profiles?.[person];
  return { person, fav: getFavModel(ctx.catalog, profile?.favorites), view: learnedView(profile?.taste) };
}

/** Taste + learning + corrections for one person; the request-independent half. */
function tasteParts(info: ItemInfo, p: PersonCtx, index: CatalogIndex): { taste: number; shape: number; learned: number; corr: number; isFav: boolean } {
  const isFav = p.fav.favIds.has(info.item.id);
  // Their own favourite is to their taste whatever anyone else rated it; for everything
  // else, resemblance counts only as far as the title's rating can be trusted.
  const taste = isFav ? Math.max(OWN_FAVOURITE_TASTE, p.fav.score[info.idx]) : p.fav.score[info.idx] * info.trust;
  // Manual corrections outrank learning: on a title they asked for less of,
  // nothing learned may count in its favour (and the reverse for "more").
  const delta = correctionDelta(info, p.view);
  let learned = learnedScore(info, p.view, index);
  if (delta < 0) learned = Math.min(0, learned);
  else if (delta > 0) learned = Math.max(0, learned);
  return {
    taste,
    shape: isFav ? 0 : traitFit(info, p.fav),
    learned,
    corr: clamp(W_CORRECTION * delta, -CORRECTION_CAP, CORRECTION_CAP) + nichePenalty(info, p.fav, p.view),
    isFav,
  };
}

function blend(scores: number[]): number {
  if (scores.length === 1) return scores[0];
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  return TOGETHER_MIN_WEIGHT * lo + (1 - TOGETHER_MIN_WEIGHT) * hi;
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

/** A favourite must resemble the title at least this much to be named as a reason. */
const REASON_SIM = 0.3;

interface ReasonInput {
  info: ItemInfo;
  people: PersonCtx[];
  req: SuggestRequest | null;
  pick: WatchPick;
  moodRaw: number;
}

export function buildReasons({ info, people, req, pick, moodRaw }: ReasonInput): string[] {
  const item = info.item;
  const out: { text: string; w: number }[] = [];
  const solo = people.length === 1;

  // 1. It IS a favourite.
  const favOf = people.filter((p) => p.fav.favIds.has(item.id));
  if (favOf.length) {
    if (solo) out.push({ text: 'One of your favourites', w: 2 });
    else if (favOf.length === people.length) out.push({ text: 'A favourite for both of you', w: 2 });
    else out.push({ text: `One of ${favOf[0].person}'s favourites`, w: 1.6 });
  }

  // 2. It resembles favourites.
  //    (Not for someone whose favourite it already is: "one of your favourites" says it all.)
  const per = people.map((p) => ({
    p,
    m: p.fav.favIds.has(item.id) ? [] : (p.fav.matches[info.idx] ?? []).filter((x) => x.sim >= REASON_SIM),
  }));
  if (solo) {
    const m = per[0].m;
    if (m.length >= 2 && m[1].sim >= m[0].sim * 0.7) out.push({ text: `Like ${m[0].title} and ${m[1].title}`, w: 0.6 + m[0].sim });
    else if (m.length) out.push({ text: `Because you love ${m[0].title}`, w: 0.55 + m[0].sim });
  } else {
    // A favourite they share is the most persuasive thing we can say to two people.
    let sharedBest: FavMatch | null = null;
    for (const q of per) {
      for (const x of q.m) {
        if (per.every((o) => o.p.fav.favIds.has(x.favId)) && (!sharedBest || x.sim > sharedBest.sim)) sharedBest = x;
      }
    }
    if (sharedBest) out.push({ text: `Because you both love ${sharedBest.title}`, w: 0.7 + sharedBest.sim });
    for (const q of per) {
      const m = q.m.find((x) => x.favId !== sharedBest?.favId && !per.every((o) => o.p.fav.favIds.has(x.favId)));
      if (m) out.push({ text: `Because ${q.p.person} loves ${m.title}`, w: 0.45 + m.sim });
    }
  }

  // 3. They asked for more of this / have been saying yes to this.
  for (const p of people) {
    for (const g of item.genres) {
      if (p.view.corrected.genres.get(g) === 1) out.push({ text: `You asked for more ${GENRE_NOUNS[g]}`, w: 0.8 });
      else if (solo && !p.view.corrected.genres.has(g) && p.view.genre(g) >= 0.25) {
        // Say where the opinion came from: their watch history, or their swipes.
        const fromHistory = p.view.imported.genre(g) > p.view.genre(g) / 2;
        out.push({ text: `${fromHistory ? 'You watch a lot of' : "You've been saying yes to"} ${GENRE_NOUNS[g]}`, w: 0.5 + 0.3 * p.view.genre(g) });
      }
    }
  }

  if (req) {
    // 4. The craving, the mood, the situation.
    if (req.genre && item.genres.includes(req.genre)) out.push({ text: `${GENRES[req.genre]}, like you asked`, w: 0.62 });
    if (moodRaw >= 0.75) out.push({ text: MOOD_REASONS[req.mood], w: 0.3 + 0.35 * moodRaw });
    if (req.viewing !== 'focused') {
      if (item.kind === 'tv' && item.dropIn) out.push({ text: 'Easy to drop into', w: 0.58 });
      else out.push({ text: 'Easy to follow while you do other things', w: 0.4 });
    }
  }
  if (pick.type === 'episode') out.push({ text: 'A standout episode that works on its own', w: 0.6 });
  if (info.bayes >= 8.2 && item.votes >= 400) out.push({ text: 'Highly rated', w: 0.35 });

  out.sort((a, b) => b.w - a.w || (a.text < b.text ? -1 : 1));
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const r of out) {
    if (seen.has(r.text)) continue;
    seen.add(r.text);
    reasons.push(r.text);
    if (reasons.length === 3) break;
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// buildDeck
// ---------------------------------------------------------------------------

interface Candidate {
  info: ItemInfo;
  service: ServiceChoice;
  pick: PickResult;
  score: number;
  /** The score with no allowance for having seen it: how good the title is for this request in itself. */
  merit: number;
  moodRaw: number;
  moodEff: number;
  seen: boolean;
  craved: boolean;
}

export function buildDeck(req: SuggestRequest, ctx: EngineContext, opts: DeckOptions = {}): DeckCard[] {
  const limit = Math.max(0, Math.floor(opts.limit ?? DEFAULT_LIMIT));
  if (limit === 0) return [];
  // Rule 2: a scared request from an audience that isn't offered it gets nothing.
  if (req.mood === 'scared' && !scaredOffered(req.who, ctx)) return [];

  const index = getIndex(ctx.catalog);
  const seed = opts.seed ?? 0;
  const exclude = opts.exclude?.length ? new Set(opts.exclude) : null;
  const who = req.who;
  const people = watchers(who).map((p) => personCtx(p, ctx));
  const plans = ctx.state.settings?.plans;
  const timeLimit = TIME_LIMIT_MINUTES[req.time] ?? 0;
  const picked = pickedIds(who, ctx);

  const cands: Candidate[] = [];
  let goodMood = 0;
  let goodMoodCraved = 0;

  for (const info of index.infos) {
    const item = info.item;
    const id = item.id;
    // ---- hard rules (cheapest first); mirrors rules.isEligible ----
    if (exclude?.has(id)) continue;
    if (!attentionOk(item, req)) continue; // rule 3
    if (hitsDealbreaker(item, who, ctx)) continue; // rule 2
    if (isNeverHidden(id, who, ctx)) continue; // rule 7
    if (isNotTonight(id, who, ctx)) continue;
    if (picked.has(id)) continue; // already on the Matches tab
    const seenFlags = people.map((p) => hasSeen(p.person, id, ctx));
    const seenAny = seenFlags.includes(true);
    if (req.novelty === 'new' && seenAny) continue; // rule 5
    if (req.novelty === 'rewatch' && !seenAny) continue; // rule 5
    const pick = pickFor(item, timeLimit, !seenFlags.includes(false), seed); // rule 4
    if (!pick) continue;
    const service = chooseService(item, plans); // rules 1 and 6
    if (!service) continue;

    // ---- score ----
    const mood = moodFit(item, req.mood);
    const shared =
      W_QUALITY * info.quality + W_POP * info.pop + W_LENGTH * lengthFit(item, pick.minutes, req) + W_FORMAT * formatFit(item, req);
    const moodMul = MOOD_FLOOR + (1 - MOOD_FLOOR) * mood.eff;
    const plain: number[] = [];
    const scores = people.map((p, k) => {
      const t = tasteParts(info, p, index);
      const base = W_TASTE * t.taste + W_SHAPE * t.shape + W_LEARN * t.learned + shared;
      plain.push(base * moodMul + W_MOOD * mood.eff + t.corr);
      return plain[k] + noveltyAdjust(item, seenFlags[k], t.isFav, req);
    });
    const jitter = seed !== 0 ? (hash01(seed, id) - 0.5) * SEED_JITTER : 0;
    const score = blend(scores) + jitter;
    const merit = seenAny ? blend(plain) + jitter : score;

    const craved = !!req.genre && item.genres.includes(req.genre);
    if (mood.raw >= MOOD_GOOD) {
      goodMood++;
      if (craved) goodMoodCraved++;
    }
    cands.push({ info, service, pick, score, merit, moodRaw: mood.raw, moodEff: mood.near, seen: seenAny, craved });
  }

  const byScore = (a: Candidate, b: Candidate) => b.score - a.score || (a.info.item.id < b.info.item.id ? -1 : 1);
  const deal = (sorted: Candidate[], max: number, startAt: number): Candidate[] =>
    req.novelty === 'either' ? dealEither(sorted, max, startAt, seed, index) : diversify(sorted, max, index);

  let ordered: Candidate[];
  if (req.genre) {
    // Craving: matching titles first, always. The rest only fill what's left.
    const yes = cands.filter((c) => c.craved);
    const no = cands.filter((c) => !c.craved);
    const first = deal(oneEach(dropPoorMood(yes, goodMoodCraved, req.mood).sort(byScore)), limit, 0);
    const rest =
      first.length < limit ? deal(oneEach(dropPoorMood(no, goodMood, req.mood).sort(byScore)), limit - first.length, first.length) : [];
    // Keep reported scores honest about the tiers: fillers always score below matches.
    if (first.length && rest.length) {
      const floor = Math.min(...first.map((c) => c.score)) - 0.02;
      const top = Math.max(...rest.map((c) => c.score));
      if (top > floor) for (const c of rest) c.score -= top - floor;
    }
    ordered = first.concat(rest);
  } else {
    ordered = deal(oneEach(dropPoorMood(cands, goodMood, req.mood).sort(byScore)), limit, 0);
  }

  // Report scores that never rise down the deck, so "higher is better" matches the order.
  let prev = Number.POSITIVE_INFINITY;
  return ordered.map((c) => {
    prev = Math.min(prev, round4(c.score));
    return {
      itemId: c.info.item.id,
      pick: c.pick.pick,
      service: c.service,
      minutes: c.pick.minutes,
      score: prev,
      reasons: buildReasons({ info: c.info, people, req, pick: c.pick.pick, moodRaw: c.moodRaw }),
    };
  });
}

/**
 * The mood must be respected:
 *  - plenty of titles suit it  -> everything that doesn't is dropped;
 *  - only a few suit it        -> titles with nothing for the mood OR any
 *                                 neighbouring mood are dropped (a short,
 *                                 on-mood deck beats one padded with noise);
 *  - almost nothing suits it   -> keep everything, best fit first, rather
 *                                 than show an empty screen.
 * Scared is stricter: nothing stands in for scary, so only scary titles, ever.
 */
function dropPoorMood(cands: Candidate[], goodCount: number, mood: MoodId): Candidate[] {
  if (mood === 'scared' || goodCount >= MOOD_POOL) return cands.filter((c) => c.moodRaw >= MOOD_DROP_BELOW);
  if (goodCount >= MOOD_FEW) return cands.filter((c) => c.moodEff >= MOOD_NOTHING);
  return cands;
}

/** The catalog sometimes lists one show twice; keep only the better-scoring entry (input is best-first). */
function oneEach(sorted: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return sorted.filter((c) => {
    const key = sameTitleKey(c.info.item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Greedy re-ordering for variety. At each position take the best remaining
 * title after marking down those too similar to the last few chosen. The
 * mark-downs are small, so this only reshuffles titles that were close anyway —
 * it can never lift a poor title over a good one.
 */
function diversify(sorted: Candidate[], limit: number, index: CatalogIndex): Candidate[] {
  const pool = sorted.slice(0, Math.max(limit * 4, 120));
  const out: Candidate[] = [];
  let run = 0; // how many of the latest picks in a row are the same kind (film / series)
  const WINDOW = 5;
  while (out.length < limit && pool.length) {
    let bestK = 0;
    let bestAdj = Number.NEGATIVE_INFINITY;
    // Only the head of the pool can win: the penalty is at most ~0.2.
    const head = pool[0].score;
    for (let k = 0; k < pool.length; k++) {
      const c = pool[k];
      if (c.score < head - 0.35) break;
      let adj = c.score;
      let decay = 1;
      for (let j = out.length - 1; j >= 0 && j >= out.length - WINDOW; j--) {
        adj -= decay * alike(c, out[j], index);
        decay *= 0.65;
      }
      // A long unbroken run of series (or of films) makes the other kind a little more welcome.
      if (run >= 3 && c.info.item.kind === out[out.length - 1].info.item.kind) adj -= Math.min(0.08, 0.02 * (run - 2));
      if (adj > bestAdj) {
        bestAdj = adj;
        bestK = k;
      }
    }
    const [chosen] = pool.splice(bestK, 1);
    run = out.length && out[out.length - 1].info.item.kind === chosen.info.item.kind ? run + 1 : 1;
    out.push(chosen);
  }
  return out;
}

/**
 * "EITHER" = A LEAN TOWARDS NEW. The deck is the deck of NEW titles, with one
 * card in every REWATCH_EVERY (ten) given over to something a watcher has
 * already seen (Together: either of them).
 *
 *  - Where: one slot per run of ten cards, somewhere in the middle of the run
 *    (never the first two cards or the last one), so rewatches are spread
 *    through the deck rather than bunched. The seed moves the slot around.
 *  - Only good ones: the title must clear the bar described at REWATCH_BAR_DEPTH.
 *  - Which: of those, the best REWATCHES for this request, best first — scored
 *    like everything else, plus noveltyAdjust's view of how well each one
 *    rewatches in this mood (a favourite sitcom on a cozy night beats a
 *    thriller whose ending they know). With a seed, near-equal ones take turns.
 *    If fewer clear it than there are slots, the spare slots simply go to new
 *    titles: a rewatch is never forced in.
 *  - Never more than the slots, however many good rewatches there are.
 *  - The one exception: when there is nothing new at all to offer, the deck is
 *    made of rewatches rather than being empty.
 *
 * `startAt` is the position in the whole deck of this run's first card (the
 * craving filler tier starts part-way down), so slots are counted across the
 * whole deck. Input is best-first, already de-duplicated and mood-filtered.
 */
function dealEither(sorted: Candidate[], limit: number, startAt: number, seed: number, index: CatalogIndex): Candidate[] {
  const fresh: Candidate[] = [];
  const seenBefore: Candidate[] = [];
  for (const c of sorted) (c.seen ? seenBefore : fresh).push(c);
  if (!fresh.length) return diversify(seenBefore, limit, index);
  const freshDeck = diversify(fresh, limit, index);
  if (!seenBefore.length) return freshDeck;

  const bar = fresh[Math.min(fresh.length, REWATCH_BAR_DEPTH) - 1].score - REWATCH_SLACK;
  const laneScore = (c: Candidate) => c.score + (seed !== 0 ? (hash01(seed, `rewatch:${c.info.item.id}`) - 0.5) * REWATCH_JITTER : 0);
  const rewatches = seenBefore
    .filter((c) => c.merit >= bar)
    .map((c) => ({ c, s: laneScore(c) }))
    .sort((a, b) => b.s - a.s || (a.c.info.item.id < b.c.info.item.id ? -1 : 1));

  const out: Candidate[] = [];
  let f = 0;
  let r = 0;
  while (out.length < limit) {
    const pos = startAt + out.length;
    // (Only between new cards: never before the first one or after the last.)
    if (r < rewatches.length && f > 0 && f < freshDeck.length && pos % REWATCH_EVERY === rewatchSlot(Math.floor(pos / REWATCH_EVERY), seed)) {
      // Report a score that fits where the card sits, so one rewatch cannot drag down the cards after it.
      const c = rewatches[r++].c;
      const next = freshDeck[f].score;
      out.push({ ...c, score: Math.max(c.score, next) });
    } else if (f < freshDeck.length) {
      out.push(freshDeck[f++]);
    } else {
      break;
    }
  }
  return out;
}

/** Which card (0-based) of the `run`-th run of ten is the rewatch slot. Seed 0 = always the fifth card. */
function rewatchSlot(run: number, seed: number): number {
  if (seed === 0) return REWATCH_SLOT_DEFAULT;
  const span = REWATCH_SLOT_TO - REWATCH_SLOT_FROM + 1;
  return REWATCH_SLOT_FROM + (Math.floor(hash01(seed, `rewatch-slot:${run}`) * span) % span);
}

/** 0..~0.07: how much two titles feel like "the same thing again". */
function alike(a: Candidate, b: Candidate, index: CatalogIndex): number {
  const x = a.info.item;
  const y = b.info.item;
  let p = 0;
  // Genres weighted by rarity: two animated comedies are far more alike than two "comedies".
  let sharedG = 0;
  for (const g of x.genres) if (y.genres.includes(g)) sharedG += index.genreWeight(g);
  const unionG = a.info.genreWeightSum + b.info.genreWeightSum - sharedG;
  if (unionG > 0) p += 0.06 * (sharedG / unionG);
  if (x.kind === y.kind && x.dropIn === y.dropIn) p += 0.012;
  if (a.service.serviceId === b.service.serviceId) p += 0.008;
  if ((x.related ?? []).includes(y.id) || (y.related ?? []).includes(x.id)) p += 0.02;
  return p;
}

// ---------------------------------------------------------------------------
// The New feed
// ---------------------------------------------------------------------------

/**
 * Taste-only score (no mood, no time) used by the New feed and the follow-ups.
 * `following[k]` = person k already watches this show and this is news about it.
 */
export function feedScore(info: ItemInfo, people: PersonCtx[], index: CatalogIndex, following: boolean[]): number {
  const scores = people.map((p, k) => {
    const t = tasteParts(info, p, index);
    return W_TASTE * t.taste + W_SHAPE * t.shape + W_LEARN * t.learned + W_QUALITY * info.quality + W_POP * info.pop + t.corr + (following[k] ? 0.12 : 0);
  });
  return round4(blend(scores));
}

/**
 * Recent arrivals, ranked by taste. No mood or time limits apply. Kept only if
 * the title is in the catalog, on our plans, clear of dealbreakers and Never,
 * not already on the Matches tab (and not swiped "not tonight" today). Titles a watcher has already seen are
 * dropped unless the arrival is a new season. If a title is listed twice, the
 * first (newest) entry wins.
 */
export function rankNewArrivals(arrivals: NewArrivals, who: Who, ctx: EngineContext): NewCard[] {
  const index = getIndex(ctx.catalog);
  const people = watchers(who).map((p) => personCtx(p, ctx));
  const plans = ctx.state.settings?.plans;
  const done = new Set<string>();
  const cards: NewCard[] = [];
  const picked = pickedIds(who, ctx);

  for (const arrival of arrivals?.entries ?? []) {
    const info = index.byId.get(arrival.itemId);
    if (!info || done.has(sameTitleKey(info.item))) continue;
    const item = info.item;
    const service = chooseService(item, plans);
    if (!service) continue;
    if (hitsDealbreaker(item, who, ctx)) continue;
    if (isNeverHidden(item.id, who, ctx)) continue;
    if (isNotTonight(item.id, who, ctx)) continue;
    if (picked.has(item.id)) continue;
    const seenFlags = people.map((p) => hasSeen(p.person, item.id, ctx));
    const isSeason = arrival.type === 'season';
    if (seenFlags.includes(true) && !isSeason) continue;
    // A new season is about the new episodes, so don't point at an old standout episode.
    const pick = pickFor(item, Number.POSITIVE_INFINITY, !seenFlags.includes(false), 0, !isSeason);
    if (!pick) continue;
    done.add(sameTitleKey(item));

    // A new season of something they already watch is the best news the feed can carry.
    const score = feedScore(info, people, index, people.map((_, k) => isSeason && seenFlags[k]));
    cards.push({
      itemId: item.id,
      pick: pick.pick,
      service,
      minutes: pick.minutes,
      score,
      reasons: buildReasons({ info, people, req: null, pick: pick.pick, moodRaw: 0 }),
      arrival,
    });
  }
  return cards.sort((a, b) => b.score - a.score || (a.arrival.date < b.arrival.date ? 1 : a.arrival.date > b.arrival.date ? -1 : a.itemId < b.itemId ? -1 : 1));
}
