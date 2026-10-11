/**
 * The match decision, as a pure function shared by the memory and Firebase
 * implementations. Firebase runs it inside a transaction so a race between two
 * phones still yields exactly one match.
 */
import type { PickEntry, PersonId, TitleSnapshot, TogetherSession } from '../contracts';

export interface SwipeDecision {
  /** The session after the swipe (a new object; the input is not changed). */
  session: TogetherSession;
  /** True iff this swipe created the match. */
  matched: boolean;
  /** The pick entry to write when matched. */
  pick: PickEntry | null;
}

export const matchPickId = (sessionId: string, itemId: string): string => `match-${sessionId}-${itemId}`;

export const otherPerson = (p: PersonId): PersonId => (p === 'HG' ? 'BG' : 'HG');

export function decideSwipe(
  current: TogetherSession,
  person: PersonId,
  itemId: string,
  yes: boolean,
  snapshot: TitleSnapshot,
  now: number,
): SwipeDecision {
  const session: TogetherSession = {
    ...current,
    yes: { HG: [...(current.yes?.HG ?? [])], BG: [...(current.yes?.BG ?? [])] },
    passed: { HG: [...(current.passed?.HG ?? [])], BG: [...(current.passed?.BG ?? [])] },
    matches: [...(current.matches ?? [])],
  };
  const mine = yes ? session.yes[person] : session.passed[person];
  if (!mine.includes(itemId)) mine.push(itemId);

  const other = otherPerson(person);
  const alreadyMatched = session.matches.some((m) => m.itemId === itemId);
  const card = session.deck.find((c) => c.itemId === itemId);
  if (yes && !alreadyMatched && card && session.yes[other].includes(itemId)) {
    session.matches.push({ itemId, at: now });
    const pick: PickEntry = {
      id: matchPickId(session.id, itemId),
      at: now,
      kind: 'match',
      who: 'Together',
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
export const soloPickId = (who: string, itemId: string): string => `solo-${who}-${itemId}`;
