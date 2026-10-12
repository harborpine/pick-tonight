import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedState } from '../contracts';
import { card, profile, requestFor, settings, snap } from './fixtures';
import { createMemorySync, MEMORY_KEY, type MemorySyncApi } from './memory';
import { DEFAULT_APP_NAME, STORE_KEY } from './firebase';
import { createSync } from './index';

let sync: MemorySyncApi;
let last: SharedState | null;
beforeEach(async () => {
  sync = createMemorySync();
  await sync.init();
  last = null;
  sync.onState((s) => (last = s));
  await sync.createHousehold('Alex', profile(['tv-1']), settings());
});

const watched = (itemId: string, extra = {}) => ({ itemId, source: 'manual' as const, snapshot: snap(itemId), ...extra });
const soloPick = (who: string[], itemId: string) => ({ kind: 'solo' as const, who, itemId, snapshot: snap(), pick: { type: 'movie' as const }, service: card('x').service });

describe('household basics', () => {
  it('goes loading -> unpaired -> paired, as member m1', async () => {
    const s2 = createSync({ mode: 'memory' });
    expect(s2.getDevice().status).toBe('loading');
    await s2.init();
    expect(s2.getDevice().status).toBe('unpaired');
    expect(sync.getDevice()).toEqual({ status: 'paired', memberId: 'm1', error: null });
    expect(last!.members.m1).toMatchObject({ id: 'm1', name: 'Alex' });
    expect(last!.profiles.m1).toMatchObject({ id: 'm1' });
    expect(last!.profiles.m1!.favorites).toHaveLength(1);
    expect(last!.settings.plans.netflix).toBe('standard');
  });

  it('refuses bad names when creating', async () => {
    const s2 = createMemorySync();
    await s2.init();
    await expect(s2.createHousehold('', profile(), settings())).rejects.toThrow(/name/);
    await expect(s2.createHousehold('x'.repeat(21), profile(), settings())).rejects.toThrow(/at most 20/);
  });

  it('watched / never / notTonight are per person and reversible', async () => {
    const id = await sync.debugAddMember('Sam', profile());
    await sync.markWatched('m1', [watched('tv-5'), watched('tv-6')]);
    await sync.markWatched(id, [watched('tv-5')]);
    expect(Object.keys(last!.seen.m1!).sort()).toEqual(['tv-5', 'tv-6']);
    await sync.unmarkWatched('m1', ['tv-6']);
    expect(Object.keys(last!.seen.m1!)).toEqual(['tv-5']);
    expect(Object.keys(last!.seen[id]!)).toEqual(['tv-5']);
    await sync.setNever(id, 'tv-7', true);
    expect(last!.never[id]!['tv-7']).toBeTypeOf('number');
    await sync.setNever(id, 'tv-7', false);
    expect(last!.never[id]!['tv-7']).toBeUndefined();
    await sync.setNotTonight('m1', 'tv-8', '2026-10-10');
    expect(last!.notTonight.m1!['tv-8']).toBe('2026-10-10');
  });

  it('markWatched: at defaults to now; re-marking takes the newer at and larger plays', async () => {
    const before = Date.now();
    await sync.markWatched('m1', [watched('tv-5', { source: 'import', plays: 3, at: 1000 })]);
    expect(last!.seen.m1!['tv-5']).toEqual({ at: 1000, source: 'import', plays: 3, snapshot: snap('tv-5') });
    await sync.markWatched('m1', [watched('tv-5', { at: 500, plays: 1 })]);
    expect(last!.seen.m1!['tv-5']).toMatchObject({ at: 1000, plays: 3, source: 'manual' });
    await sync.markWatched('m1', [watched('tv-5')]);
    expect(last!.seen.m1!['tv-5']!.at).toBeGreaterThanOrEqual(before);
    await sync.markWatched('m1', [watched('tv-9')]);
    expect(last!.seen.m1!['tv-9']!.plays).toBeUndefined();
  });

  it('markWatched copes with thousands of entries, and refuses past the ceiling', async () => {
    await sync.markWatched('m1', Array.from({ length: 3000 }, (_, i) => watched(`tv-${i}`, { source: 'import', at: i + 1 })));
    expect(Object.keys(last!.seen.m1!)).toHaveLength(3000);
    await sync.unmarkWatched('m1', Array.from({ length: 3000 }, (_, i) => `tv-${i}`));
    expect(Object.keys(last!.seen.m1!)).toHaveLength(0);
    await expect(sync.markWatched('m1', Array.from({ length: 10001 }, (_, i) => watched(`tv-${i}`)))).rejects.toThrow(/most this app can keep/);
    expect(Object.keys(last!.seen.m1!)).toHaveLength(0);
  });

  it('notifies with a new object each time', async () => {
    const before = last;
    await sync.markWatched('m1', [watched('tv-5')]);
    expect(last).not.toBe(before);
  });

  it('watchlist keeps one entry per (title, list)', async () => {
    await sync.addToWatchlist('ours', 'tv-1', 'm1', snap());
    await sync.addToWatchlist('ours', 'tv-1', 'm1', snap());
    await sync.addToWatchlist('m1', 'tv-1', 'm1', snap());
    expect(last!.watchlist).toHaveLength(2);
    await sync.removeFromWatchlist('ours', 'tv-1');
    expect(last!.watchlist.map((w) => w.list)).toEqual(['m1']);
  });

  it('picks: newest first; the same title for the same audience is not added twice; removal works', async () => {
    const e = soloPick(['m1'], 'tv-1');
    await sync.addPick(e);
    await sync.addPick({ ...e, itemId: 'tv-2' });
    await sync.addPick(e);
    expect(last!.picks.map((h) => h.itemId)).toEqual(['tv-2', 'tv-1']);
    const id2 = await sync.debugAddMember('Sam', profile());
    await sync.addPick({ ...e, who: [id2] });
    expect(last!.picks).toHaveLength(3);
    await sync.removePick(last!.picks.find((p) => p.itemId === 'tv-1' && p.who[0] === 'm1')!.id);
    expect(last!.picks).toHaveLength(2);
    await sync.removePick('does-not-exist');
    expect(last!.picks).toHaveLength(2);
    await sync.addPick(e);
    expect(last!.picks).toHaveLength(3);
  });

  it('profiles and settings save', async () => {
    await sync.saveProfile({ ...last!.profiles.m1!, onboarded: true });
    expect(last!.profiles.m1!.onboarded).toBe(true);
    await sync.saveSettings({ plans: { ...last!.settings.plans, netflix: null } });
    expect(last!.settings.plans.netflix).toBeNull();
  });

  it('unpair keeps the household; deleteHousehold wipes it', async () => {
    await sync.unpair();
    expect(sync.getDevice()).toMatchObject({ status: 'unpaired', memberId: null });
    expect(sync.getState()).toBeNull();
    await expect(sync.markWatched('m1', [watched('x')])).rejects.toThrow(/not in a household/);
  });
});

describe('members, invites and joining (up to four)', () => {
  const join = async (code: string, name: string) => sync.joinWithCode(code, { name, profile: profile() });

  it('invite -> preview -> join as new members up to 4; the fifth is refused; names are unique', async () => {
    const code = await sync.createInvite();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await sync.previewInvite(code.toLowerCase())).toEqual({ members: [{ id: 'm1', name: 'Alex' }], full: false });
    await expect(join(code, ' alex ')).rejects.toThrow(/already has that name/);
    await join(code, 'Sam');
    expect(sync.getDevice()).toMatchObject({ status: 'paired', memberId: 'm2' });
    expect(Object.keys(last!.members)).toEqual(['m1', 'm2']);
    await expect(join(code, 'Kit')).rejects.toThrow(/already been used/);
    await expect(sync.previewInvite(code)).rejects.toThrow(/already been used/);

    const c2 = await sync.createInvite();
    await join(c2, 'Kit');
    const c3 = await sync.createInvite();
    expect((await sync.previewInvite(c3)).full).toBe(false);
    await join(c3, 'Robin');
    expect(Object.keys(last!.members)).toEqual(['m1', 'm2', 'm3', 'm4']);
    const c4 = await sync.createInvite();
    expect((await sync.previewInvite(c4)).full).toBe(true);
    await expect(join(c4, 'Fifth')).rejects.toThrow(/already has 4 people/);
    await expect(sync.debugAddMember('Fifth', profile())).rejects.toThrow(/already has 4 people/);
    for (const id of ['m1', 'm2', 'm3', 'm4']) {
      expect(last!.profiles[id]).toBeDefined();
      expect(last!.seen[id]).toEqual({});
    }
  });

  it('wrong, malformed and expired codes give plain messages', async () => {
    await expect(sync.previewInvite('ABCDEF')).rejects.toThrow(/isn't right/);
    await expect(sync.previewInvite('12')).rejects.toThrow(/isn't right/);
    vi.useFakeTimers();
    try {
      const code = await sync.createInvite();
      vi.setSystemTime(Date.now() + 25 * 3600 * 1000);
      await expect(sync.previewInvite(code)).rejects.toThrow(/run out of time/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-claim: "I\'m already a member" takes over an existing member', async () => {
    const id2 = await sync.debugAddMember('Sam', profile(['tv-9']));
    sync.debugActAs('m1');
    const code = await sync.createInvite();
    await sync.joinWithCode(code, { memberId: id2 });
    expect(sync.getDevice()).toMatchObject({ status: 'paired', memberId: id2 });
    expect(Object.keys(last!.members)).toEqual(['m1', id2]); // nobody new
    expect(last!.profiles[id2]!.favorites).toHaveLength(1); // profile kept
    const c2 = await sync.createInvite();
    await expect(sync.joinWithCode(c2, { memberId: 'm99' })).rejects.toThrow(/isn't in this household/);
  });

  it('ids are never reused, even after someone leaves', async () => {
    await sync.debugAddMember('Sam', profile()); // m2
    await sync.removeMember('m2');
    const id3 = await sync.debugAddMember('Kit', profile());
    expect(id3).toBe('m3');
  });

  it('renameMember validates and keeps names unique', async () => {
    const id2 = await sync.debugAddMember('Sam', profile());
    await sync.renameMember(id2, 'Samantha');
    expect(last!.members[id2]!.name).toBe('Samantha');
    await expect(sync.renameMember(id2, 'ALEX')).rejects.toThrow(/already has that name/);
    await expect(sync.renameMember(id2, '')).rejects.toThrow(/name/);
    await expect(sync.renameMember(id2, 'y'.repeat(21))).rejects.toThrow(/at most 20/);
    await sync.renameMember('m1', 'ALEX'); // just a change of case
    expect(last!.members.m1!.name).toBe('ALEX');
  });

  it('removeMember wipes their personal data but keeps ours and matches', async () => {
    const id2 = await sync.debugAddMember('Sam', profile(['tv-2']));
    await sync.markWatched(id2, [watched('tv-5')]);
    await sync.setNever(id2, 'tv-6', true);
    await sync.setNotTonight(id2, 'tv-7', '2026-10-10');
    await sync.addToWatchlist(id2, 'tv-8', id2, snap());
    await sync.addToWatchlist('ours', 'tv-9', id2, snap());
    await sync.addPick(soloPick([id2], 'tv-10'));
    await sync.removeMember(id2);
    expect(Object.keys(last!.members)).toEqual(['m1']);
    for (const rec of [last!.profiles, last!.seen, last!.never, last!.notTonight]) expect(Object.keys(rec)).toEqual(['m1']);
    expect(last!.watchlist.map((w) => w.list)).toEqual(['ours']);
    expect(last!.picks).toHaveLength(1);
    expect(sync.getDevice().status).toBe('paired'); // removed someone else
  });

  it('removing yourself unpairs this phone; removing the last member deletes the household', async () => {
    const id2 = await sync.debugAddMember('Sam', profile());
    sync.debugActAs(id2);
    await sync.removeMember(id2);
    expect(sync.getDevice()).toMatchObject({ status: 'unpaired', memberId: null });

    const solo = createMemorySync();
    await solo.init();
    await solo.createHousehold('Alone', profile(), settings());
    await solo.removeMember('m1');
    expect(solo.getDevice().status).toBe('unpaired');
    expect(solo.getState()).toBeNull();
    await expect(solo.previewInvite('ABCDEF')).rejects.toThrow();
  });

  it('deleteHousehold removes everything, including outstanding invites', async () => {
    const code = await sync.createInvite();
    await sync.deleteHousehold();
    expect(sync.getDevice().status).toBe('unpaired');
    expect(sync.getState()).toBeNull();
    await expect(sync.previewInvite(code)).rejects.toThrow(/isn't right/);
  });
});

describe('Together sessions with an audience', () => {
  const ids = async (n: number) => {
    const out = ['m1'];
    for (let i = 2; i <= n; i++) out.push(await sync.debugAddMember(`P${i}`, profile()));
    return out;
  };

  it('a pair: match recorded exactly once, in the session and in picks', async () => {
    const [a, b] = await ids(2);
    const id = await sync.startSession(a!, requestFor([a!, b!]), [card('tv-1'), card('tv-2')]);
    expect(last!.activeSession).toMatchObject({ joined: [a], yes: { [a!]: [], [b!]: [] }, passed: { [a!]: [], [b!]: [] } });
    await sync.joinSession(id, b!);
    expect(last!.activeSession!.joined).toEqual([a, b]);
    expect(await sync.swipeInSession(id, a!, 'tv-1', true, snap('One'))).toBe(false);
    expect(await sync.swipeInSession(id, b!, 'tv-2', false, snap())).toBe(false);
    expect(await sync.swipeInSession(id, b!, 'tv-1', true, snap('One'))).toBe(true);
    expect(await sync.swipeInSession(id, b!, 'tv-1', true, snap('One'))).toBe(false);
    expect(await sync.swipeInSession(id, a!, 'tv-1', true, snap('One'))).toBe(false);
    expect(last!.activeSession!.matches).toHaveLength(1);
    expect(last!.picks.filter((h) => h.kind === 'match')).toHaveLength(1);
    expect(last!.picks[0]).toMatchObject({ who: [a, b], itemId: 'tv-1', sessionId: id });
  });

  for (const n of [3, 4]) {
    it(`${n} people: matches only when all ${n} say yes`, async () => {
      const who = await ids(n);
      const id = await sync.startSession('m1', requestFor(who), [card('tv-1')]);
      for (const m of who.slice(0, -1)) expect(await sync.swipeInSession(id, m, 'tv-1', true, snap())).toBe(false);
      expect(last!.picks).toHaveLength(0);
      expect(await sync.swipeInSession(id, who[n - 1]!, 'tv-1', true, snap())).toBe(true);
      expect(last!.picks).toHaveLength(1);
      expect(last!.picks[0]!.who).toEqual(who);
    });
  }

  it('a pair inside a household of four does not need the other two', async () => {
    const all = await ids(4);
    const pair = [all[1]!, all[3]!];
    const id = await sync.startSession(pair[0]!, requestFor(pair), [card('tv-1')]);
    expect(Object.keys(last!.activeSession!.yes).sort()).toEqual(pair);
    expect(await sync.swipeInSession(id, all[0]!, 'tv-1', true, snap())).toBe(false); // not in the audience
    expect(await sync.swipeInSession(id, pair[0]!, 'tv-1', true, snap())).toBe(false);
    expect(await sync.swipeInSession(id, pair[1]!, 'tv-1', true, snap())).toBe(true);
    expect(last!.picks[0]!.who).toEqual(pair);
  });

  it('refuses a session for one person or for strangers', async () => {
    const [a, b] = await ids(2);
    await expect(sync.startSession(a!, requestFor([a!]), [card('tv-1')])).rejects.toThrow();
    await expect(sync.startSession(a!, requestFor([a!, 'm99']), [card('tv-1')])).rejects.toThrow();
    await expect(sync.startSession(a!, requestFor([b!, 'm99']), [card('tv-1')])).rejects.toThrow();
  });

  it('appendSessionDeck ignores duplicates; startSession replaces; endSession clears', async () => {
    const [a, b] = await ids(2);
    const id = await sync.startSession(a!, requestFor([a!, b!]), [card('tv-1')]);
    await sync.appendSessionDeck(id, [card('tv-1'), card('tv-3')]);
    expect(last!.activeSession!.deck.map((c) => c.itemId)).toEqual(['tv-1', 'tv-3']);
    const id2 = await sync.startSession(b!, requestFor([a!, b!]), [card('tv-9')]);
    expect(last!.activeSession!.id).toBe(id2);
    await expect(sync.joinSession(id, b!)).rejects.toThrow();
    await sync.endSession(id2);
    expect(last!.activeSession).toBeNull();
  });
});

describe('persistence', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('a reload restores the household and which member this device is', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    const first = createMemorySync();
    await first.init();
    await first.createHousehold('Alex', profile(), settings());
    const id = await first.debugAddMember('Sam', profile());
    first.debugActAs(id);
    const again = createMemorySync();
    await again.init();
    expect(again.getDevice()).toMatchObject({ status: 'paired', memberId: id });
    expect(Object.keys(again.getState()!.members)).toEqual(['m1', id]);
  });
});

describe('browser storage keys', () => {
  it('all start with pt. (the private app shares this origin)', () => {
    for (const k of [MEMORY_KEY, STORE_KEY]) expect(k.startsWith('pt.')).toBe(true);
    expect(DEFAULT_APP_NAME).toBe('pt');
  });
});
