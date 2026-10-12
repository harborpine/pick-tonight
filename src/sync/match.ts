/**
 * The match decision, as a pure function shared by the memory and Firebase implementations.
 * Firebase runs it inside a transaction so a race between phones still yields exactly one match.
 * A match needs a yes from EVERY member of the session's audience (`request.who`).
 */
import type { MemberId, PickEntry, TitleSnapshot, TogetherSession } from '../contracts';

export interface SwipeDecision {
  /** The session after the swipe (a new object; the input is not changed). */
  session: TogetherSession;
  /** True iff this swipe created the match. */
  matched: boolean;
  /** The pick entry to write when matched. */
  pick: PickEntry | null;
}

export const matchPickId = (sessionId: string, itemId: string): string => `match-${sessionId}-${itemId}`;

/** Fill in the per-member keys so every audience member has a yes list and a passed list. */
export function normalizeSession(s: TogetherSession): TogetherSession {
  const who = s.request?.who ?? [];
  const yes: Record<MemberId, string[]> = {};
  const passed: Record<MemberId, string[]> = {};
  for (const m of who) {
    yes[m] = [...(s.yes?.[m] ?? [])];
    passed[m] = [...(s.passed?.[m] ?? [])];
  }
  return { ...s, deck: s.deck ?? [], joined: s.joined ?? [], yes, passed, matches: [...(s.matches ?? [])] };
}

export function decideSwipe(
  current: TogetherSession,
  member: MemberId,
  itemId: string,
  yes: boolean,
  snapshot: TitleSnapshot,
  now: number,
): SwipeDecision {
  const session = normalizeSession(current);
  const audience = session.request.who;
  // Someone outside the audience cannot swipe in this session.
  if (!audience.includes(member)) return { session, matched: false, pick: null };
  const mine = yes ? session.yes[member]! : session.passed[member]!;
  if (!mine.includes(itemId)) mine.push(itemId);

  const alreadyMatched = session.matches.some((m) => m.itemId === itemId);
  const card = session.deck.find((c) => c.itemId === itemId);
  if (yes && !alreadyMatched && card && audience.every((m) => session.yes[m]!.includes(itemId))) {
    session.matches.push({ itemId, at: now });
    const pick: PickEntry = {
      id: matchPickId(session.id, itemId),
      at: now,
      kind: 'match',
      who: [...audience],
      itemId,
      snapshot,
      pick: card.pick,
      service: card.service,
      sessionId: session.id,
    };
    return { session, matched: true, pick };
  }
  return { session, matched: false, pick: null };
}

/** Solo picks get a fixed id, so two phones adding the same title at once still make one entry. */
export const soloPickId = (who: readonly string[], itemId: string): string => `solo-${who.join('+')}-${itemId}`;
