import { beforeEach, describe, expect, it } from 'vitest';
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

  it('seen / never / notTonight are per person and reversible', async () => {
    await sync.setSeen('HG', ['tv-5', 'tv-6'], true);
    await sync.setSeen('BG', ['tv-5'], true);
    expect(Object.keys(last!.seen.HG).sort()).toEqual(['tv-5', 'tv-6']);
    await sync.setSeen('HG', ['tv-6'], false);
    expect(Object.keys(last!.seen.HG)).toEqual(['tv-5']);
    expect(Object.keys(last!.seen.BG)).toEqual(['tv-5']);
    await sync.setNever('BG', 'tv-7', true);
    expect(last!.never.BG['tv-7']).toBeTypeOf('number');
    await sync.setNever('BG', 'tv-7', false);
    expect(last!.never.BG['tv-7']).toBeUndefined();
    await sync.setNotTonight('HG', 'tv-8', '2026-10-10');
    expect(last!.notTonight.HG['tv-8']).toBe('2026-10-10');
  });

  it('notifies with a new object each time', async () => {
    const before = last;
    await sync.setSeen('HG', ['tv-5'], true);
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

  it('history: solo picks newest first', async () => {
    const e = { kind: 'solo' as const, who: 'HG' as const, itemId: 'tv-1', snapshot: snap(), pick: { type: 'movie' as const }, service: card('x').service };
    await sync.addHistory(e);
    await sync.addHistory({ ...e, itemId: 'tv-2' });
    expect(last!.history.map((h) => h.itemId)).toEqual(['tv-2', 'tv-1']);
    expect(last!.history[0]!.id).toBeTruthy();
  });

  it('profiles and settings save', async () => {
    await sync.saveProfile({ ...last!.profiles.BG, onboarded: true });
    expect(last!.profiles.BG.onboarded).toBe(true);
    await sync.saveSettings({ plans: { ...last!.settings.plans, netflix: null } });
    expect(last!.settings.plans.netflix).toBeNull();
  });

  it('Together: match is recorded exactly once, in the session and in history', async () => {
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
    expect(last!.history.filter((h) => h.kind === 'match')).toHaveLength(1);
    expect(last!.history[0]).toMatchObject({ who: 'Together', itemId: 'tv-1', sessionId: id });
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
