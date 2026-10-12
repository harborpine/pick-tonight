/**
 * FOLLOW-UPS: "because you watched…" cards for the top of the New tab.
 *
 * Two kinds, one card per title at most:
 *
 *  NEW SEASON — a show a watcher has watched (on their watched list, or a
 *    favourite) has a newer season than they have seen:
 *      - the season started within the last NEW_SEASON_DAYS (120) days, and
 *      - it started AFTER the date they last watched the show.
 *    When we don't know when they last watched it (favourites, and watched
 *    entries with no real date), the window is tighter instead: only seasons
 *    that started in the last UNDATED_DAYS (60) days.
 *
 *  SPINOFF — the title is a spinoff / continuation (item.spinoffOf) of
 *    something a watcher has watched, and nobody watching has seen the spinoff.
 *
 * Both kinds obey the usual gates: on our plans, nobody's never-show-me choices, not Never,
 * not already on the Matches tab, and not swiped "not tonight" today (the same
 * gates as the New feed they sit above).
 *
 * Order: fresh news first (a season that has just started), newest first;
 * then the evergreen spinoffs, best taste match first. Within each of those,
 * for a group, things MORE of them have watched come before things fewer have
 * (what everyone watched first).
 *
 * Wording: alone it is just "Season 4 is out"; for a group it says whose show
 * it is — "you both watched this" / "all three of you watched this" when it is
 * everyone's, otherwise by name ("one of Sam's shows", "Alex and Sam both
 * watched this"). Member ids are never shown.
 *
 * Dates: an air date is a calendar day (YYYY-MM-DD) and "last watched" is a
 * timestamp, which is read as its UTC calendar day. So a show watched late in
 * the evening can count as watched "the next day"; the error is one day at
 * most and errs towards NOT announcing a season they may already have started.
 */
import { watchers, type EngineContext, type FollowUp, type Who } from '../contracts';
import { getIndex, sameTitleKey } from './catalogIndex';
import { allOfYou, namedSubject, possessive } from './phrases';
import { buildReasons, feedScore, watching, type PersonCtx } from './rank';
import { audienceDealbreakers, breaksAny, chooseService, isNotTonight, neverChecker, pickedIds, pickFor, watchedAt } from './rules';

/** A new season is news for this long after it starts... */
export const NEW_SEASON_DAYS = 120;
/** ...or only this long when we don't know when they last watched the show. */
export const UNDATED_DAYS = 60;

const DAY_MS = 86_400_000;

/** Days since 1970 for a YYYY-MM-DD date, or null if it isn't one. */
function dayNumber(date: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round(t / DAY_MS) : null;
}

interface Ranked {
  card: FollowUp;
  /** For a group: how many of the watchers it is about (0 when watching alone, so it never affects the order). */
  shared: number;
  /** Day number of the news, when it is fresh; null for evergreen spinoffs. */
  news: number | null;
}

export function followUps(who: Who, ctx: EngineContext): FollowUp[] {
  const audience = watchers(who);
  if (!audience.length) return [];
  const today = dayNumber(ctx.today);
  const index = getIndex(ctx.catalog);
  const people = watching(who, ctx);
  const plans = ctx.state.settings?.plans;
  const picked = pickedIds(who, ctx);
  const breakers = audienceDealbreakers(who, ctx);
  const neverHidden = neverChecker(who, ctx);
  const together = people.length > 1;
  const out: Ranked[] = [];
  const done = new Set<string>();

  /** The name of a title that may not be in the catalog: from the catalog, a watcher's favourites, or their watched list. */
  const titleOf = (id: string): string | null => {
    const known = index.byId.get(id)?.item.title;
    if (known) return known;
    for (const p of people) {
      const fav = p.fav.favs.find((f) => f.id === id);
      if (fav && fav.title !== 'a favourite') return fav.title;
    }
    for (const p of audience) {
      const snap = (ctx.state.seen?.[p]?.[id] as { snapshot?: { title?: string } } | undefined)?.snapshot?.title;
      if (snap) return snap;
    }
    return null;
  };
  /** "you both" / "all three of you" when it is everyone watching, otherwise their names. */
  const whoWatched = (fans: PersonCtx[]): string => (fans.length === people.length ? allOfYou(people.length) : namedSubject(fans.map((p) => p.name)));

  for (const info of index.infos) {
    const item = info.item;
    const hasSeason = item.kind === 'tv' && !!item.latestSeason;
    const parents = item.spinoffOf ?? [];
    if (!hasSeason && !parents.length) continue;

    // ---- the usual gates ----
    const service = chooseService(item, plans);
    if (!service) continue;
    if (breaksAny(item, breakers)) continue;
    if (neverHidden(item.id)) continue;
    if (isNotTonight(item.id, who, ctx)) continue;
    if (picked.has(item.id)) continue;
    const key = sameTitleKey(item);
    if (done.has(key)) continue;

    const seenFlags = people.map((p) => p.seen(item.id));
    let found: Ranked | null = null;

    if (seenFlags.includes(true)) {
      // ---- new season of something they watch ----
      const season = item.latestSeason;
      const aired = dayNumber(season?.airDate);
      if (!season || aired === null || today === null || season.number < 2) continue;
      const age = today - aired;
      if (age < 0 || age > NEW_SEASON_DAYS) continue;
      const newFor = people.filter((p, k) => {
        if (!seenFlags[k]) return false;
        const at = watchedAt(p.person, item.id, ctx);
        return at === null ? age <= UNDATED_DAYS : aired > Math.floor(at / DAY_MS);
      });
      if (!newFor.length) continue;
      const pick = pickFor(item, Number.POSITIVE_INFINITY, !seenFlags.includes(false), 0, false);
      if (!pick) continue;
      const whose = !together ? '' : newFor.length === 1 ? ` — one of ${possessive(newFor[0].name)} shows` : ` — ${whoWatched(newFor)} watched this`;
      found = {
        shared: together ? seenFlags.filter(Boolean).length : 0,
        news: aired,
        card: {
          itemId: item.id,
          // They already follow the show, so the thing to watch is the new season itself.
          pick: { type: 'season', season: season.number },
          service,
          minutes: pick.minutes,
          score: feedScore(info, people, index, seenFlags),
          reasons: buildReasons({ info, people, req: null, pick: pick.pick, moodRaw: 0 }),
          type: 'new-season',
          season: season.number,
          becauseItemId: item.id,
          text: `Season ${season.number} is out${whose}`,
          key: `season:${item.id}:${season.number}`,
          date: season.airDate,
        },
      };
    } else if (parents.length) {
      // ---- spinoff of something they watched (nobody watching has seen the spinoff itself) ----
      let best: { id: string; fans: PersonCtx[]; rank: number } | null = null;
      parents.forEach((id, order) => {
        if (id === item.id) return;
        const fans = people.filter((p) => p.seen(id));
        if (!fans.length) return;
        const fav = fans.some((p) => p.fav.favIds.has(id));
        const latest = Math.max(0, ...fans.map((p) => watchedAt(p.person, id, ctx) ?? 0));
        // Watched by more of them (everyone, ideally) > a favourite > the most recently watched > one we can name > listed first.
        const rank = (16 * fans.length) / people.length + (fav ? 4 : 0) + (titleOf(id) ? 1 : 0) + latest / 1e14 - order / 1e6;
        if (!best || rank > best.rank) best = { id, fans, rank };
      });
      const parent = best as { id: string; fans: PersonCtx[] } | null;
      if (!parent) continue;
      const pick = pickFor(item, Number.POSITIVE_INFINITY, false, 0, true);
      if (!pick) continue;
      const name = titleOf(parent.id);
      const text = !together
        ? `A spinoff of ${name ?? 'something you watched'}`
        : name
          ? `A spinoff of ${name}, which ${whoWatched(parent.fans)} watched`
          : `A spinoff of something ${whoWatched(parent.fans)} watched`;
      // A spinoff whose own latest season has only just started is news too.
      const aired = dayNumber(item.latestSeason?.airDate);
      const fresh = aired !== null && today !== null && today - aired >= 0 && today - aired <= NEW_SEASON_DAYS;
      found = {
        shared: together ? parent.fans.length : 0,
        news: fresh ? aired : null,
        card: {
          itemId: item.id,
          pick: pick.pick,
          service,
          minutes: pick.minutes,
          score: feedScore(info, people, index, people.map(() => false)),
          reasons: buildReasons({ info, people, req: null, pick: pick.pick, moodRaw: 0 }),
          type: 'spinoff',
          becauseItemId: parent.id,
          text,
          key: `spinoff:${item.id}`,
          ...(fresh && item.latestSeason ? { date: item.latestSeason.airDate } : {}),
        },
      };
    }

    if (found) {
      done.add(key);
      out.push(found);
    }
  }

  out.sort(
    (a, b) =>
      Number(b.news !== null) - Number(a.news !== null) ||
      b.shared - a.shared ||
      (b.news ?? -1) - (a.news ?? -1) ||
      b.card.score - a.card.score ||
      (a.card.itemId < b.card.itemId ? -1 : 1),
  );
  return out.map((r) => r.card);
}
