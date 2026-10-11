/** Pure helpers for the UI (formatting, labels, session position logic). No React in here. */
import {
  MOODS,
  SERVICES,
  type CatalogItem,
  type DeckCard,
  type PersonId,
  type PickEntry,
  type SeenEntry,
  type ServiceChoice,
  type ServiceId,
  type SuggestRequest,
  type TitleSnapshot,
  type TogetherSession,
  type WatchPick,
  type WatchlistOwner,
  type Who,
} from '../contracts';

/** "22 min", "1h 5m", "2h", "2h 10m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/** Exactly what to watch, in words. */
export function pickText(pick: WatchPick): string {
  switch (pick.type) {
    case 'movie':
      return 'Movie';
    case 'series-start':
      return 'Start the series';
    case 'season':
      return `Watch the new season (Season ${pick.season})`;
    case 'any-episode':
      return 'Put on any episode';
    case 'episode':
      return `Season ${pick.season}, Episode ${pick.episode} — “${pick.name}”`;
  }
}

export function serviceName(id: ServiceId): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id;
}

export function adLabel(choice: ServiceChoice): 'Ad-free' | 'Ads' {
  return choice.adFree ? 'Ad-free' : 'Ads';
}

/** The phone's local date as YYYY-MM-DD. */
export function todayLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 10" from a millisecond timestamp or a YYYY-MM-DD string (adds the year when not this year). */
export function formatDate(when: number | string, now: Date = new Date()): string {
  let d: Date;
  if (typeof when === 'string') {
    const [y, m, day] = when.split('-').map(Number);
    d = new Date(y, (m ?? 1) - 1, day ?? 1);
  } else {
    d = new Date(when);
  }
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

export function otherPerson(p: PersonId): PersonId {
  return p === 'HG' ? 'BG' : 'HG';
}

export function whoLabel(who: Who): string {
  return who === 'Together' ? 'HG & BG' : who;
}

export function moodLabel(id: string): string {
  return MOODS.find((m) => m.id === id)?.label ?? id;
}

export const TIME_OPTIONS: { value: SuggestRequest['time']; label: string }[] = [
  { value: 20, label: 'About 20 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hr' },
  { value: 120, label: '2+ hrs' },
  { value: 'any', label: "I don't care" },
];

export function timeLabel(t: SuggestRequest['time']): string {
  return TIME_OPTIONS.find((o) => o.value === t)?.label ?? `${t} min`;
}

export function snapshotOf(item: CatalogItem): TitleSnapshot {
  return { title: item.title, year: item.year, poster: item.poster };
}

/** A stable hue (0-359) from a string, for placeholder posters. */
export function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

// ---------------------------------------------------------------------------
// Matches (picks) and History (watched)
// ---------------------------------------------------------------------------

export type MatchesFilter = 'all' | 'mine' | PersonId | 'together';

/** Which picks a Matches filter shows, newest first. 'mine' = solo picks for me; a person's initials = solo picks for them; 'together' = matches and picks for both. */
export function filterPicks(picks: PickEntry[], filter: MatchesFilter, me: PersonId): PickEntry[] {
  const sorted = [...picks].sort((a, b) => b.at - a.at);
  switch (filter) {
    case 'all':
      return sorted;
    case 'mine':
      return sorted.filter((p) => p.kind === 'solo' && p.who === me);
    case 'together':
      return sorted.filter((p) => p.kind === 'match' || p.who === 'Together');
    default:
      return sorted.filter((p) => p.kind === 'solo' && p.who === filter);
  }
}

/** "Match" for Together matches, otherwise "Liked by HG". */
export function pickLabel(p: Pick<PickEntry, 'kind' | 'who'>): string {
  return p.kind === 'match' ? 'Match' : `Liked by ${whoLabel(p.who)}`;
}

/** Who gets marked as having watched a pick. */
export function pickWatchers(p: Pick<PickEntry, 'kind' | 'who'>): PersonId[] {
  return p.kind === 'match' || p.who === 'Together' ? ['HG', 'BG'] : [p.who as PersonId];
}

/** The text on the "I watched this" button. */
export function watchedButtonText(p: Pick<PickEntry, 'kind' | 'who'>, me: PersonId): string {
  if (p.kind === 'match' || p.who === 'Together') return 'We watched this';
  return p.who === me ? 'I watched this' : `${p.who} watched this`;
}

/** A small note about how something got onto the watched list. */
export function seenSourceNote(e: Pick<SeenEntry, 'source' | 'plays'>): string {
  switch (e.source) {
    case 'import':
      return e.plays && e.plays > 0 ? `Imported · ${e.plays} ${e.plays === 1 ? 'play' : 'plays'}` : 'Imported';
    case 'onboarding':
      return 'From your first-run picks';
    default:
      return 'Marked watched';
  }
}

/** Watched rows, newest first, optionally filtered by a typed search over the title. */
export function sortSeen<T extends { at: number; title: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const kept = q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows.slice();
  return kept.sort((a, b) => b.at - a.at);
}

/** 1234 -> "1,234". */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// Together session logic
// ---------------------------------------------------------------------------

/** Cards in the shared deck this person has not answered yet, in deck order. */
export function remainingSessionCards(session: TogetherSession, me: PersonId): DeckCard[] {
  const done = new Set([...(session.yes[me] ?? []), ...(session.passed[me] ?? [])]);
  return session.deck.filter((c) => !done.has(c.itemId));
}

/** Index of the first unanswered card, or deck length when finished. */
export function sessionPosition(session: TogetherSession, me: PersonId): number {
  const done = new Set([...(session.yes[me] ?? []), ...(session.passed[me] ?? [])]);
  const i = session.deck.findIndex((c) => !done.has(c.itemId));
  return i === -1 ? session.deck.length : i;
}

/** True when there is an open session this person has not joined yet. */
export function needsToJoin(session: TogetherSession | null | undefined, me: PersonId): session is TogetherSession {
  return !!session && session.status === 'open' && !session.joined.includes(me);
}

/** True when this person is part of an open session. */
export function inSession(session: TogetherSession | null | undefined, me: PersonId): session is TogetherSession {
  return !!session && session.status === 'open' && session.joined.includes(me);
}

/** Matches this phone has not shown yet (index of the first unseen match, or -1). */
export function nextUnshownMatch(session: TogetherSession, shownCount: number): number {
  return session.matches.length > shownCount ? shownCount : -1;
}

// ---------------------------------------------------------------------------
// Save-to-watchlist choices
// ---------------------------------------------------------------------------

export interface SaveOption {
  list: WatchlistOwner;
  label: string;
}

/**
 * Which lists to offer when saving. `who` is who the card is for.
 * Together: Mine / Ours (default Ours). Solo for me: Mine / Ours (default Mine).
 * Solo for the other person: Hers (or His) / Mine / Ours (default theirs).
 */
export function saveOptions(me: PersonId, who: Who): { options: SaveOption[]; defaultList: WatchlistOwner } {
  const other = otherPerson(me);
  const mine: SaveOption = { list: me, label: 'Mine' };
  const ours: SaveOption = { list: 'ours', label: 'Ours' };
  if (who === 'Together') return { options: [mine, ours], defaultList: 'ours' };
  if (who === other) {
    const theirs: SaveOption = { list: other, label: other === 'BG' ? 'Hers' : 'His' };
    return { options: [theirs, mine, ours], defaultList: other };
  }
  return { options: [mine, ours], defaultList: me };
}

// ---------------------------------------------------------------------------
// Ask screen: what to loosen when a deck comes back empty
// ---------------------------------------------------------------------------

export function looseningHints(req: SuggestRequest): string[] {
  const hints: string[] = [];
  if (req.time !== 120 && req.time !== 'any') hints.push('Give it more time — longer titles open up at 1 hr or 2+ hrs.');
  if (req.novelty !== 'either') hints.push('Pick “Either” for new or rewatch.');
  if (req.viewing !== 'focused') hints.push('Try “Focused” — it allows the trickier shows and movies.');
  if (req.genre) hints.push('Clear the genre craving.');
  hints.push('Try a different mood.');
  return hints;
}
