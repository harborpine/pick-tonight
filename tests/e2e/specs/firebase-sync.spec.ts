import { expect, test } from '../helpers/fixtures';
import { REQ, act, engineDeck, fillAsk, findCard, neverCard, openTab, saveCard, sharedState, tid } from '../helpers/app';

test.describe.configure({ retries: 1, timeout: 180_000 });

test('two phones: Never by HG hides it for HG and Together but not BG alone; after BG also taps Never it is gone everywhere', async ({ pair: { A, B } }) => {
  // HG starts a Together session and taps Never on the first card.
  await fillAsk(A, { who: 'Together', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
  await tid(A, 'ask-submit').click();
  await expect(tid(A, 'session-deck')).toBeVisible();
  const x = (await tid(A, 'card').getAttribute('data-item-id'))!;
  await neverCard(A);
  await expect.poll(async () => Object.keys((await sharedState(A)).never.HG)).toContain(x);
  await tid(A, 'session-end-top').click();
  await tid(A, 'end-confirm').click();
  await expect(tid(A, 'ask')).toBeVisible();

  // Gone for HG alone and for Together...
  expect((await engineDeck(A, { ...REQ, who: 'HG' })).map((c) => c.id)).not.toContain(x);
  expect((await engineDeck(A, { ...REQ, who: 'Together' })).map((c) => c.id)).not.toContain(x);
  // ...the same on BG's phone once it has synced...
  await expect.poll(async () => Object.keys((await sharedState(B)).never.HG)).toContain(x);
  expect((await engineDeck(B, { ...REQ, who: 'Together' })).map((c) => c.id)).not.toContain(x);
  // ...but BG alone can still be offered it, and sees it in the real deck.
  expect((await engineDeck(B, { ...REQ, who: 'BG' })).map((c) => c.id)).toContain(x);
  await fillAsk(B, { who: 'BG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
  await tid(B, 'ask-submit').click();
  const found = await findCard(B, (c) => c.id === x);
  expect(found, 'BG alone is still offered the title HG tapped Never on').not.toBeNull();

  // BG taps Never as well -> gone everywhere, for good.
  await neverCard(B);
  await expect.poll(async () => Object.keys((await sharedState(A)).never.BG)).toContain(x);
  for (const phone of [A, B]) {
    for (const who of ['HG', 'BG', 'Together'] as const) {
      for (const date of [undefined, '2099-01-01']) {
        const ids = (await engineDeck(phone, { ...REQ, who }, date)).map((c) => c.id);
        expect(ids, `${x} still offered to ${who}`).not.toContain(x);
      }
    }
  }
});

test('two phones: saving to Ours and marking Seen on one phone shows up on the other without a reload', async ({ pair: { A, B } }) => {
  // HG: solo deck, save the first card to Ours, mark the second as seen.
  await fillAsk(A, { who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
  await tid(A, 'ask-submit').click();
  await expect(tid(A, 'card')).toBeVisible();
  const ours = (await tid(A, 'card').getAttribute('data-item-id'))!;
  await saveCard(A, 'ours');
  const seen = (await tid(A, 'card').getAttribute('data-item-id'))!;
  await act(A, 'seen');
  const mine = (await tid(A, 'card').getAttribute('data-item-id'))!;
  await saveCard(A, 'HG');

  // BG's phone, never reloaded: Watchlist > Ours has it; Mine/Hers shows HG's own list under the "HG" tab.
  await openTab(B, 'watchlist');
  await tid(B, 'watchlist-tab-ours').click();
  await expect(B.locator(`[data-testid="watchlist-row"][data-item-id="${ours}"]`)).toHaveCount(1, { timeout: 45_000 });
  await tid(B, 'watchlist-tab-hers').click(); // HG's list, from BG's side
  await expect(B.locator(`[data-testid="watchlist-row"][data-item-id="${mine}"]`)).toHaveCount(1, { timeout: 45_000 });
  await tid(B, 'watchlist-tab-mine').click();
  await expect(B.locator(`[data-testid="watchlist-row"][data-item-id="${ours}"]`)).toHaveCount(0);
  // Seen: reflected on BG's phone under HG's profile
  await expect.poll(async () => Object.keys((await sharedState(B)).seen.HG)).toContain(seen);
  await openTab(B, 'us');
  await tid(B, 'us-seg-HG').click();
  await tid(B, 'seen-show-all').click().catch(() => {});
  await expect(B.locator(`[data-testid="seen-row"][data-item-id="${seen}"]`)).toHaveCount(1);

  // The other way: BG saves to Ours, HG's phone sees it live.
  await openTab(A, 'watchlist');
  await tid(A, 'watchlist-tab-ours').click();
  await openTab(B, 'tonight');
  await fillAsk(B, { who: 'BG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either' });
  await tid(B, 'ask-submit').click();
  await expect(tid(B, 'card')).toBeVisible();
  const fromBG = (await tid(B, 'card').getAttribute('data-item-id'))!;
  await saveCard(B, 'ours');
  await expect(A.locator(`[data-testid="watchlist-row"][data-item-id="${fromBG}"]`)).toHaveCount(1, { timeout: 45_000 });
  // Removing it on HG's phone removes it on BG's
  await A.locator(`[data-testid="watchlist-row"][data-item-id="${fromBG}"]`).click();
  await tid(A, 'watchlist-remove').click();
  await expect.poll(async () => (await sharedState(B)).watchlist.some((w: { itemId: string; list: string }) => w.itemId === fromBG && w.list === 'ours')).toBe(false);
});

test('two phones: plan changes and profile corrections sync; the pairing code was a real 6-character code', async ({ pair: { A, B } }) => {
  await openTab(A, 'us');
  await tid(A, 'us-seg-settings').click();
  await tid(A, 'plan-peacock-premium-plus').click();
  await expect.poll(async () => (await sharedState(B)).settings.plans.peacock).toBe('premium-plus');
  await openTab(B, 'us');
  await tid(B, 'us-seg-settings').click();
  await expect(tid(B, 'plan-peacock-premium-plus')).toHaveAttribute('data-selected', 'true');

  // a fresh pairing code is 6 characters from the unambiguous alphabet
  await tid(A, 'show-pairing-code').click();
  await expect(tid(A, 'pairing-code')).toHaveText(/^\s*[A-Z2-9 ]{6,12}\s*$/, { timeout: 30_000 });
  const code = ((await tid(A, 'pairing-code').textContent()) ?? '').replace(/\s+/g, '');
  expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{6}$/);

  // BG's dealbreakers are the same on both phones
  await tid(B, 'us-seg-BG').click();
  await expect(tid(B, 'dealbreaker-scary')).toHaveAttribute('data-on', 'true');
  await tid(B, 'dealbreaker-scary').click();
  await expect.poll(async () => (await sharedState(A)).profiles.BG.dealbreakers.scary).toBe(false);
});
