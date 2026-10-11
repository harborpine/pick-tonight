import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedState, SyncApi } from '../contracts';
import { card, request, seed, snap } from './fixtures';
import { createSync } from './index';

let sync: SyncApi;
let last: SharedState | null;
beforeEach(async () => {
  sync = createSync({ mode: 'memory' });
  await sync.init();
  last = null;
  sync.onState((s) => (last = s));
  await sync.createHousehold('HG', seed());
});

describe('memory sync (SyncApi contract)', () => {
  it('goes loading -> unpaired -> paired', async () => {
    const s2 = createSync({ mode: 'memory' });
    expect(s2.getDevice().status).toBe('loading');
    await s2.init();
    expect(s2.getDevice().status).toBe('unpaired');
    expect(sync.getDevice()).toEqual({ status: 'paired', person: 'HG', error: null });
    expect(sync.getState()).not.toBeNull();
  });

  const watched = (itemId: string, extra = {}) => ({ itemId, source: 'manual' as const, snapshot: snap(itemId), ...extra });

  it('watched / never / notTonight are per person and reversible', async () => {
    await sync.markWatched('HG', [watched('tv-5'), watched('tv-6')]);
    await sync.markWatched('BG', [watched('tv-5')]);
    expect(Object.keys(last!.seen.HG).sort()).toEqual(['tv-5', 'tv-6']);
    await sync.unmarkWatched('HG', ['tv-6']);
    expect(Object.keys(last!.seen.HG)).toEqual(['tv-5']);
    expect(Object.keys(last!.seen.BG)).toEqual(['tv-5']);
    await sync.setNever('BG', 'tv-7', true);
    expect(last!.never.BG['tv-7']).toBeTypeOf('number');
    await sync.setNever('BG', 'tv-7', false);
    expect(last!.never.BG['tv-7']).toBeUndefined();
    await sync.setNotTonight('HG', 'tv-8', '2026-10-10');
    expect(last!.notTonight.HG['tv-8']).toBe('2026-10-10');
  });

  it('markWatched: at defaults to now, snapshot kept; re-marking takes the newer at and larger plays', async () => {
    const before = Date.now();
    await sync.markWatched('HG', [watched('tv-5', { source: 'import', plays: 3, at: 1000 })]);
    expect(last!.seen.HG['tv-5']).toEqual({ at: 1000, source: 'import', plays: 3, snapshot: snap('tv-5') });
    await sync.markWatched('HG', [watched('tv-5', { at: 500, plays: 1 })]);
    expect(last!.seen.HG['tv-5']).toMatchObject({ at: 1000, plays: 3, source: 'manual' });
    await sync.markWatched('HG', [watched('tv-5')]);
    expect(last!.seen.HG['tv-5']!.at).toBeGreaterThanOrEqual(before);
    expect(last!.seen.HG['tv-5']!.plays).toBe(3);
    await sync.markWatched('HG', [watched('tv-9')]);
    expect(last!.seen.HG['tv-9']!.plays).toBeUndefined();
  });

  it('markWatched copes with thousands of entries in one call', async () => {
    await sync.markWatched('BG', Array.from({ length: 3000 }, (_, i) => watched(`tv-${i}`, { source: 'import', at: i + 1 })));
    expect(Object.keys(last!.seen.BG)).toHaveLength(3000);
    await sync.unmarkWatched('BG', Array.from({ length: 3000 }, (_, i) => `tv-${i}`));
    expect(Object.keys(last!.seen.BG)).toHaveLength(0);
  });

  it('refuses (changing nothing) past the per-person ceiling', async () => {
    const many = Array.from({ length: 19501 }, (_, i) => watched(`tv-${i}`));
    await expect(sync.markWatched('HG', many)).rejects.toThrow(/most this app can keep/);
    expect(Object.keys(last!.seen.HG)).toHaveLength(0);
  });

  it('notifies with a new object each time', async () => {
    const before = last;
    await sync.markWatched('HG', [watched('tv-5')]);
    expect(last).not.toBe(before);
  });

  it('watchlist keeps one entry per (title, list)', async () => {
    await sync.addToWatchlist('ours', 'tv-1', 'HG', snap());
    await sync.addToWatchlist('ours', 'tv-1', 'BG', snap());
    await sync.addToWatchlist('HG', 'tv-1', 'HG', snap());
    expect(last!.watchlist).toHaveLength(2);
    await sync.removeFromWatchlist('ours', 'tv-1');
    expect(last!.watchlist.map((w) => w.list)).toEqual(['HG']);
  });

  it('picks: solo picks newest first; the same title for the same person is not added twice', async () => {
    const e = { kind: 'solo' as const, who: 'HG' as const, itemId: 'tv-1', snapshot: snap(), pick: { type: 'movie' as const }, service: card('x').service };
    await sync.addPick(e);
    await sync.addPick({ ...e, itemId: 'tv-2' });
    await sync.addPick(e); // duplicate: does nothing
    expect(last!.picks.map((h) => h.itemId)).toEqual(['tv-2', 'tv-1']);
    expect(last!.picks[0]!.id).toBeTruthy();
    await sync.addPick({ ...e, who: 'BG' }); // another person may pick the same title
    expect(last!.picks).toHaveLength(3);
  });

  it('removePick removes just that line', async () => {
    const e = { kind: 'solo' as const, who: 'HG' as const, itemId: 'tv-1', snapshot: snap(), pick: { type: 'movie' as const }, service: card('x').service };
    await sync.addPick(e);
    await sync.addPick({ ...e, itemId: 'tv-2' });
    await sync.removePick(last!.picks.find((p) => p.itemId === 'tv-1')!.id);
    expect(last!.picks.map((h) => h.itemId)).toEqual(['tv-2']);
    await sync.removePick('does-not-exist');
    expect(last!.picks).toHaveLength(1);
    await sync.addPick(e); // can be picked again after removal
    expect(last!.picks).toHaveLength(2);
  });

  it('profiles and settings save', async () => {
    await sync.saveProfile({ ...last!.profiles.BG, onboarded: true });
    expect(last!.profiles.BG.onboarded).toBe(true);
    await sync.saveSettings({ plans: { ...last!.settings.plans, netflix: null } });
    expect(last!.settings.plans.netflix).toBeNull();
  });

  it('Together: match is recorded exactly once, in the session and in picks', async () => {
    const id = await sync.startSession('HG', request, [card('tv-1'), card('tv-2')]);
    expect(last!.activeSession?.joined).toEqual(['HG']);
    await sync.joinSession(id, 'BG');
    expect(last!.activeSession?.joined).toEqual(['HG', 'BG']);
    expect(await sync.swipeInSession(id, 'HG', 'tv-1', true, snap('One'))).toBe(false);
    expect(await sync.swipeInSession(id, 'BG', 'tv-2', false, snap())).toBe(false);
    expect(await sync.swipeInSession(id, 'BG', 'tv-1', true, snap('One'))).toBe(true);
    expect(await sync.swipeInSession(id, 'BG', 'tv-1', true, snap('One'))).toBe(false);
    expect(await sync.swipeInSession(id, 'HG', 'tv-1', true, snap('One'))).toBe(false);
    expect(last!.activeSession!.matches).toHaveLength(1);
    expect(last!.picks.filter((h) => h.kind === 'match')).toHaveLength(1);
    expect(last!.picks[0]).toMatchObject({ who: 'Together', itemId: 'tv-1', sessionId: id });
  });

  it('Together: appendSessionDeck ignores duplicates; startSession replaces; endSession clears', async () => {
    const id = await sync.startSession('HG', request, [card('tv-1')]);
    await sync.appendSessionDeck(id, [card('tv-1'), card('tv-3')]);
    expect(last!.activeSession!.deck.map((c) => c.itemId)).toEqual(['tv-1', 'tv-3']);
    const id2 = await sync.startSession('BG', request, [card('tv-9')]);
    expect(last!.activeSession!.id).toBe(id2);
    await expect(sync.joinSession(id, 'BG')).rejects.toThrow();
    await sync.endSession(id2);
    expect(last!.activeSession).toBeNull();
  });

  it('unpair forgets the pairing', async () => {
    await sync.unpair();
    expect(sync.getDevice().status).toBe('unpaired');
  });
});

describe('memory sync reads data saved by the first app version', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('numeric seen values and the old "history" list come out as the new shapes', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    const old = { id: 'h1', at: 5, kind: 'solo', who: 'HG', itemId: 'tv-1', snapshot: snap(), pick: { type: 'movie' }, service: card('x').service };
    const first = createSync({ mode: 'memory' });
    await first.init();
    await first.createHousehold('HG', seed());
    const saved = JSON.parse(store.get('wtw.memory-sync.v1')!);
    saved.state.seen.HG = { 'tv-9': 123 };
    delete saved.state.picks;
    saved.state.history = [old];
    store.set('wtw.memory-sync.v1', JSON.stringify(saved));
    const again = createSync({ mode: 'memory' });
    await again.init();
    expect(again.getState()!.seen.HG['tv-9']).toEqual({ at: 123, source: 'manual' });
    expect(again.getState()!.picks).toEqual([old]);
  });
});
