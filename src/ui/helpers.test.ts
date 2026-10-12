import { describe, expect, it } from 'vitest';
import { FIXTURE_MEMBERS } from '../contracts/fixtures/catalog';
import type { DeckCard, Member, PickEntry, TogetherSession } from '../contracts';
import {
  TIME_OPTIONS,
  buildInviteLink,
  cleanWho,
  filterPicks,
  formatCount,
  formatDate,
  formatMinutes,
  joinNames,
  joinPromptText,
  looseningHints,
  matchHeadline,
  memberFilter,
  needsToJoin,
  neighbourStep,
  nextUnshownMatch,
  normalizeCode,
  inSession,
  othersPickingText,
  pickLabel,
  pickText,
  pickWatchers,
  remainingSessionCards,
  resumeStep,
  saveOptions,
  seenSourceNote,
  sessionPosition,
  sessionWaitingFor,
  sessionWithoutMe,
  sortSeen,
  spacedCode,
  timeLabel,
  todayLocal,
  toggleWho,
  validateName,
  watchedButtonText,
  whoLabel,
  wizardProgress,
  wizardSteps,
} from './helpers';

const M = FIXTURE_MEMBERS;
const members3: Record<string, Member> = { alex: M.alex, sam: M.sam, kit: M.kit };
const members2: Record<string, Member> = { alex: M.alex, sam: M.sam };
const members1: Record<string, Member> = { alex: M.alex };

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
    startedBy: 'alex',
    request: { who: ['alex', 'sam'], viewing: 'focused', mood: 'laugh', time: 60, novelty: 'either', genre: null },
    deck: [card('a'), card('b'), card('c')],
    joined: ['alex'],
    yes: { alex: [], sam: [] },
    passed: { alex: [], sam: [] },
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
    expect(pickText({ type: 'season', season: 21 })).toBe('Watch the new season (Season 21)');
    expect(pickText({ type: 'any-episode' })).toBe('Put on any episode');
    expect(pickText({ type: 'episode', season: 3, episode: 14, name: 'My Screw Up' })).toBe('Season 3, Episode 14 — “My Screw Up”');
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

describe('names', () => {
  it('accepts 1 to 20 characters and trims / collapses spaces', () => {
    expect(validateName('  Alex  ', [])).toEqual({ ok: true, name: 'Alex' });
    expect(validateName('Mary   Jane', [])).toEqual({ ok: true, name: 'Mary Jane' });
    expect(validateName('x'.repeat(20), []).ok).toBe(true);
  });
  it('rejects empty, too long and taken names (case-insensitive)', () => {
    expect(validateName('   ', []).ok).toBe(false);
    expect(validateName('x'.repeat(21), []).ok).toBe(false);
    const taken = validateName('SAM', ['Alex', 'Sam']);
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.message).toContain('already called');
  });
  it('joins names for 1 to 4 people', () => {
    expect(joinNames(['Alex'])).toBe('Alex');
    expect(joinNames(['Alex', 'Sam'])).toBe('Alex and Sam');
    expect(joinNames(['Alex', 'Sam', 'Kit'])).toBe('Alex, Sam and Kit');
    expect(joinNames(['A', 'B', 'C', 'D'], '&')).toBe('A, B, C & D');
  });
});

describe('who normalisation and labels', () => {
  it('labels audiences of one, two and three, ignoring people who left', () => {
    expect(whoLabel(['alex'], members3)).toBe('Alex');
    expect(whoLabel(['alex', 'sam'], members3)).toBe('Alex & Sam');
    expect(whoLabel(['alex', 'kit', 'sam'], members3)).toBe('Alex, Kit & Sam');
    expect(whoLabel(['gone', 'sam'], members3)).toBe('Sam');
    expect(whoLabel(['gone'], members3)).toBe('Someone');
  });
  it('never lets the selection go empty', () => {
    expect(toggleWho(['alex'], 'alex', 'alex')).toEqual(['alex']);
  });
  it('sorts and always includes me in a group', () => {
    expect(toggleWho(['alex'], 'sam', 'alex')).toEqual(['alex', 'sam']);
    expect(toggleWho(['sam'], 'kit', 'alex')).toEqual(['alex', 'kit', 'sam']); // me is pulled in
    expect(toggleWho(['alex', 'sam'], 'alex', 'alex')).toEqual(['sam']); // picking for Sam alone
    expect(toggleWho(['alex', 'sam', 'kit'], 'kit', 'alex')).toEqual(['alex', 'sam']);
  });
  it('cleans a remembered audience against the current members', () => {
    expect(cleanWho(['sam', 'gone'], members2, 'alex')).toEqual(['sam']);
    expect(cleanWho(['gone'], members2, 'alex')).toEqual(['alex']);
    expect(cleanWho('nonsense', members1, 'alex')).toEqual(['alex']);
    expect(cleanWho(['kit', 'sam'], members3, 'alex')).toEqual(['alex', 'kit', 'sam']);
  });
  it('says Everyone’s in for three or more', () => {
    expect(matchHeadline(2)).toBe('It’s a match!');
    expect(matchHeadline(3)).toBe('Everyone’s in!');
    expect(matchHeadline(4)).toBe('Everyone’s in!');
  });
});

describe('session position', () => {
  it('starts at the first card and skips answered ones in deck order', () => {
    const s = session({ yes: { alex: ['a'], sam: [] }, passed: { alex: ['b'], sam: [] } });
    expect(sessionPosition(s, 'alex')).toBe(2);
    expect(remainingSessionCards(s, 'alex').map((c) => c.itemId)).toEqual(['c']);
    expect(sessionPosition(s, 'sam')).toBe(0);
  });
  it('reports the deck length when finished and picks up appended cards', () => {
    const s = session({ yes: { alex: ['a', 'b', 'c'], sam: [] } });
    expect(sessionPosition(s, 'alex')).toBe(3);
    expect(remainingSessionCards(s, 'alex')).toEqual([]);
    s.deck.push(card('d'));
    expect(remainingSessionCards(s, 'alex').map((c) => c.itemId)).toEqual(['d']);
  });
});

describe('joining and matches', () => {
  it('prompts only audience members who have not joined an open session', () => {
    expect(needsToJoin(session(), 'sam')).toBe(true);
    expect(needsToJoin(session(), 'alex')).toBe(false);
    expect(needsToJoin(session(), 'kit')).toBe(false); // not in the audience
    expect(needsToJoin(session({ joined: ['alex', 'sam'] }), 'sam')).toBe(false);
    expect(needsToJoin(session({ status: 'ended' }), 'sam')).toBe(false);
    expect(needsToJoin(null, 'sam')).toBe(false);
  });
  it('knows who is in a session and who is outside it', () => {
    expect(inSession(session(), 'alex')).toBe(true);
    expect(inSession(session(), 'sam')).toBe(false);
    expect(inSession(session(), 'kit')).toBe(false);
    expect(sessionWithoutMe(session(), 'kit')).toBe(true);
    expect(sessionWithoutMe(session(), 'sam')).toBe(false);
    expect(sessionWithoutMe(session({ status: 'ended' }), 'kit')).toBe(false);
    expect(sessionWaitingFor(session({ request: { ...session().request, who: ['alex', 'kit', 'sam'] }, joined: ['alex', 'kit'] }))).toEqual(['sam']);
  });
  it('words the join prompt and the quiet line', () => {
    expect(joinPromptText(session(), members3, 'sam')).toBe('Alex started a session with you');
    const three = session({ request: { ...session().request, who: ['alex', 'kit', 'sam'] } });
    expect(joinPromptText(three, members3, 'sam')).toBe('Alex started a session with you and Kit');
    expect(joinPromptText(three, members3, 'kit')).toBe('Alex started a session with you and Sam');
    expect(othersPickingText(session(), members3)).toBe('Alex and Sam are picking together');
  });
  it('finds matches not shown yet', () => {
    const s = session({ matches: [{ itemId: 'a', at: 1 }, { itemId: 'b', at: 2 }] });
    expect(nextUnshownMatch(s, 0)).toBe(0);
    expect(nextUnshownMatch(s, 1)).toBe(1);
    expect(nextUnshownMatch(s, 2)).toBe(-1);
  });
});

describe('saveOptions', () => {
  it('offers Mine / Ours (default Ours) for a group', () => {
    const r = saveOptions('alex', ['alex', 'sam'], members3);
    expect(r.defaultList).toBe('ours');
    expect(r.options.map((o) => o.list)).toEqual(['alex', 'ours']);
  });
  it('offers the other person’s list only when picking for them', () => {
    expect(saveOptions('alex', ['alex'], members3).options.map((o) => o.list)).toEqual(['alex', 'ours']);
    const r = saveOptions('alex', ['sam'], members3);
    expect(r.options.map((o) => o.list)).toEqual(['sam', 'alex', 'ours']);
    expect(r.options[0].label).toBe('Sam’s');
    expect(r.defaultList).toBe('sam');
  });
  it('has a single list in a household of one', () => {
    const r = saveOptions('alex', ['alex'], members1);
    expect(r.options.map((o) => o.list)).toEqual(['alex']);
  });
});

describe('looseningHints', () => {
  it('suggests only what can still be loosened', () => {
    const hints = looseningHints({ who: ['alex'], viewing: 'background', mood: 'laugh', time: 20, novelty: 'new', genre: 'comedy' });
    expect(hints.length).toBe(5);
    const open = looseningHints({ who: ['alex'], viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either', genre: null });
    expect(open).toEqual(['Try a different mood.']);
    expect(looseningHints({ who: ['alex'], viewing: 'focused', mood: 'laugh', time: 'any', novelty: 'either', genre: null })).toEqual(['Try a different mood.']);
  });
});

const pickEntry = (over: Partial<PickEntry>): PickEntry => ({
  id: 'p',
  at: 1,
  kind: 'solo',
  who: ['alex'],
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
    pickEntry({ id: 'm1', at: 5, kind: 'match', who: ['alex', 'sam'] }),
    pickEntry({ id: 'm2', at: 6, kind: 'match', who: ['alex', 'kit', 'sam'] }),
    pickEntry({ id: 's1', at: 9, who: ['alex'] }),
    pickEntry({ id: 's2', at: 7, who: ['sam'] }),
    pickEntry({ id: 's3', at: 1, who: ['alex'] }),
    pickEntry({ id: 's4', at: 2, kind: 'solo', who: ['alex', 'sam'] }), // liked from the New feed for a group
  ];
  it('shows everything newest first', () => {
    expect(filterPicks(picks, 'all', 'alex').map((p) => p.id)).toEqual(['s1', 's2', 'm2', 'm1', 's4', 's3']);
  });
  it('Mine = only me; a member = only them; Together = any group', () => {
    expect(filterPicks(picks, 'mine', 'alex').map((p) => p.id)).toEqual(['s1', 's3']);
    expect(filterPicks(picks, 'mine', 'sam').map((p) => p.id)).toEqual(['s2']);
    expect(filterPicks(picks, memberFilter('sam'), 'alex').map((p) => p.id)).toEqual(['s2']);
    expect(filterPicks(picks, 'together', 'alex').map((p) => p.id)).toEqual(['m2', 'm1', 's4']);
  });
  it('labels picks and decides who is marked watched', () => {
    expect(pickLabel(pickEntry({ kind: 'match', who: ['alex', 'sam'] }), members3)).toBe('Match — Alex & Sam');
    expect(pickLabel(pickEntry({ kind: 'match', who: ['alex', 'kit', 'sam'] }), members3)).toBe('Match — Alex, Kit & Sam');
    expect(pickLabel(pickEntry({ who: ['kit'] }), members3)).toBe('Liked by Kit');
    expect(pickWatchers(pickEntry({ kind: 'match', who: ['alex', 'sam', 'gone'] }), members3)).toEqual(['alex', 'sam']);
    expect(watchedButtonText(pickEntry({ kind: 'match', who: ['alex', 'sam'] }), 'alex', members3)).toBe('We watched this');
    expect(watchedButtonText(pickEntry({ who: ['alex'] }), 'alex', members3)).toBe('I watched this');
    expect(watchedButtonText(pickEntry({ who: ['kit'] }), 'alex', members3)).toBe('Kit watched this');
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

describe('invites', () => {
  it('builds the link with or without a trailing slash and drops any old query', () => {
    expect(buildInviteLink('https://x.github.io/pick-tonight/', 'ABC234')).toBe('https://x.github.io/pick-tonight/?join=ABC234');
    expect(buildInviteLink('https://x.github.io/pick-tonight', 'ABC234')).toBe('https://x.github.io/pick-tonight/?join=ABC234');
    expect(buildInviteLink('https://x.github.io/pick-tonight/?join=OLD#a', 'NEW234')).toBe('https://x.github.io/pick-tonight/?join=NEW234');
  });
  it('tidies a typed code and spaces it for reading', () => {
    expect(normalizeCode(' abc-234 ')).toBe('ABC234');
    expect(spacedCode('ABC234')).toBe('ABC 234');
    expect(spacedCode('AB')).toBe('AB');
  });
});

describe('first-run steps', () => {
  it('has six steps for the household creator and five for a joiner', () => {
    expect(wizardSteps('creator')).toEqual(['name', 'services', 'favorites', 'never', 'import', 'seen']);
    expect(wizardSteps('joiner')).toEqual(['name', 'favorites', 'never', 'import', 'seen']);
  });
  it('counts progress per role', () => {
    expect(wizardProgress('creator', 'favorites')).toEqual({ index: 2, total: 6 });
    expect(wizardProgress('joiner', 'favorites')).toEqual({ index: 1, total: 5 });
    expect(wizardProgress('joiner', 'seen')).toEqual({ index: 4, total: 5 });
  });
  it('resumes at the saved step, never before favourites', () => {
    expect(resumeStep('creator', 'import')).toBe('import');
    expect(resumeStep('creator', null)).toBe('favorites');
    expect(resumeStep('joiner', 'services')).toBe('favorites');
    expect(resumeStep('joiner', 'name')).toBe('favorites');
    expect(resumeStep('creator', 'junk')).toBe('favorites');
  });
  it('walks forward and back without a services step for joiners', () => {
    expect(neighbourStep('creator', 'name', 1)).toBe('services');
    expect(neighbourStep('joiner', 'name', 1)).toBe('favorites');
    expect(neighbourStep('joiner', 'favorites', -1)).toBe('name');
    expect(neighbourStep('creator', 'seen', 1)).toBeNull();
    expect(neighbourStep('creator', 'name', -1)).toBeNull();
  });
});
