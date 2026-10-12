/** Pure helpers for the UI (formatting, labels, audiences, session logic, setup steps). No React in here. */
import {
  MAX_NAME_LENGTH,
  MOODS,
  SERVICES,
  normalizeWho,
  type CatalogItem,
  type DeckCard,
  type Member,
  type MemberId,
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
// People: names, audiences, labels
// ---------------------------------------------------------------------------

type Members = Record<MemberId, Pick<Member, 'id' | 'name'> & Partial<Member>>;

/** Collapse spaces and trim. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Check a typed name. `others` are the names already taken in the household (leave out the
 * person being renamed). Returns the cleaned name or a plain-language problem.
 */
export function validateName(raw: string, others: string[]): { ok: true; name: string } | { ok: false; message: string } {
  const name = cleanName(raw);
  if (name.length === 0) return { ok: false, message: 'Please type a name.' };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, message: `Names can be up to ${MAX_NAME_LENGTH} letters.` };
  if (others.some((o) => cleanName(o).toLowerCase() === name.toLowerCase())) {
    return { ok: false, message: `Someone in this household is already called ${name}. Please use a different name.` };
  }
  return { ok: true, name };
}

/** "Alex", "Alex and Sam", "Alex, Sam and Kit". */
export function joinNames(names: string[], word = 'and'): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;
}

export function nameOf(members: Members, id: MemberId): string {
  return members[id]?.name ?? 'Someone';
}

/** The names of the people in `ids` who are still members, in the order given. */
export function namesOf(members: Members, ids: MemberId[]): string[] {
  return ids.filter((id) => members[id]).map((id) => members[id].name);
}

/** "Alex & Sam", "Alex, Sam & Kit". */
export function whoLabel(who: Who, members: Members): string {
  const names = namesOf(members, who);
  return names.length ? joinNames(names, '&') : 'Someone';
}

/**
 * Switch one person on or off in the "Who's watching" chips. There is always at least one person.
 * A group always includes this phone's person (a Together session is started by someone in it);
 * switching yourself off while others are on leaves just the others (picking for someone else).
 */
export function toggleWho(selected: MemberId[], id: MemberId, me: MemberId): Who {
  const has = selected.includes(id);
  let next = has ? selected.filter((x) => x !== id) : [...selected, id];
  if (next.length === 0) return normalizeWho(selected);
  if (next.length > 1 && !next.includes(me)) next = [...next, me];
  return normalizeWho(next);
}

/** Keep only ids that are still members; fall back to just me. */
export function cleanWho(who: unknown, members: Members, me: MemberId): Who {
  const ids = Array.isArray(who) ? who.filter((x): x is string => typeof x === 'string' && !!members[x]) : [];
  if (ids.length === 0) return [me];
  return ids.length > 1 && !ids.includes(me) ? normalizeWho([...ids, me]) : normalizeWho(ids);
}

// ---------------------------------------------------------------------------
// Matches (picks) and History (watched)
// ---------------------------------------------------------------------------

/** 'all', 'mine', 'together', or `member:<id>` for one other person. */
export type MatchesFilter = 'all' | 'mine' | 'together' | `member:${string}`;

export const memberFilter = (id: MemberId): MatchesFilter => `member:${id}`;

const justOne = (who: Who, id: MemberId) => who.length === 1 && who[0] === id;

/** Which picks a Matches filter shows, newest first. */
export function filterPicks(picks: PickEntry[], filter: MatchesFilter, me: MemberId): PickEntry[] {
  const sorted = [...picks].sort((a, b) => b.at - a.at);
  if (filter === 'all') return sorted;
  if (filter === 'mine') return sorted.filter((p) => justOne(p.who, me));
  if (filter === 'together') return sorted.filter((p) => p.who.length > 1);
  const id = filter.slice('member:'.length);
  return sorted.filter((p) => justOne(p.who, id));
}

/** "Match — Alex & Sam" for Together matches, otherwise "Liked by Kit". */
export function pickLabel(p: Pick<PickEntry, 'kind' | 'who'>, members: Members): string {
  const who = whoLabel(p.who, members);
  return p.kind === 'match' ? `Match — ${who}` : `Liked by ${who}`;
}

/** Who gets marked as having watched a pick (only people still in the household). */
export function pickWatchers(p: Pick<PickEntry, 'who'>, members: Members): MemberId[] {
  return p.who.filter((id) => members[id]);
}

/** The text on the "I watched this" button. */
export function watchedButtonText(p: Pick<PickEntry, 'who'>, me: MemberId, members: Members): string {
  if (p.who.length > 1) return 'We watched this';
  const only = p.who[0];
  return only === me ? 'I watched this' : `${nameOf(members, only)} watched this`;
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
export function remainingSessionCards(session: TogetherSession, me: MemberId): DeckCard[] {
  const done = new Set([...(session.yes[me] ?? []), ...(session.passed[me] ?? [])]);
  return session.deck.filter((c) => !done.has(c.itemId));
}

/** Index of the first unanswered card, or deck length when finished. */
export function sessionPosition(session: TogetherSession, me: MemberId): number {
  const done = new Set([...(session.yes[me] ?? []), ...(session.passed[me] ?? [])]);
  const i = session.deck.findIndex((c) => !done.has(c.itemId));
  return i === -1 ? session.deck.length : i;
}

/** True when there is an open session for me that I have not joined yet. */
export function needsToJoin(session: TogetherSession | null | undefined, me: MemberId): session is TogetherSession {
  return !!session && session.status === 'open' && session.request.who.includes(me) && !session.joined.includes(me);
}

/** True when I am part of an open session and have joined it. */
export function inSession(session: TogetherSession | null | undefined, me: MemberId): session is TogetherSession {
  return !!session && session.status === 'open' && session.request.who.includes(me) && session.joined.includes(me);
}

/** True when an open session exists that is not for me (I am not in its audience). */
export function sessionWithoutMe(session: TogetherSession | null | undefined, me: MemberId): session is TogetherSession {
  return !!session && session.status === 'open' && !session.request.who.includes(me);
}

/** Matches this phone has not shown yet (index of the first unseen match, or -1). */
export function nextUnshownMatch(session: TogetherSession, shownCount: number): number {
  return session.matches.length > shownCount ? shownCount : -1;
}

/** Audience members who have not joined yet. */
export function sessionWaitingFor(session: TogetherSession): MemberId[] {
  return session.request.who.filter((id) => !session.joined.includes(id));
}

/** "Alex started a session with you and Sam". */
export function joinPromptText(session: TogetherSession, members: Members, me: MemberId): string {
  const starter = nameOf(members, session.startedBy);
  const rest = session.request.who.filter((id) => id !== session.startedBy && members[id]);
  const labels = rest.map((id) => (id === me ? 'you' : nameOf(members, id)));
  labels.sort((a, b) => (a === 'you' ? -1 : b === 'you' ? 1 : 0)); // "with you and Sam"
  return labels.length ? `${starter} started a session with ${joinNames(labels)}` : `${starter} started a session`;
}

/** The quiet line for a session this phone is not part of. */
export function othersPickingText(session: TogetherSession, members: Members): string {
  return `${joinNames(namesOf(members, session.request.who))} are picking together`;
}

/** What the match screen says. */
export function matchHeadline(audienceSize: number): string {
  return audienceSize >= 3 ? 'Everyone’s in!' : 'It’s a match!';
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
 * A group: Mine / Ours (default Ours). Alone for me: Mine / Ours (default Mine).
 * Alone for someone else: their list / Mine / Ours (default theirs).
 * A household of one has a single list, so a single option (the UI then saves without asking).
 */
export function saveOptions(me: MemberId, who: Who, members: Members): { options: SaveOption[]; defaultList: WatchlistOwner } {
  const mine: SaveOption = { list: me, label: 'Mine' };
  const ours: SaveOption = { list: 'ours', label: 'Ours' };
  if (Object.keys(members).length <= 1) return { options: [mine], defaultList: me };
  if (who.length > 1) return { options: [mine, ours], defaultList: 'ours' };
  const only = who[0];
  if (only !== me && members[only]) {
    return { options: [{ list: only, label: `${nameOf(members, only)}’s` }, mine, ours], defaultList: only };
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

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/** `<site>?join=CODE`; tolerates a missing trailing slash. */
export function buildInviteLink(siteUrl: string, code: string): string {
  const base = siteUrl.split('?')[0].split('#')[0];
  return `${base.endsWith('/') ? base : `${base}/`}?join=${encodeURIComponent(code)}`;
}

/** What someone typed into the code box: upper case, letters and digits only. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** "ABC123" is shown as "ABC 123" so it is easy to read out. */
export function spacedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

// ---------------------------------------------------------------------------
// First-run setup steps
// ---------------------------------------------------------------------------

export type WizardStep = 'name' | 'services' | 'favorites' | 'never' | 'import' | 'seen';
export type WizardRole = 'creator' | 'joiner';
export type SavedStep = Exclude<WizardStep, 'name' | 'services'>;

/** The steps counted by the progress dots. A joiner does not choose services. */
export function wizardSteps(role: WizardRole): WizardStep[] {
  return role === 'creator'
    ? ['name', 'services', 'favorites', 'never', 'import', 'seen']
    : ['name', 'favorites', 'never', 'import', 'seen'];
}

export function wizardProgress(role: WizardRole, step: WizardStep): { index: number; total: number } {
  const steps = wizardSteps(role);
  return { index: Math.max(0, steps.indexOf(step)), total: steps.length };
}

/**
 * Where an unfinished person resumes. Name and services happen before anything is saved, so once
 * a person exists they continue at the step this phone last reached (never earlier than favourites).
 */
export function resumeStep(role: WizardRole, marker: string | null | undefined): SavedStep {
  const steps = wizardSteps(role).filter((s): s is SavedStep => s !== 'name' && s !== 'services');
  return steps.includes(marker as SavedStep) ? (marker as SavedStep) : 'favorites';
}

/** The step before / after this one, or null at the ends. */
export function neighbourStep(role: WizardRole, step: WizardStep, dir: -1 | 1): WizardStep | null {
  const steps = wizardSteps(role);
  return steps[steps.indexOf(step) + dir] ?? null;
}

export const SOLO_LOSS_WARNING =
  'Because there is no sign-in, if you are the only person in this household and you lose or reset this phone, your lists are gone for good — there is nobody left to invite you back. Invite someone you trust if you want a safety net.';

// ---------------------------------------------------------------------------
// Invite codes this phone has already used (or found dead), so a link that stays in the address is ignored
// ---------------------------------------------------------------------------

export const SPENT_CODES_KEY = 'pt.spentInvites.v1';
const MAX_SPENT = 20;

/** Read a stored list defensively: only short strings survive. */
export function parseSpentCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 12).slice(-MAX_SPENT);
}

/** The list with `code` added (normalised, no duplicates, newest kept). */
export function addSpentCode(list: string[], code: string): string[] {
  const c = normalizeCode(code);
  if (!c) return list;
  return [...list.filter((x) => x !== c), c].slice(-MAX_SPENT);
}

export function isSpentCode(list: string[], code: string | null | undefined): boolean {
  return !!code && list.includes(normalizeCode(code));
}

/** The address's invite code, unless this phone has already used it or found it dead. */
export function usableAddressCode(code: string | null, spent: string[]): string | null {
  return code && !isSpentCode(spent, code) ? code : null;
}

/** True when a failure message sounds like a connection problem rather than a bad code (so the code is not written off). */
export function looksOffline(message: string): boolean {
  return /offline|internet|connection|network|try again later|timed out|busy/i.test(message);
}

export const STALE_INVITE_NOTE =
  'That invite link has already been used or has expired — ask for a new one, or start your own household.';
