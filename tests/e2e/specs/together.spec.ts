import type { Page } from '@playwright/test';
import { act, fillAsk, openTab, sharedState, swipeCard, tid } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

// Real Firebase, two phones. One retry is allowed for network flake only.
test.describe.configure({ retries: 1, timeout: 180_000 });

async function sessionDeckIds(page: Page): Promise<string[]> {
  const s = await sharedState(page);
  return (s.activeSession?.deck ?? []).map((c: { itemId: string }) => c.itemId);
}

/** Both phones are showing a match screen for `id`: check what it tells you. */
async function expectMatchScreen(page: Page, id: string) {
  const m = tid(page, 'match-screen');
  await expect(m).toBeVisible({ timeout: 45_000 });
  await expect(m).toHaveAttribute('data-item-id', id);
  await expect(tid(page, 'match-headline')).toBeVisible();
  await expect(tid(page, 'match-title')).not.toHaveText('');
  await expect(tid(page, 'match-what')).not.toHaveText('');
  await expect(tid(page, 'match-service')).toHaveText(/Netflix|Disney\+|Hulu|HBO Max|Peacock|Paramount\+/);
  await expect(tid(page, 'match-ad-badge')).toHaveText(/ad-free|ads/i);
}

test('two phones: Together session, both say yes, match on both, keep swiping, second match, both in History', async ({ pair: { A, B } }) => {
  {
    // --- HG starts a Together session --------------------------------------------------
    await fillAsk(A, { who: 'Together', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
    await expect(tid(A, 'ask-submit')).toHaveText(/Start together/);
    await tid(A, 'ask-submit').click();
    await expect(tid(A, 'session-deck')).toBeVisible();
    await expect(tid(A, 'session-status')).toHaveAttribute('data-partner-joined', 'false');

    // --- BG's phone shows the join prompt while the app is open ------------------------
    const prompt = tid(B, 'join-prompt');
    await expect(prompt).toBeVisible({ timeout: 45_000 });
    await expect(tid(B, 'join-text')).toContainText('HG started a session');
    await tid(B, 'join-button').click();
    await expect(tid(B, 'session-deck')).toBeVisible();
    await expect(tid(A, 'session-status')).toHaveAttribute('data-partner-joined', 'true', { timeout: 45_000 });
    await expect(tid(B, 'session-status')).toHaveAttribute('data-partner-joined', 'true');

    // --- same deck, same order ---------------------------------------------------------
    const deckA = await sessionDeckIds(A);
    const deckB = await sessionDeckIds(B);
    expect(deckA.length).toBeGreaterThan(4);
    expect(deckB).toEqual(deckA);
    const first = deckA[0];
    const second = deckA[1];
    await expect(tid(A, 'card')).toHaveAttribute('data-item-id', first);
    await expect(tid(B, 'card')).toHaveAttribute('data-item-id', first);

    // --- both say yes to the first title: HG with the Yes button, BG with a real swipe ---
    await act(A, 'yes');
    await expect(tid(A, 'match-screen')).toHaveCount(0); // one yes alone is not a match
    await swipeCard(B, 'right');
    await expectMatchScreen(A, first);
    await expectMatchScreen(B, first);
    // both phones show the same service and Ad-free/Ads
    expect(await tid(A, 'match-service').textContent()).toBe(await tid(B, 'match-service').textContent());
    expect(await tid(A, 'match-ad-badge').textContent()).toBe(await tid(B, 'match-ad-badge').textContent());

    // --- keep swiping: both continue on the next card of the same deck -----------------
    await tid(A, 'match-keep').click();
    await tid(B, 'match-keep').click();
    await expect(tid(A, 'match-screen')).toHaveCount(0);
    await expect(tid(B, 'match-screen')).toHaveCount(0);
    await expect(tid(A, 'card')).toHaveAttribute('data-item-id', second);
    await expect(tid(B, 'card')).toHaveAttribute('data-item-id', second);

    // --- a second match, this time BG taps and HG swipes -------------------------------
    await act(B, 'yes');
    await swipeCard(A, 'right');
    await expectMatchScreen(A, second);
    await expectMatchScreen(B, second);
    await tid(A, 'match-keep').click();
    await tid(B, 'match-keep').click();

    // --- both History tabs list both matches as match entries --------------------------
    for (const page of [A, B]) {
      await openTab(page, 'history');
      await expect(tid(page, 'history')).toBeVisible();
      for (const id of [first, second]) {
        const row = page.locator(`[data-testid="history-row"][data-item-id="${id}"]`);
        await expect(row).toHaveCount(1, { timeout: 45_000 });
        await expect(row).toHaveAttribute('data-kind', 'match');
        await expect(row.getByTestId('history-who')).toHaveText('HG & BG');
        await expect(row.getByTestId('history-where')).not.toHaveText('');
        await expect(row.getByTestId('history-ad-badge')).toHaveText(/ad-free|ads/i);
      }
      await expect(page.getByTestId('history-row')).toHaveCount(2);
    }
  }
});

test('two phones: one person says no, the other yes -> no match; ending the session ends it for both', async ({ pair: { A, B } }) => {
  {
    await fillAsk(A, { who: 'Together', mood: 'laugh', time: 120 });
    await tid(A, 'ask-submit').click();
    await expect(tid(B, 'join-prompt')).toBeVisible({ timeout: 45_000 });
    await tid(B, 'join-button').click();
    await expect(tid(B, 'session-deck')).toBeVisible();

    const id = (await sessionDeckIds(A))[0];
    await act(A, 'yes');
    await act(B, 'not-tonight');
    // give the other phone a moment to (not) react
    await A.waitForTimeout(2500);
    await expect(tid(A, 'match-screen')).toHaveCount(0);
    await expect(tid(B, 'match-screen')).toHaveCount(0);
    const s = await sharedState(A);
    expect(s.history.filter((h: { itemId: string }) => h.itemId === id)).toHaveLength(0);

    // End from HG's phone: BG is told and returns to the questions.
    await tid(A, 'session-end-top').click();
    await tid(A, 'end-confirm').click();
    await expect(tid(A, 'ask')).toBeVisible();
    await expect(tid(B, 'ask')).toBeVisible({ timeout: 45_000 });
    await expect(tid(B, 'toast')).toContainText('ended');
  }
});

test('two phones: reload mid-Together-session resumes the same session', async ({ pair: { A, B } }) => {
  {
    await fillAsk(A, { who: 'Together', mood: 'laugh', time: 120 });
    await tid(A, 'ask-submit').click();
    await expect(tid(B, 'join-prompt')).toBeVisible({ timeout: 45_000 });
    await tid(B, 'join-button').click();
    await expect(tid(B, 'session-deck')).toBeVisible();

    const deck = await sessionDeckIds(B);
    await act(B, 'not-tonight');
    await expect(tid(B, 'card')).toHaveAttribute('data-item-id', deck[1]);
    const sessionId = await tid(B, 'session-deck').getAttribute('data-session-id');

    await B.reload();
    // still paired, back in the same session, on the next unanswered card
    await expect(tid(B, 'session-deck')).toBeVisible({ timeout: 45_000 });
    await expect(tid(B, 'session-deck')).toHaveAttribute('data-session-id', sessionId!);
    await expect(tid(B, 'card')).toHaveAttribute('data-item-id', deck[1]);

    // HG too
    await A.reload();
    await expect(tid(A, 'session-deck')).toBeVisible({ timeout: 45_000 });
    await expect(tid(A, 'card')).toHaveAttribute('data-item-id', deck[0]);
  }
});
