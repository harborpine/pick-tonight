import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../config';
import { MAX_NAME_LENGTH, type PickEntry, type TogetherSession } from '../contracts';
import { assembleState, freshParts } from './assemble';
import { friendlyError, isQuotaError, MSG, SyncError } from './errors';
import { card, requestFor, snap } from './fixtures';
import { INVITE_TTL_MS, nameKey } from './layout';
import { decideSwipe, matchPickId, soloPickId } from './match';
import { checkCode, CODE_ALPHABET, generateCode, isValidCodeShape, nameProblem, nameTaken, normalizeCode, tidyName } from './pairing';
import { chunk, decodeSeen, encodeSeen, mergeSeenInputs, SEEN_SHARDS, shardOf } from './seen';

const session = (who: string[]): TogetherSession => {
  const yes: Record<string, string[]> = {};
  const passed: Record<string, string[]> = {};
  for (const m of who) {
    yes[m] = [];
    passed[m] = [];
  }
  return {
    id: 's1',
    startedBy: who[0]!,
    request: requestFor(who),
    deck: [card('tv-1'), card('tv-2')],
    joined: [who[0]!],
    yes,
    passed,
    matches: [],
    status: 'open',
    createdAt: 1000,
  };
};

describe('decideSwipe (N people)', () => {
  it('a pair: first yes is not a match, second yes matches once with a pick for the audience', () => {
    const a = decideSwipe(session(['m1', 'm2']), 'm1', 'tv-1', true, snap(), 5);
    expect(a.matched).toBe(false);
    expect(a.session.yes.m1).toEqual(['tv-1']);
    const b = decideSwipe(a.session, 'm2', 'tv-1', true, snap('X'), 6);
    expect(b.matched).toBe(true);
    expect(b.session.matches).toEqual([{ itemId: 'tv-1', at: 6 }]);
    expect(b.pick).toMatchObject({ kind: 'match', who: ['m1', 'm2'], itemId: 'tv-1', sessionId: 's1', id: matchPickId('s1', 'tv-1') });
    // Repeating any yes never matches again.
    expect(decideSwipe(b.session, 'm2', 'tv-1', true, snap(), 7).matched).toBe(false);
    expect(decideSwipe(b.session, 'm1', 'tv-1', true, snap(), 7).matched).toBe(false);
  });

  for (const n of [3, 4]) {
    it(`${n} people: only the last yes matches, in any order`, () => {
      const who = Array.from({ length: n }, (_, i) => `m${i + 1}`);
      for (const order of [who, [...who].reverse(), [who[1]!, who[0]!, ...who.slice(2)]]) {
        let s = session(who);
        order.forEach((m, i) => {
          const d = decideSwipe(s, m, 'tv-1', true, snap(), 10 + i);
          expect(d.matched).toBe(i === n - 1);
          s = d.session;
        });
        expect(s.matches).toHaveLength(1);
      }
    });
    it(`${n} people: one pass means no match`, () => {
      const who = Array.from({ length: n }, (_, i) => `m${i + 1}`);
      let s = session(who);
      s = decideSwipe(s, who[0]!, 'tv-1', false, snap(), 1).session;
      for (const m of who.slice(1)) s = decideSwipe(s, m, 'tv-1', true, snap(), 2).session;
      expect(s.matches).toEqual([]);
      expect(s.passed[who[0]!]).toEqual(['tv-1']);
    });
  }

  it('a pair inside a household of four: the other two are not needed and cannot swipe', () => {
    const s0 = session(['m2', 'm4']);
    const outsider = decideSwipe(s0, 'm1', 'tv-1', true, snap(), 1);
    expect(outsider.matched).toBe(false);
    expect(outsider.session.yes.m1).toBeUndefined();
    const a = decideSwipe(s0, 'm2', 'tv-1', true, snap(), 2);
    expect(decideSwipe(a.session, 'm4', 'tv-1', true, snap(), 3).matched).toBe(true);
  });

  it('does not change its input; a yes for a title not in the deck never matches', () => {
    const s = session(['m1', 'm2']);
    decideSwipe(s, 'm1', 'tv-1', true, snap(), 5);
    expect(s.yes.m1).toEqual([]);
    const a = decideSwipe(s, 'm1', 'tv-9', true, snap(), 5);
    expect(decideSwipe(a.session, 'm2', 'tv-9', true, snap(), 6).matched).toBe(false);
  });
});

describe('invite codes and names', () => {
  it('generates 6 unambiguous characters, using the whole alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateCode();
      expect(c).toHaveLength(6);
      expect(isValidCodeShape(c)).toBe(true);
      for (const ch of c) seen.add(ch);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(seen.size).toBe(31);
  });
  it('tidies typed input and rejects bad shapes', () => {
    expect(normalizeCode(' ab3-k9z ')).toBe('AB3K9Z');
    expect(isValidCodeShape('AB3K9')).toBe(false);
    expect(isValidCodeShape('AB3K90')).toBe(false);
    expect(isValidCodeShape('ab3k9z')).toBe(false);
  });
  it('checks used and the 24-hour expiry', () => {
    const exp = INVITE_TTL_MS;
    expect(INVITE_TTL_MS).toBe(24 * 3600 * 1000);
    expect(checkCode({ used: false, expiresAtMs: exp }, exp - 1)).toBe('ok');
    expect(checkCode({ used: false, expiresAtMs: exp }, exp)).toBe('expired');
    expect(checkCode({ used: true, expiresAtMs: exp }, 1)).toBe('used');
  });
  it('validates names', () => {
    expect(nameProblem('')).toMatch(/type a name/);
    expect(nameProblem('   ')).toMatch(/type a name/);
    expect(nameProblem('a'.repeat(MAX_NAME_LENGTH))).toBeNull();
    expect(nameProblem('a'.repeat(MAX_NAME_LENGTH + 1))).toMatch(/at most 20/);
    expect(nameProblem('Zoë 🎬')).toBeNull();
    expect(nameProblem('bad\u0007name')).toMatch(/characters/);
    expect(tidyName('  Sam   Lee ')).toBe('Sam Lee');
    expect(nameKey(' Sam ')).toBe('n:sam');
  });
  it('names are unique ignoring case and spacing, except for the member being renamed', () => {
    const ms = [{ id: 'm1', name: 'Alex' }, { id: 'm2', name: 'Sam' }];
    expect(nameTaken('alex', ms)).toBe(true);
    expect(nameTaken(' SAM ', ms)).toBe(true);
    expect(nameTaken('Kit', ms)).toBe(false);
    expect(nameTaken('ALEX', ms, 'm1')).toBe(false);
  });
});

describe('assembleState', () => {
  const hh = (ids: string[]) => ({
    nextId: ids.length + 1,
    members: Object.fromEntries(ids.map((id, i) => [id, { name: id.toUpperCase(), joinedAt: i + 1 }])),
    names: {},
    owners: {},
    uids: {},
  });
  const pick = (id: string, at: number, who = ['m1']): PickEntry => ({ id, at, kind: 'solo', who, itemId: 'tv-1', snapshot: snap(), pick: { type: 'movie' }, service: card('x').service });

  for (const n of [1, 2, 3, 4]) {
    it(`gives every one of ${n} members a key in every per-member record`, () => {
      const ids = Array.from({ length: n }, (_, i) => `m${i + 1}`);
      const parts = freshParts();
      parts.household = hh(ids);
      const s = assembleState(parts);
      expect(Object.keys(s.members)).toEqual(ids);
      for (const rec of [s.profiles, s.seen, s.never, s.notTonight]) expect(Object.keys(rec).sort()).toEqual(ids);
      expect(s.profiles.m1!.id).toBe('m1');
      expect(s.activeSession).toBeNull();
      expect(s.picks).toEqual([]);
    });
  }

  it('combines documents; watchlist and picks newest first; no pick is ever cut off', () => {
    const parts = freshParts();
    parts.household = hh(['m1', 'm2']);
    const entry = (id: string, list: string, at: number) => JSON.stringify({ itemId: id, list, addedBy: 'm1', at, snapshot: snap() });
    parts.shared = { settings: { plans: { netflix: 'standard' } }, ours: { 'tv-2': entry('tv-2', 'ours', 9) } };
    parts.memberDocs = { m1: { never: { 'tv-3': 1 }, watch: { 'tv-1': entry('tv-1', 'm1', 1) } }, m2: { notTonight: { 'tv-4': '2026-10-10' } } };
    parts.seen = { m1: { 'tv-1': encodeSeen({ at: 5, source: 'import', plays: 2, snapshot: snap('S') }), junk: '{bad' } };
    const month = (m: string, n: number, base: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`${m}-${i}`, JSON.stringify(pick(`${m}-${i}`, base + i))]));
    parts.months = { '2026-09': { entries: month('09', 200, 1000) }, '2026-10': { entries: month('10', 200, 5000) } };
    const s = assembleState(parts);
    expect(s.watchlist.map((w) => [w.itemId, w.list])).toEqual([['tv-2', 'ours'], ['tv-1', 'm1']]);
    expect(s.never.m1!['tv-3']).toBe(1);
    expect(s.notTonight.m2!['tv-4']).toBe('2026-10-10');
    expect(s.seen.m1!['tv-1']).toEqual({ at: 5, source: 'import', plays: 2, snapshot: snap('S') });
    expect(s.seen.m1!.junk).toBeUndefined();
    expect(s.settings.plans.netflix).toBe('standard');
    expect(s.picks).toHaveLength(400);
    expect(s.picks[0]!.id).toBe('10-199');
    expect(s.picks[399]!.id).toBe('09-0');
  });

  it('shows the open session with a key for every audience member', () => {
    const parts = freshParts();
    parts.household = hh(['m1', 'm2', 'm3']);
    const raw = { ...session(['m1', 'm3']), yes: { m1: ['tv-1'] }, passed: {} } as unknown as TogetherSession;
    parts.session = raw;
    const s = assembleState(parts);
    expect(s.activeSession!.yes).toEqual({ m1: ['tv-1'], m3: [] });
    expect(s.activeSession!.passed).toEqual({ m1: [], m3: [] });
    parts.session = { ...raw, status: 'ended' };
    expect(assembleState(parts).activeSession).toBeNull();
  });

  it('returns a new object every time', () => {
    const p = freshParts();
    p.household = hh(['m1']);
    expect(assembleState(p)).not.toBe(assembleState(p));
  });
});

describe('watched-title storage', () => {
  it('encoding round-trips; damaged values are ignored, not fatal', () => {
    const e = { at: 1, source: 'onboarding' as const, snapshot: snap('X') };
    expect(decodeSeen(encodeSeen(e))).toEqual(e);
    expect(decodeSeen('{not json')).toBeNull();
    expect(decodeSeen(5)).toBeNull();
  });
  const inp = (itemId: string, extra = {}) => ({ itemId, source: 'import' as const, snapshot: snap(itemId), ...extra });
  it('mergeSeenInputs: at defaults to now; re-marking takes the newer at and the larger plays', () => {
    const first = mergeSeenInputs([inp('a', { plays: 3 })], {}, 100);
    expect(first.a).toMatchObject({ at: 100, plays: 3, source: 'import' });
    expect(mergeSeenInputs([inp('a', { at: 50, plays: 1 })], first, 200).a).toMatchObject({ at: 100, plays: 3 });
    expect(mergeSeenInputs([inp('a', { at: 500, plays: 9 })], first, 200).a).toMatchObject({ at: 500, plays: 9 });
    expect(mergeSeenInputs([inp('a')], {}, 1).a!.plays).toBeUndefined();
    expect(mergeSeenInputs([inp('a', { at: 5, plays: 2 }), inp('a', { at: 9, plays: 1 })], {}, 1).a).toMatchObject({ at: 9, plays: 2 });
  });
  it('shardOf is stable and in range', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = shardOf(`tv-${i}`);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(SEEN_SHARDS);
      seen.add(n);
    }
    expect(seen.size).toBe(SEEN_SHARDS);
    expect(shardOf('tv-1399')).toBe(0); // pinned: changing the hash would orphan stored data
  });
  it('chunk splits evenly; solo pick ids are stable', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(soloPickId(['m1'], 'tv-1')).toBe('solo-m1-tv-1');
    expect(soloPickId(['m1', 'm2'], 'tv-1')).toBe('solo-m1+m2-tv-1');
  });
});

describe('error messages', () => {
  it('speaks plainly', () => {
    expect(friendlyError({ code: 'permission-denied' })).toBe(MSG.denied);
    expect(friendlyError({ code: 'unavailable' })).toBe(MSG.offline);
    expect(friendlyError(new SyncError('Hello'))).toBe('Hello');
    expect(friendlyError(new Error('FirebaseError: weird'))).toBe(MSG.generic);
  });
  it('maps an exhausted free quota to the specific message', () => {
    expect(friendlyError({ code: 'resource-exhausted' })).toBe(MSG.quota);
    expect(friendlyError({ code: 'firestore/resource-exhausted' })).toBe(MSG.quota);
    expect(isQuotaError({ code: 'resource-exhausted' })).toBe(true);
    expect(isQuotaError({ code: 'unavailable' })).toBe(false);
    expect(MSG.quota).toBe(`${APP_NAME} is very busy today and has hit its free limit. Your lists are safe — please try again tomorrow.`);
  });
  it('no message contains jargon or error codes', () => {
    for (const m of Object.values(MSG)) expect(m).not.toMatch(/firestore|firebase|permission|exception|error code/i);
  });
});
