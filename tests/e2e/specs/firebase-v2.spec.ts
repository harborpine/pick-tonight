import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_NETFLIX_CSV } from '../../../src/contracts/fixtures/catalog';
import { REQ, act, askSolo, engineDeck, fillAsk, openTab, readCard, sharedState, swipeCard, tid } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

test.describe.configure({ retries: 1, timeout: 180_000 });

const matchRow = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-testid="match-row"][data-item-id="${id}"]`);
const historyRow = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-testid="history-row"][data-item-id="${id}"]`);

test('two phones: a Together match lands in Matches on both; "We watched this" on one phone puts it in both people\'s History on both phones', async ({ pair: { A, B } }) => {
  await fillAsk(A, { who: 'Together', viewing: 'focused', mood: 'laugh', time: 'any', novelty: 'either' });
  await tid(A, 'ask-submit').click();
  await expect(tid(B, 'join-prompt')).toBeVisible({ timeout: 45_000 });
  await tid(B, 'join-button').click();
  await expect(tid(B, 'session-deck')).toBeVisible();
  await expect(tid(A, 'session-status')).toHaveAttribute('data-partner-joined', 'true', { timeout: 45_000 });
  const first = (await tid(A, 'card').getAttribute('data-item-id'))!;
  await act(A, 'yes');
  await swipeCard(B, 'right');
  await expect(tid(A, 'match-screen')).toBeVisible({ timeout: 45_000 });
  await expect(tid(B, 'match-screen')).toBeVisible({ timeout: 45_000 });
  await tid(A, 'match-watching').click(); // ends the session for both
  await expect(tid(A, 'ask')).toBeVisible();
  await expect(tid(B, 'match-screen')).toHaveCount(0, { timeout: 45_000 }); // ending the session closes it on BG's phone too

  for (const page of [A, B]) {
    await openTab(page, 'matches');
    await expect(matchRow(page, first)).toHaveCount(1, { timeout: 45_000 });
    await expect(matchRow(page, first)).toHaveAttribute('data-kind', 'match');
    await tid(page, 'matches-filter-together').click();
    await expect(matchRow(page, first)).toHaveCount(1);
    await openTab(page, 'history');
    await expect(historyRow(page, first)).toHaveCount(0);
  }

  // The match no longer shows in decks for either person or Together, on either phone
  for (const page of [A, B]) {
    for (const who of ['HG', 'BG', 'Together'] as const) {
      expect((await engineDeck(page, { ...REQ, who, novelty: 'either', time: 'any' }, '2099-01-01')).map((c) => c.id)).not.toContain(first);
    }
  }

  // BG's phone: "We watched this"
  await openTab(B, 'matches');
  await tid(B, 'matches-filter-all').click();
  await matchRow(B, first).click();
  await expect(tid(B, 'match-watched')).toContainText('We watched this');
  await tid(B, 'match-watched').click();
  await expect(matchRow(B, first)).toHaveCount(0);

  // ...both phones: gone from Matches, in both people's History
  await expect.poll(async () => (await sharedState(A)).picks.some((p: { itemId: string }) => p.itemId === first), { timeout: 45_000 }).toBe(false);
  await expect.poll(async () => Object.keys((await sharedState(A)).seen.BG)).toContain(first);
  await expect.poll(async () => Object.keys((await sharedState(A)).seen.HG)).toContain(first);
  for (const page of [A, B]) {
    await openTab(page, 'history');
    await expect(historyRow(page, first)).toHaveCount(1, { timeout: 30_000 });
    await tid(page, 'history-person-partner').click();
    await expect(historyRow(page, first)).toHaveCount(1, { timeout: 30_000 });
    await openTab(page, 'matches');
    await expect(matchRow(page, first)).toHaveCount(0);
  }
});

test('two phones: a solo right-swipe by HG shows up in Matches on BG\'s phone (HG filter); removing it on BG\'s phone removes it for HG', async ({ pair: { A, B } }) => {
  await askSolo(A, { who: 'HG', mood: 'laugh', time: 120, novelty: 'new' });
  const c = await readCard(A);
  await swipeCard(A, 'right');
  await expect(tid(A, 'solo-deck')).toBeVisible();
  await expect(tid(A, 'liked-count')).toHaveText('1');

  await openTab(B, 'matches');
  await tid(B, 'matches-filter-HG').click();
  await expect(matchRow(B, c.id)).toHaveCount(1, { timeout: 45_000 });
  await expect(matchRow(B, c.id).getByTestId('match-label')).toContainText('HG');
  // BG alone is still offered it (not hers), HG is not
  expect((await engineDeck(B, { ...REQ, who: 'HG', novelty: 'new', time: 120 }, '2099-01-01')).map((x) => x.id)).not.toContain(c.id);

  await matchRow(B, c.id).click();
  await tid(B, 'match-remove').click();
  await expect.poll(async () => (await sharedState(A)).picks.length, { timeout: 45_000 }).toBe(0);
  expect((await engineDeck(A, { ...REQ, who: 'HG', novelty: 'new', time: 120 }, '2099-01-01')).map((x) => x.id)).toContain(c.id);
});

test('two phones: an import on one phone shows up in the other phone\'s view of that person\'s History', async ({ pair: { A, B } }) => {
  const dir = mkdtempSync(join(tmpdir(), 'wtw-fb-import-'));
  const file = join(dir, 'NetflixViewingHistory.csv');
  writeFileSync(file, FIXTURE_NETFLIX_CSV);

  await openTab(A, 'us');
  await tid(A, 'us-seg-HG').click();
  await tid(A, 'import-file').setInputFiles(file);
  await expect(tid(A, 'import-summary')).toBeVisible({ timeout: 30_000 });
  await expect(tid(A, 'import-matched-count')).toHaveText('7');
  await tid(A, 'import-confirm').click();
  await expect(tid(A, 'import-result')).toBeVisible({ timeout: 60_000 });

  await openTab(B, 'history');
  await tid(B, 'history-person-partner').click(); // HG, from BG's side
  const office = historyRow(B, 'tv-2316');
  await expect(office).toHaveCount(1, { timeout: 60_000 });
  await expect(office).toHaveAttribute('data-source', 'import');
  await expect(office.getByTestId('history-source')).toContainText('4 plays');
  await expect(historyRow(B, 'tv-1396')).toHaveCount(1); // Breaking Bad, off our services
  await expect(tid(B, 'history-row')).toHaveCount(7);
  // BG's own list is untouched
  await tid(B, 'history-person-me').click();
  await expect(historyRow(B, 'tv-2316')).toHaveCount(0);
});
