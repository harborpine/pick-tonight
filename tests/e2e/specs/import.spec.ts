import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_NETFLIX_CSV } from '../../../src/contracts/fixtures/catalog';
import { openTab, sharedState, startMemoryPhone, tid } from '../helpers/app';

const historyRow = (page: Page, id: string) => page.locator(`[data-testid="history-row"][data-item-id="${id}"]`);

function tempFile(name: string, content: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'wtw-import-'));
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

async function goProfile(page: Page, who: 'HG' | 'BG') {
  await openTab(page, 'us');
  await tid(page, `us-seg-${who}`).click();
  await expect(tid(page, `profile-${who}`)).toBeVisible();
}

async function insightTexts(page: Page): Promise<string[]> {
  return tid(page, 'insight-text').allTextContents();
}

test('import: the Netflix file shows the right summary BEFORE saving, then adds to History with source and plays', async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'HG');
  await expect(tid(page, 'import-section')).toHaveAttribute('data-person', 'HG');
  await expect(tid(page, 'import-instructions')).toBeVisible();
  const insightsBefore = await insightTexts(page);

  await tid(page, 'import-file').setInputFiles(tempFile('NetflixViewingHistory.csv', FIXTURE_NETFLIX_CSV));
  const summary = tid(page, 'import-summary');
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary).toHaveAttribute('data-matched', '7');
  await expect(summary).toHaveAttribute('data-unmatched', '2');
  // "found" counts every name in the file: 7 matched + 2 unmatched = 9 titles, 15 rows
  await expect(tid(page, 'import-found')).toContainText('9 titles');
  await expect(tid(page, 'import-found')).toContainText('15 plays');
  await expect(tid(page, 'import-matched-count')).toHaveText('7');
  await expect(tid(page, 'import-new-count')).toHaveText('7');
  await expect(tid(page, 'import-already-count')).toHaveText('0');
  // The Office resolved to the US show
  await expect(page.locator('[data-testid="import-top-row"][data-item-id="tv-2316"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="import-top-row"][data-item-id="tv-2996"]')).toHaveCount(0);
  // the two unmatched names are listed
  await tid(page, 'import-unmatched-toggle').click();
  const un = (await tid(page, 'import-unmatched-row').allTextContents()).join(' | ');
  expect(un).toContain('Zzyzx');
  expect(un).toContain('Completely Unknown Home Movie');
  await expect(tid(page, 'import-unmatched-row')).toHaveCount(2);
  // nothing is saved yet
  expect(Object.keys((await sharedState(page)).seen.HG).filter((k) => (k as string).startsWith('tv-1396'))).toEqual([]);
  await openTab(page, 'history');
  await expect(tid(page, 'history-empty')).toBeVisible();
  await goProfile(page, 'HG');
  // (the summary is still there after a tab trip, or the import restarts; both are fine, so redo if needed)
  if ((await tid(page, 'import-summary').count()) === 0) {
    await tid(page, 'import-file').setInputFiles(tempFile('NetflixViewingHistory.csv', FIXTURE_NETFLIX_CSV));
    await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  }

  await tid(page, 'import-confirm').click();
  await expect(tid(page, 'import-result')).toContainText('Added 7 titles', { timeout: 30_000 });

  await openTab(page, 'history');
  await expect(tid(page, 'history-row')).toHaveCount(7);
  const office = historyRow(page, 'tv-2316');
  await expect(office).toHaveCount(1);
  await expect(office).toHaveAttribute('data-source', 'import');
  await expect(office.getByTestId('history-title')).toHaveText('The Office');
  await expect(office.getByTestId('history-source')).toContainText(/Imported/);
  await expect(office.getByTestId('history-source')).toContainText('4 plays');
  // off-service titles are in as well
  for (const [id, title] of [['tv-1396', 'Breaking Bad'], ['tv-97546', 'Ted Lasso'], ['movie-496243', 'Parasite']] as const) {
    await expect(historyRow(page, id).getByTestId('history-title')).toHaveText(title);
  }
  await expect(historyRow(page, 'tv-1396').getByTestId('history-source')).toContainText('3 plays');
  const titles = await tid(page, 'history-title').allTextContents();
  expect(titles).toEqual(expect.arrayContaining(['Stranger Things', 'Black Mirror', 'Paddington 2']));
  const st = await sharedState(page);
  expect(st.seen.HG['tv-2316']).toMatchObject({ source: 'import', plays: 4 });
  expect(Object.keys(st.seen.BG)).not.toContain('tv-2316'); // only HG's list
  // 13 plays across the 7 matched titles (the 2 unmatched rows are not saved)
  const totalPlays = Object.values(st.seen.HG).reduce((n: number, e: any) => n + (e.source === 'import' ? e.plays ?? 0 : 0), 0);
  expect(totalPlays).toBe(13);

  // the taste page reflects the import
  await goProfile(page, 'HG');
  await expect.poll(async () => JSON.stringify(await insightTexts(page))).not.toBe(JSON.stringify(insightsBefore));
});

test('import: the same file again says "already there" and does not duplicate', async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'HG');
  const file = tempFile('again.csv', FIXTURE_NETFLIX_CSV);
  await tid(page, 'import-file').setInputFiles(file);
  await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-confirm').click();
  await expect(tid(page, 'import-result')).toBeVisible({ timeout: 30_000 });
  await tid(page, 'import-again').click();

  await tid(page, 'import-file').setInputFiles(file);
  await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  await expect(tid(page, 'import-matched-count')).toHaveText('7');
  await expect(tid(page, 'import-already-count')).toHaveText('7');
  await expect(tid(page, 'import-new-count')).toHaveText('0');
  // confirming (if it is even offered) must not duplicate or inflate plays
  if (await tid(page, 'import-confirm').isEnabled().catch(() => false)) {
    await tid(page, 'import-confirm').click();
    await expect(tid(page, 'import-result')).toBeVisible({ timeout: 30_000 });
  } else {
    await tid(page, 'import-cancel').click();
  }
  await openTab(page, 'history');
  await expect(tid(page, 'history-row')).toHaveCount(7);
  const st = await sharedState(page);
  expect(Object.keys(st.seen.HG).length).toBeGreaterThanOrEqual(7);
  expect(st.seen.HG['tv-2316'].plays).toBe(4);
});

test('import: cancel saves nothing; an unreadable file gives a friendly message; an empty paste too', async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'HG');
  await tid(page, 'import-file').setInputFiles(tempFile('x.csv', FIXTURE_NETFLIX_CSV));
  await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-cancel').click();
  await expect(tid(page, 'import-summary')).toHaveCount(0);
  await openTab(page, 'history');
  await expect(tid(page, 'history-empty')).toBeVisible();

  await goProfile(page, 'HG');
  // random bytes
  const bytes = Buffer.alloc(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 197 + 13) % 256;
  await tid(page, 'import-file').setInputFiles(tempFile('photo.jpg', bytes));
  const problem = tid(page, 'import-problem');
  await expect(problem).toBeVisible({ timeout: 20_000 });
  const text = (await problem.textContent()) ?? '';
  expect(text.length).toBeGreaterThan(20);
  expect(text).not.toMatch(/undefined|NaN|\[object|Error:|Exception|TypeError/);
  await expect(tid(page, 'import-summary')).toHaveCount(0);
  await tid(page, 'import-retry').click();
  await expect(tid(page, 'import-problem')).toHaveCount(0);

  // an empty file
  await tid(page, 'import-file').setInputFiles(tempFile('empty.csv', ''));
  await expect(tid(page, 'import-problem')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-retry').click();
  await openTab(page, 'history');
  await expect(tid(page, 'history-empty')).toBeVisible();
});

test('import: the paste-a-list path works (one title per line)', async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'HG');
  await tid(page, 'import-paste').fill('Breaking Bad\nTed Lasso\nParasite\nNot A Real Title At All Xyzzy');
  await tid(page, 'import-paste-go').click();
  const summary = tid(page, 'import-summary');
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary).toHaveAttribute('data-matched', '3');
  await expect(summary).toHaveAttribute('data-unmatched', '1');
  await tid(page, 'import-confirm').click();
  await expect(tid(page, 'import-result')).toContainText('Added 3 titles', { timeout: 30_000 });
  await openTab(page, 'history');
  await expect(tid(page, 'history-row')).toHaveCount(3);
  await expect(historyRow(page, 'tv-1396')).toHaveCount(1);
});

test('import: for the partner it asks first, then adds to the partner\'s History only', async ({ page }) => {
  await startMemoryPhone(page);
  await goProfile(page, 'BG');
  await expect(tid(page, 'import-section')).toHaveAttribute('data-person', 'BG');
  await tid(page, 'import-file').setInputFiles(tempFile('bg.csv', FIXTURE_NETFLIX_CSV));
  await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-confirm').click();
  await expect(tid(page, 'import-partner-sheet')).toBeVisible();
  expect(Object.keys((await sharedState(page)).seen.BG)).not.toContain('tv-1396'); // nothing saved before the confirmation
  await tid(page, 'import-partner-confirm').click();
  await expect(tid(page, 'import-result')).toBeVisible({ timeout: 30_000 });
  const st = await sharedState(page);
  expect(Object.keys(st.seen.BG)).toContain('tv-1396');
  expect(Object.keys(st.seen.HG)).not.toContain('tv-1396');
});
