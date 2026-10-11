import { describe, expect, it } from 'vitest';
import type { TogetherSession } from '../contracts';
import { assembleState } from './assemble';
import { friendlyError, MSG, SyncError } from './errors';
import { card, profile, request, snap } from './fixtures';
import { decideSwipe, matchPickId, soloPickId } from './match';
import { chunk, decodeDetail, encodeDetail, mergeSeenInputs, normalizeSeen, SEEN_SHARDS, shardOf } from './seen';
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
    expect(d.pick).toBeNull();
  });
  it('second yes on the same title matches once, with a pick entry', () => {
    const a = decideSwipe(session(), 'HG', 'tv-1', true, snap(), 5);
    const b = decideSwipe(a.session, 'BG', 'tv-1', true, snap('X'), 6);
    expect(b.matched).toBe(true);
    expect(b.session.matches).toEqual([{ itemId: 'tv-1', at: 6 }]);
    expect(b.pick).toMatchObject({ kind: 'match', who: 'Together', itemId: 'tv-1', sessionId: 's1', id: matchPickId('s1', 'tv-1') });
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
    expect(s.picks).toEqual([]);
    expect(s.activeSession).toBeNull();
    expect(s.profiles.HG.id).toBe('HG');
  });
  it('combines documents; watchlist and picks newest first; no pick is ever cut off', () => {
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
    expect(s.seen.HG['tv-1']).toEqual({ at: 5, source: 'manual' });
    expect(s.picks).toHaveLength(400);
    expect(s.picks[0]!.at).toBeGreaterThan(s.picks[1]!.at);
    expect(s.picks[0]!.id).toBe('10-199');
    expect(s.picks[399]!.id).toBe('09-0');
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

describe('old data shapes are read as the new ones', () => {
  it('old numbers become manual SeenEntry values; details fill in snapshot/source/plays but never override membership', () => {
    const detail = encodeDetail({ at: 99, source: 'import', plays: 4, snapshot: snap('Detailed') });
    const out = normalizeSeen({ 'tv-1': 5, 'tv-2': 7, junk: 'x' }, { 'tv-2': detail, 'tv-gone': detail });
    expect(out['tv-1']).toEqual({ at: 5, source: 'manual' });
    // `at` is the number in the legacy map (an old phone's re-mark wins); the rest comes from the details.
    expect(out['tv-2']).toEqual({ at: 7, source: 'import', plays: 4, snapshot: snap('Detailed') });
    // Un-marked by an old phone (gone from the legacy map): the leftover details are ignored.
    expect(out['tv-gone']).toBeUndefined();
    expect(out.junk).toBeUndefined();
  });
  it('a full SeenEntry stored in the legacy map is read as is', () => {
    expect(normalizeSeen({ 'tv-1': { at: 3, source: 'import', plays: 2 } })['tv-1']).toEqual({ at: 3, source: 'import', plays: 2 });
  });
  it('damaged details are ignored, not fatal', () => {
    expect(decodeDetail('{not json')).toBeNull();
    expect(decodeDetail(5)).toBeNull();
    expect(normalizeSeen({ 'tv-1': 5 }, { 'tv-1': '{oops' })['tv-1']).toEqual({ at: 5, source: 'manual' });
  });
  it('old month documents (the "history" log) come out as picks, unchanged', () => {
    const old = { id: 'abc-1', at: 10, kind: 'solo' as const, who: 'HG' as const, itemId: 'tv-1', snapshot: snap(), pick: { type: 'movie' as const }, service: card('x').service };
    const s = assembleState({ shared: null, seen: { HG: {}, BG: {} }, months: { '2026-01': { entries: { 'abc-1': old } } }, sessions: [] });
    expect(s.picks).toEqual([old]);
  });
  it('detail encoding round-trips', () => {
    const e = { at: 1, source: 'onboarding' as const, snapshot: snap('X') };
    expect(decodeDetail(encodeDetail(e))).toEqual(e);
  });
});

describe('mergeSeenInputs', () => {
  const inp = (itemId: string, extra = {}) => ({ itemId, source: 'import' as const, snapshot: snap(itemId), ...extra });
  it('at defaults to now; re-marking takes the newer at and the larger plays', () => {
    const first = mergeSeenInputs([inp('a', { plays: 3 })], {}, 100);
    expect(first.a).toMatchObject({ at: 100, plays: 3, source: 'import' });
    const again = mergeSeenInputs([inp('a', { at: 50, plays: 1 })], first, 200);
    expect(again.a).toMatchObject({ at: 100, plays: 3 });
    const newer = mergeSeenInputs([inp('a', { at: 500, plays: 9 })], first, 200);
    expect(newer.a).toMatchObject({ at: 500, plays: 9 });
  });
  it('plays stays absent when nobody gave it; duplicates inside one call merge', () => {
    expect(mergeSeenInputs([inp('a')], {}, 1).a!.plays).toBeUndefined();
    const m = mergeSeenInputs([inp('a', { at: 5, plays: 2 }), inp('a', { at: 9, plays: 1 })], {}, 1);
    expect(m.a).toMatchObject({ at: 9, plays: 2 });
  });
  it('old-style entries (no plays, manual) re-marked keep working', () => {
    const m = mergeSeenInputs([{ itemId: 'a', source: 'manual', snapshot: snap() }], { a: { at: 7, source: 'manual' } }, 3);
    expect(m.a).toMatchObject({ at: 7 });
  });
});

describe('helpers', () => {
  it('shardOf is stable and in range', () => {
    expect(shardOf('tv-1399')).toBe(shardOf('tv-1399'));
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = shardOf(`tv-${i}`);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(SEEN_SHARDS);
      seen.add(n);
    }
    expect(seen.size).toBe(SEEN_SHARDS);
    // Pinned: changing the hash would orphan stored details.
    expect(shardOf('tv-1399')).toBe(0);
  });
  it('chunk splits evenly', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(soloPickId('HG', 'tv-1')).toBe('solo-HG-tv-1');
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
