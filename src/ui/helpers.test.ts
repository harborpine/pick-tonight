import { describe, expect, it } from 'vitest';
import type { DeckCard, PickEntry, TogetherSession } from '../contracts';
import {
  TIME_OPTIONS,
  filterPicks,
  formatCount,
  formatDate,
  formatMinutes,
  looseningHints,
  needsToJoin,
  nextUnshownMatch,
  pickLabel,
  pickText,
  pickWatchers,
  remainingSessionCards,
  saveOptions,
  seenSourceNote,
  sessionPosition,
  sortSeen,
  timeLabel,
  todayLocal,
  watchedButtonText,
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
    // "I don't care" has no time limit left to loosen either.
    expect(looseningHints({ who: 'HG', viewing: 'focused', mood: 'laugh', time: 'any', novelty: 'either', genre: null })).toEqual(['Try a different mood.']);
  });
});

// ---------------------------------------------------------------------------
// Version 2 helpers
// ---------------------------------------------------------------------------

const pickEntry = (over: Partial<PickEntry>): PickEntry => ({
  id: 'p',
  at: 1,
  kind: 'solo',
  who: 'HG',
  itemId: 'a',
  snapshot: { title: 'A', year: 2000, poster: null },
  pick: { type: 'movie' },
  service: { serviceId: 'netflix', planId: 'standard', adFree: true },
  ...over,
});

describe('time options', () => {
  it("offers 'I don't care' as the fifth choice and labels it", () => {
    expect(TIME_OPTIONS.map((t) => t.value)).toEqual([20, 45, 60, 120, 'any']);
    expect(timeLabel('any')).toBe("I don't care");
  });
});

describe('matches filter', () => {
  const picks = [
    pickEntry({ id: 'm1', at: 5, kind: 'match', who: 'Together' }),
    pickEntry({ id: 's1', at: 9, who: 'HG' }),
    pickEntry({ id: 's2', at: 7, who: 'BG' }),
    pickEntry({ id: 's3', at: 1, who: 'HG' }),
  ];
  it('shows everything newest first', () => {
    expect(filterPicks(picks, 'all', 'HG').map((p) => p.id)).toEqual(['s1', 's2', 'm1', 's3']);
  });
  it('Mine = my solo picks; partner = their solo picks; Together = matches', () => {
    expect(filterPicks(picks, 'mine', 'HG').map((p) => p.id)).toEqual(['s1', 's3']);
    expect(filterPicks(picks, 'mine', 'BG').map((p) => p.id)).toEqual(['s2']);
    expect(filterPicks(picks, 'BG', 'HG').map((p) => p.id)).toEqual(['s2']);
    expect(filterPicks(picks, 'together', 'HG').map((p) => p.id)).toEqual(['m1']);
  });
  it('labels picks and decides who is marked watched', () => {
    expect(pickLabel(pickEntry({ kind: 'match', who: 'Together' }))).toBe('Match');
    expect(pickLabel(pickEntry({ who: 'BG' }))).toBe('Liked by BG');
    expect(pickWatchers(pickEntry({ kind: 'match', who: 'Together' }))).toEqual(['HG', 'BG']);
    expect(pickWatchers(pickEntry({ who: 'BG' }))).toEqual(['BG']);
    expect(watchedButtonText(pickEntry({ kind: 'match', who: 'Together' }), 'HG')).toBe('We watched this');
    expect(watchedButtonText(pickEntry({ who: 'HG' }), 'HG')).toBe('I watched this');
    expect(watchedButtonText(pickEntry({ who: 'BG' }), 'HG')).toBe('BG watched this');
  });
});

describe('history rows', () => {
  it('describes where a watched title came from', () => {
    expect(seenSourceNote({ source: 'import', plays: 14 })).toBe('Imported · 14 plays');
    expect(seenSourceNote({ source: 'import', plays: 1 })).toBe('Imported · 1 play');
    expect(seenSourceNote({ source: 'import' })).toBe('Imported');
    expect(seenSourceNote({ source: 'manual' })).toBe('Marked watched');
    expect(seenSourceNote({ source: 'onboarding' })).toBe('From your first-run picks');
  });
  it('sorts newest first and filters by a typed search', () => {
    const rows = [
      { id: '1', at: 1, title: 'Scrubs' },
      { id: '2', at: 3, title: 'The Office' },
      { id: '3', at: 2, title: 'Office Space' },
    ];
    expect(sortSeen(rows, '').map((r) => r.id)).toEqual(['2', '3', '1']);
    expect(sortSeen(rows, '  OFFICE ').map((r) => r.id)).toEqual(['2', '3']);
    expect(sortSeen(rows, 'zzz')).toEqual([]);
  });
  it('formats counts with separators', () => {
    expect(formatCount(12345)).toBe('12,345');
  });
});
