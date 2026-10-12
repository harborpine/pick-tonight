import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_NETFLIX_CSV } from '../../../src/contracts/fixtures/catalog';
import { createHousehold, openProfile, openTab, quickHousehold, sharedState, tid, type Household } from '../helpers/app';

const historyRow = (page: Page, id: string) => page.locator(`[data-testid="history-row"][data-item-id="${id}"]`);

function tempFile(name: string, content: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'pt-import-'));
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}
const insightTexts = (page: Page) => tid(page, 'insight-text').allTextContents();

async function start(page: Page): Promise<Household> {
  const h = await quickHousehold(page, [{ name: 'Alex' }, { name: 'Sam', like: 'sam' }]);
  await openProfile(page, h.first);
  return h;
}

test('import: the Netflix file shows the right summary BEFORE saving, then adds to History with source and plays', async ({ page }) => {
  const h = await start(page);
  await expect(tid(page, 'import-section')).toHaveAttribute('data-member-id', h.first);
  await expect(tid(page, 'import-instructions')).toBeVisible();
  const before = await insightTexts(page);
  await tid(page, 'import-file').setInputFiles(tempFile('NetflixViewingHistory.csv', FIXTURE_NETFLIX_CSV));
  const summary = tid(page, 'import-summary');
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary).toHaveAttribute('data-matched', '7');
  await expect(summary).toHaveAttribute('data-unmatched', '2');
  await expect(tid(page, 'import-found')).toContainText('9 titles');
  await expect(tid(page, 'import-found')).toContainText('15 plays');
  await expect(tid(page, 'import-matched-count')).toHaveText('7');
  await expect(tid(page, 'import-new-count')).toHaveText('7');
  await expect(tid(page, 'import-already-count')).toHaveText('0');
  await expect(page.locator('[data-testid="import-top-row"][data-item-id="tv-2316"]')).toHaveCount(1); // the US Office
  await expect(page.locator('[data-testid="import-top-row"][data-item-id="tv-2996"]')).toHaveCount(0);
  await tid(page, 'import-unmatched-toggle').click();
  const un = (await tid(page, 'import-unmatched-row').allTextContents()).join(' | ');
  expect(un).toContain('Zzyzx');
  expect(un).toContain('Completely Unknown Home Movie');
  await expect(tid(page, 'import-unmatched-row')).toHaveCount(2);
  // nothing saved yet
  expect(Object.keys((await sharedState(page)).seen[h.first])).toEqual([]);

  await tid(page, 'import-confirm').click();
  await expect(tid(page, 'import-result')).toContainText('Added 7 titles', { timeout: 30_000 });
  await openTab(page, 'history');
  await expect(tid(page, 'history-row')).toHaveCount(7);
  const office = historyRow(page, 'tv-2316');
  await expect(office).toHaveAttribute('data-source', 'import');
  await expect(office.getByTestId('history-title')).toHaveText('The Office');
  await expect(office.getByTestId('history-source')).toContainText('4 plays');
  // titles that are not on the household's services are in as well
  for (const [id, title] of [['tv-1396', 'Breaking Bad'], ['tv-97546', 'Ted Lasso'], ['movie-496243', 'Parasite']] as const) {
    await expect(historyRow(page, id).getByTestId('history-title')).toHaveText(title);
  }
  const st = await sharedState(page);
  expect(st.seen[h.first]['tv-2316']).toMatchObject({ source: 'import', plays: 4 });
  expect(Object.keys(st.seen[h.ids.Sam])).not.toContain('tv-2316');
  await openProfile(page, h.first);
  await expect.poll(async () => JSON.stringify(await insightTexts(page))).not.toBe(JSON.stringify(before));
});

test('import: the same file again says "already there" and does not duplicate', async ({ page }) => {
  const h = await start(page);
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
  if (await tid(page, 'import-confirm').isEnabled().catch(() => false)) {
    await tid(page, 'import-confirm').click();
    await expect(tid(page, 'import-result')).toBeVisible({ timeout: 30_000 });
  } else {
    await tid(page, 'import-cancel').click();
  }
  await openTab(page, 'history');
  await expect(tid(page, 'history-row')).toHaveCount(7);
  expect((await sharedState(page)).seen[h.first]['tv-2316'].plays).toBe(4);
});

test('import: cancel saves nothing; an unreadable file and an empty file give a friendly message', async ({ page }) => {
  await start(page);
  await tid(page, 'import-file').setInputFiles(tempFile('x.csv', FIXTURE_NETFLIX_CSV));
  await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-cancel').click();
  await expect(tid(page, 'import-summary')).toHaveCount(0);
  await openTab(page, 'history');
  await expect(tid(page, 'history-empty')).toBeVisible();

  await openTab(page, 'us');
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
  await tid(page, 'import-file').setInputFiles(tempFile('empty.csv', ''));
  await expect(tid(page, 'import-problem')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-retry').click();
  await openTab(page, 'history');
  await expect(tid(page, 'history-empty')).toBeVisible();
});

test('import: the paste-a-list path works (one title per line)', async ({ page }) => {
  await start(page);
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

test("import: for another member it asks first, then adds to that member's History only", async ({ page }) => {
  const h = await start(page);
  await openProfile(page, h.ids.Sam);
  await expect(tid(page, 'import-section')).toHaveAttribute('data-member-id', h.ids.Sam);
  await tid(page, 'import-file').setInputFiles(tempFile('sam.csv', FIXTURE_NETFLIX_CSV));
  await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-confirm').click();
  await expect(tid(page, 'import-partner-sheet')).toBeVisible();
  await expect(tid(page, 'import-partner-text')).toContainText('Sam');
  expect(Object.keys((await sharedState(page)).seen[h.ids.Sam])).not.toContain('tv-1396');
  await tid(page, 'import-partner-confirm').click();
  await expect(tid(page, 'import-result')).toBeVisible({ timeout: 30_000 });
  const st = await sharedState(page);
  expect(Object.keys(st.seen[h.ids.Sam])).toContain('tv-1396');
  expect(Object.keys(st.seen[h.first])).not.toContain('tv-1396');
});

test('import is also offered inside first-run setup, and works there', async ({ page }) => {
  await createHousehold(page, { name: 'Pat', stopAtFavourites: true });
  await tid(page, 'wizard-skip').click(); // favourites
  await tid(page, 'wizard-skip').click(); // never
  await expect(tid(page, 'wizard-import')).toBeVisible();
  await tid(page, 'import-file').setInputFiles(tempFile('wizard.csv', FIXTURE_NETFLIX_CSV));
  await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-confirm').click();
  await expect(tid(page, 'import-result')).toContainText('Added 7 titles', { timeout: 30_000 });
});
