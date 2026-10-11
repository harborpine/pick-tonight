import { describe, expect, it } from 'vitest';
import type { DeckCard, TogetherSession } from '../contracts';
import {
  formatDate,
  formatMinutes,
  looseningHints,
  needsToJoin,
  nextUnshownMatch,
  pickText,
  remainingSessionCards,
  saveOptions,
  sessionPosition,
  todayLocal,
} from './helpers';

const card = (id: string): DeckCard => ({
  itemId: id,
  pick: { type: 'movie' },
  service: { serviceId: 'netflix', planId: 'standard', adFree: true },
  minutes: 100,
  score: 1,
  reasons: [],
});

function session(over: Partial<TogetherSession> = {}): TogetherSession {
  return {
    id: 's1',
    startedBy: 'HG',
    request: { who: 'Together', viewing: 'focused', mood: 'laugh', time: 60, novelty: 'either', genre: null },
    deck: [card('a'), card('b'), card('c')],
    joined: ['HG'],
    yes: { HG: [], BG: [] },
    passed: { HG: [], BG: [] },
    matches: [],
    status: 'open',
    createdAt: 0,
    ...over,
  };
}

describe('formatMinutes', () => {
  it('formats short, hour and mixed lengths', () => {
    expect(formatMinutes(22)).toBe('22 min');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(65)).toBe('1h 5m');
    expect(formatMinutes(130)).toBe('2h 10m');
    expect(formatMinutes(120)).toBe('2h');
  });
});

describe('pickText', () => {
  it('describes every kind of pick', () => {
    expect(pickText({ type: 'movie' })).toBe('Movie');
    expect(pickText({ type: 'series-start' })).toBe('Start the series');
    expect(pickText({ type: 'any-episode' })).toBe('Put on any episode');
    expect(pickText({ type: 'episode', season: 3, episode: 14, name: 'My Screw Up' })).toBe(
      'Season 3, Episode 14 — “My Screw Up”',
    );
  });
});

describe('dates', () => {
  it('builds the local date as YYYY-MM-DD', () => {
    expect(todayLocal(new Date(2026, 9, 5))).toBe('2026-10-05');
  });
  it('drops the year only for this year', () => {
    const now = new Date(2026, 9, 10);
    expect(formatDate('2026-03-02', now)).toBe('Mar 2');
    expect(formatDate('2025-12-31', now)).toBe('Dec 31, 2025');
  });
});

describe('session position', () => {
  it('starts at the first card and skips answered ones in deck order', () => {
    const s = session({ yes: { HG: ['a'], BG: [] }, passed: { HG: ['b'], BG: [] } });
    expect(sessionPosition(s, 'HG')).toBe(2);
    expect(remainingSessionCards(s, 'HG').map((c) => c.itemId)).toEqual(['c']);
    // The other person is unaffected.
    expect(sessionPosition(s, 'BG')).toBe(0);
  });
  it('reports the deck length when finished and picks up appended cards', () => {
    const s = session({ yes: { HG: ['a', 'b', 'c'], BG: [] } });
    expect(sessionPosition(s, 'HG')).toBe(3);
    expect(remainingSessionCards(s, 'HG')).toEqual([]);
    s.deck.push(card('d'));
    expect(remainingSessionCards(s, 'HG').map((c) => c.itemId)).toEqual(['d']);
  });
});

describe('joining and matches', () => {
  it('asks the other person to join only while open and not joined', () => {
    expect(needsToJoin(session(), 'BG')).toBe(true);
    expect(needsToJoin(session(), 'HG')).toBe(false);
    expect(needsToJoin(session({ joined: ['HG', 'BG'] }), 'BG')).toBe(false);
    expect(needsToJoin(session({ status: 'ended' }), 'BG')).toBe(false);
    expect(needsToJoin(null, 'BG')).toBe(false);
  });
  it('finds matches not shown yet', () => {
    const s = session({ matches: [{ itemId: 'a', at: 1 }, { itemId: 'b', at: 2 }] });
    expect(nextUnshownMatch(s, 0)).toBe(0);
    expect(nextUnshownMatch(s, 1)).toBe(1);
    expect(nextUnshownMatch(s, 2)).toBe(-1);
  });
});

describe('saveOptions', () => {
  it('defaults to Ours in Together and offers no Hers', () => {
    const r = saveOptions('HG', 'Together');
    expect(r.defaultList).toBe('ours');
    expect(r.options.map((o) => o.list)).toEqual(['HG', 'ours']);
  });
  it('offers Hers only when asking for her', () => {
    expect(saveOptions('HG', 'HG').options.map((o) => o.list)).toEqual(['HG', 'ours']);
    const r = saveOptions('HG', 'BG');
    expect(r.options.map((o) => o.list)).toEqual(['BG', 'HG', 'ours']);
    expect(r.defaultList).toBe('BG');
  });
});

describe('looseningHints', () => {
  it('suggests only what can still be loosened', () => {
    const hints = looseningHints({ who: 'HG', viewing: 'background', mood: 'laugh', time: 20, novelty: 'new', genre: 'comedy' });
    expect(hints.length).toBe(5);
    const open = looseningHints({ who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either', genre: null });
    expect(open).toEqual(['Try a different mood.']);
  });
});
