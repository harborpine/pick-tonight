import type { Page } from '@playwright/test';
import { act, fillAsk, openTab, sharedState, swipeCard, tid } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

test.describe.configure({ retries: 1, timeout: 240_000 });

async function deckIds(page: Page): Promise<string[]> {
  const s = await sharedState(page);
  return (s.activeSession?.deck ?? []).map((c: { itemId: string }) => c.itemId);
}

async function expectMatchScreen(page: Page, id: string, headline: string) {
  const m = tid(page, 'match-screen');
  await expect(m).toBeVisible({ timeout: 45_000 });
  await expect(m).toHaveAttribute('data-item-id', id);
  await expect(tid(page, 'match-headline')).toHaveText(headline);
  await expect(tid(page, 'match-title')).not.toHaveText('');
  await expect(tid(page, 'match-what')).not.toHaveText('');
  await expect(tid(page, 'match-service')).not.toHaveText('');
  await expect(tid(page, 'match-ad-badge')).toHaveText(/ad-free|ads/i);
}

test('two phones: Together session, both say yes, a match on both, keep swiping, a second match, both in Matches (not History)', async ({ group }) => {
  const g = await group(['Alex', 'Sam']);
  const [A, B] = g.pages;
  const both = [g.ids.Alex, g.ids.Sam].sort();
  await openTab(A, 'tonight');
  await fillAsk(A, { who: both, viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
  await expect(tid(A, 'ask-submit')).toHaveText(/Start together/);
  await tid(A, 'ask-submit').click();
  await expect(tid(A, 'session-deck')).toBeVisible();
  await expect(tid(A, 'session-status')).toHaveAttribute('data-all-joined', 'false');

  await expect(tid(B, 'join-prompt')).toBeVisible({ timeout: 45_000 });
  await expect(tid(B, 'join-text')).toContainText('Alex started a session with you');
  await tid(B, 'join-button').click();
  await expect(tid(B, 'session-deck')).toBeVisible();
  await expect(tid(A, 'session-status')).toHaveAttribute('data-all-joined', 'true', { timeout: 45_000 });

  const dA = await deckIds(A);
  expect(dA.length).toBeGreaterThan(4);
  expect(await deckIds(B)).toEqual(dA);
  const [first, second] = dA;
  await expect(tid(A, 'card')).toHaveAttribute('data-item-id', first);
  await expect(tid(B, 'card')).toHaveAttribute('data-item-id', first);

  await act(A, 'yes');
  await expect(tid(A, 'match-screen')).toHaveCount(0); // one yes is not a match
  await swipeCard(B, 'right');
  await expectMatchScreen(A, first, 'It’s a match!');
  await expectMatchScreen(B, first, 'It’s a match!');
  expect(await tid(A, 'match-service').textContent()).toBe(await tid(B, 'match-service').textContent());
  await tid(A, 'match-keep').click();
  await tid(B, 'match-keep').click();
  await expect(tid(A, 'card')).toHaveAttribute('data-item-id', second);
  await expect(tid(B, 'card')).toHaveAttribute('data-item-id', second);

  await act(B, 'yes');
  await swipeCard(A, 'right');
  await expectMatchScreen(A, second, 'It’s a match!');
  await expectMatchScreen(B, second, 'It’s a match!');
  await tid(A, 'match-keep').click();
  await tid(B, 'match-keep').click();

  for (const page of [A, B]) {
    await openTab(page, 'matches');
    for (const id of [first, second]) {
      const row = page.locator(`[data-testid="match-row"][data-item-id="${id}"]`);
      await expect(row).toHaveCount(1, { timeout: 45_000 });
      await expect(row).toHaveAttribute('data-kind', 'match');
      await expect(row.getByTestId('match-label')).toHaveText('Match — Alex & Sam');
    }
    await expect(tid(page, 'match-row')).toHaveCount(2);
    await openTab(page, 'history');
    await expect(tid(page, 'history-row')).toHaveCount(0);
  }
  // "We watched this" on one phone marks both
  await openTab(A, 'matches');
  await A.locator(`[data-testid="match-row"][data-item-id="${first}"]`).click();
  await expect(tid(A, 'match-watched')).toHaveText('We watched this');
  await tid(A, 'match-watched').click();
  await expect(B.locator(`[data-testid="match-row"][data-item-id="${first}"]`)).toHaveCount(0, { timeout: 45_000 });
  const sB = await sharedState(B);
  expect(Object.keys(sB.seen[g.ids.Alex])).toContain(first);
  expect(Object.keys(sB.seen[g.ids.Sam])).toContain(first);
});

test('three phones: a session for all three matches only after the third yes, on all three phones, exactly once; a second match follows', async ({ group }) => {
  const g = await group(['Alex', 'Sam', 'Kit']);
  const [A, B, C] = g.pages;
  const all = [g.ids.Alex, g.ids.Sam, g.ids.Kit].sort();
  await openTab(A, 'tonight');
  await expect(tid(A, 'who-everyone')).toBeVisible();
  await tid(A, 'who-everyone').click();
  await fillAsk(A, { mood: 'laugh', time: 120 });
  await tid(A, 'ask-submit').click();
  await expect(tid(A, 'session-deck')).toBeVisible();
  for (const P of [B, C]) {
    await expect(tid(P, 'join-prompt')).toBeVisible({ timeout: 45_000 });
    await tid(P, 'join-button').click();
    await expect(tid(P, 'session-deck')).toBeVisible();
  }
  await expect(tid(A, 'session-status')).toHaveAttribute('data-all-joined', 'true', { timeout: 45_000 });
  const d = await deckIds(A);
  const [first, second] = d;
  for (const P of [A, B, C]) await expect(tid(P, 'card')).toHaveAttribute('data-item-id', first);

  await act(A, 'yes');
  await act(B, 'yes');
  await A.waitForTimeout(3000);
  for (const P of [A, B, C]) await expect(tid(P, 'match-screen')).toHaveCount(0); // two of three
  expect((await sharedState(A)).picks).toHaveLength(0);
  await act(C, 'yes');
  for (const P of [A, B, C]) await expectMatchScreen(P, first, 'Everyone’s in!');
  // exactly once, with all three in the pick
  await expect.poll(async () => (await sharedState(A)).picks.length, { timeout: 45_000 }).toBe(1);
  const s = await sharedState(A);
  expect(s.picks[0].who).toEqual(all);
  expect(s.activeSession.matches).toHaveLength(1);
  for (const P of [A, B, C]) await tid(P, 'match-keep').click();
  for (const P of [A, B, C]) await expect(tid(P, 'card')).toHaveAttribute('data-item-id', second);

  // keep swiping: a second match, where one person says no first and then a different order
  await act(C, 'yes');
  await act(B, 'not-tonight');
  await act(A, 'yes');
  await A.waitForTimeout(3000);
  for (const P of [A, B, C]) await expect(tid(P, 'match-screen')).toHaveCount(0);
  expect((await sharedState(A)).picks).toHaveLength(1);
  const third = (await deckIds(A))[2];
  for (const P of [A, B, C]) await expect(tid(P, 'card')).toHaveAttribute('data-item-id', third);
  await act(B, 'yes');
  await act(C, 'yes');
  await act(A, 'yes');
  for (const P of [A, B, C]) await expectMatchScreen(P, third, 'Everyone’s in!');
  await expect.poll(async () => (await sharedState(B)).picks.length, { timeout: 45_000 }).toBe(2);
});

test('three phones, a pair session: the third is not prompted, sees the quiet line, and ending the session tells the pair', async ({ group }) => {
  const g = await group(['Alex', 'Sam', 'Kit']);
  const [A, B, C] = g.pages;
  await openTab(A, 'tonight');
  await fillAsk(A, { who: [g.ids.Alex, g.ids.Sam].sort(), mood: 'laugh', time: 120 });
  await tid(A, 'ask-submit').click();
  await expect(tid(B, 'join-prompt')).toBeVisible({ timeout: 45_000 });
  await openTab(C, 'tonight');
  await expect(tid(C, 'session-others')).toHaveText('Alex and Sam are picking together', { timeout: 45_000 });
  await expect(tid(C, 'join-prompt')).toHaveCount(0);
  await tid(B, 'join-button').click();
  await tid(A, 'session-end-top').click();
  await tid(A, 'end-confirm').click();
  await expect(tid(A, 'ask')).toBeVisible();
  await expect(tid(B, 'ask')).toBeVisible({ timeout: 45_000 });
  await expect(tid(B, 'toast')).toContainText('ended');
  await expect(tid(C, 'session-others')).toHaveCount(0, { timeout: 45_000 });
});

test('reload mid-session resumes the same session on the same card', async ({ group }) => {
  const g = await group(['Alex', 'Sam']);
  const [A, B] = g.pages;
  await openTab(A, 'tonight');
  await fillAsk(A, { who: [g.ids.Alex, g.ids.Sam].sort(), mood: 'laugh', time: 120 });
  await tid(A, 'ask-submit').click();
  await expect(tid(B, 'join-prompt')).toBeVisible({ timeout: 45_000 });
  await tid(B, 'join-button').click();
  const deck = await deckIds(B);
  await act(B, 'not-tonight');
  await expect(tid(B, 'card')).toHaveAttribute('data-item-id', deck[1]);
  const sessionId = await tid(B, 'session-deck').getAttribute('data-session-id');
  await B.reload();
  await expect(tid(B, 'session-deck')).toBeVisible({ timeout: 60_000 });
  await expect(tid(B, 'session-deck')).toHaveAttribute('data-session-id', sessionId!);
  await expect(tid(B, 'card')).toHaveAttribute('data-item-id', deck[1]);
});
