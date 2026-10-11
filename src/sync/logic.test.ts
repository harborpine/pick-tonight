import { describe, expect, it } from 'vitest';
import type { TogetherSession } from '../contracts';
import { assembleState } from './assemble';
import { friendlyError, MSG, SyncError } from './errors';
import { card, profile, request, snap } from './fixtures';
import { HISTORY_CAP } from './layout';
import { decideSwipe, matchHistoryId } from './match';
import { checkCode, CODE_ALPHABET, generateCode, isValidCodeShape, normalizeCode } from './pairing';

const session = (): TogetherSession => ({
  id: 's1',
  startedBy: 'HG',
  request,
  deck: [card('tv-1'), card('tv-2')],
  joined: ['HG'],
  yes: { HG: [], BG: [] },
  passed: { HG: [], BG: [] },
  matches: [],
  status: 'open',
  createdAt: 1000,
});

describe('decideSwipe', () => {
  it('first yes is not a match', () => {
    const d = decideSwipe(session(), 'HG', 'tv-1', true, snap(), 5);
    expect(d.matched).toBe(false);
    expect(d.session.yes.HG).toEqual(['tv-1']);
    expect(d.history).toBeNull();
  });
  it('second yes on the same title matches once, with a history entry', () => {
    const a = decideSwipe(session(), 'HG', 'tv-1', true, snap(), 5);
    const b = decideSwipe(a.session, 'BG', 'tv-1', true, snap('X'), 6);
    expect(b.matched).toBe(true);
    expect(b.session.matches).toEqual([{ itemId: 'tv-1', at: 6 }]);
    expect(b.history).toMatchObject({ kind: 'match', who: 'Together', itemId: 'tv-1', sessionId: 's1', id: matchHistoryId('s1', 'tv-1') });
    // Repeating either yes never matches again.
    expect(decideSwipe(b.session, 'BG', 'tv-1', true, snap(), 7).matched).toBe(false);
    expect(decideSwipe(b.session, 'HG', 'tv-1', true, snap(), 7).matched).toBe(false);
  });
  it('a pass never matches and does not change the other person', () => {
    const a = decideSwipe(session(), 'HG', 'tv-1', true, snap(), 5);
    const b = decideSwipe(a.session, 'BG', 'tv-1', false, snap(), 6);
    expect(b.matched).toBe(false);
    expect(b.session.passed.BG).toEqual(['tv-1']);
  });
  it('does not change its input', () => {
    const s = session();
    decideSwipe(s, 'HG', 'tv-1', true, snap(), 5);
    expect(s.yes.HG).toEqual([]);
  });
  it('a yes for a title not in the deck is recorded but never matches', () => {
    const a = decideSwipe(session(), 'HG', 'tv-9', true, snap(), 5);
    expect(decideSwipe(a.session, 'BG', 'tv-9', true, snap(), 6).matched).toBe(false);
  });
});

describe('pairing codes', () => {
  it('generates 6 unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toHaveLength(6);
      expect(isValidCodeShape(c)).toBe(true);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(CODE_ALPHABET).toHaveLength(31);
  });
  it('uses the whole alphabet roughly evenly', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of generateCode()) seen.add(ch);
    expect(seen.size).toBe(31);
  });
  it('tidies typed input and rejects bad shapes', () => {
    expect(normalizeCode(' ab3-k9z ')).toBe('AB3K9Z');
    expect(isValidCodeShape('AB3K9Z')).toBe(true);
    expect(isValidCodeShape('AB3K9')).toBe(false);
    expect(isValidCodeShape('AB3K90')).toBe(false); // zero is not in the alphabet
    expect(isValidCodeShape('ab3k9z')).toBe(false);
  });
  it('checks used and expiry (15 minutes)', () => {
    expect(checkCode({ used: false, createdAtMs: 0 }, 14 * 60_000)).toBe('ok');
    expect(checkCode({ used: false, createdAtMs: 0 }, 15 * 60_000)).toBe('expired');
    expect(checkCode({ used: true, createdAtMs: 0 }, 1)).toBe('used');
  });
});

describe('assembleState', () => {
  it('fills defaults when nothing exists yet', () => {
    const s = assembleState({ shared: null, seen: { HG: {}, BG: {} }, months: {}, sessions: [] });
    expect(s.watchlist).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.activeSession).toBeNull();
    expect(s.profiles.HG.id).toBe('HG');
  });
  it('combines documents; watchlist and history newest first; history capped', () => {
    const entries = (month: string, n: number, base: number) =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => {
          const id = `${month}-${i}`;
          return [id, { id, at: base + i, kind: 'solo' as const, who: 'HG' as const, itemId: 'tv-1', snapshot: snap(), pick: { type: 'movie' as const }, service: card('x').service }];
        }),
      );
    const s = assembleState({
      shared: {
        profiles: { HG: profile('HG'), BG: profile('BG') },
        never: { HG: { 'tv-3': 1 } },
        watchlist: {
          'HG__tv-1': { itemId: 'tv-1', list: 'HG', addedBy: 'HG', at: 1, snapshot: snap() },
          'ours__tv-2': { itemId: 'tv-2', list: 'ours', addedBy: 'BG', at: 9, snapshot: snap() },
        },
      },
      seen: { HG: { 'tv-1': 5 }, BG: {} },
      months: { '2026-09': { entries: entries('09', 200, 1000) }, '2026-10': { entries: entries('10', 200, 5000) } },
      sessions: [],
    });
    expect(s.watchlist.map((w) => w.itemId)).toEqual(['tv-2', 'tv-1']);
    expect(s.never.HG['tv-3']).toBe(1);
    expect(s.seen.HG['tv-1']).toBe(5);
    expect(s.history).toHaveLength(HISTORY_CAP);
    expect(s.history[0]!.at).toBeGreaterThan(s.history[1]!.at);
    expect(s.history[0]!.id).toBe('10-199');
  });
  it('picks the newest open session and ignores ended ones', () => {
    const a = { ...session(), id: 'a', createdAt: 1 };
    const b = { ...session(), id: 'b', createdAt: 2 };
    const c = { ...session(), id: 'c', createdAt: 3, status: 'ended' as const };
    const s = assembleState({ shared: null, seen: { HG: {}, BG: {} }, months: {}, sessions: [a, c, b] });
    expect(s.activeSession?.id).toBe('b');
  });
  it('returns a new object every time', () => {
    const p = { shared: null, seen: { HG: {}, BG: {} }, months: {}, sessions: [] };
    expect(assembleState(p)).not.toBe(assembleState(p));
  });
});

describe('friendlyError', () => {
  it('speaks plainly', () => {
    expect(friendlyError({ code: 'permission-denied' })).toBe(MSG.denied);
    expect(friendlyError({ code: 'unavailable' })).toBe(MSG.offline);
    expect(friendlyError(new SyncError('Hello'))).toBe('Hello');
    expect(friendlyError(new Error('FirebaseError: weird'))).toBe(MSG.generic);
  });
});
