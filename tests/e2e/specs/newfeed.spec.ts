import { devices, expect, test } from '@playwright/test';
import { OFF_PLAN, openTab, sharedState, startMemoryPhone, tid } from '../helpers/app';

const row = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-testid="new-row"][data-item-id="${id}"]`);

test('New feed: arrivals on our plans with a label, date, what to watch and where; off-plan arrivals are absent', async ({ page }) => {
  await startMemoryPhone(page);
  await openTab(page, 'new');
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(tid(page, 'new-row').first()).toBeVisible();
  const count = await tid(page, 'new-row').count();
  expect(count).toBeGreaterThanOrEqual(5);

  for (const id of OFF_PLAN) await expect(row(page, id), `${id} is off-plan`).toHaveCount(0);

  // A new season of Abbott Elementary
  const abbott = row(page, 'tv-125935');
  await expect(abbott).toHaveAttribute('data-type', 'season');
  await expect(abbott.getByTestId('new-title')).toHaveText("Abbott Elementary");
  await expect(abbott.getByTestId('new-label')).toHaveText('New season 4');
  await expect(abbott.getByTestId('new-date')).not.toHaveText('');
  await expect(abbott.getByTestId('new-pick')).not.toHaveText('');
  await expect(abbott.getByTestId('new-service-name')).not.toHaveText('');
  // A new movie on Netflix ad-free
  const onion = row(page, 'movie-661374');
  await expect(onion).toHaveAttribute('data-type', 'title');
  await expect(onion.getByTestId('new-label')).toHaveText('New');
  await expect(onion.getByTestId('new-service-name')).toHaveText('Netflix');
  await expect(onion.getByTestId('new-service-ad-badge')).toHaveAttribute('data-adfree', 'true');
  await expect(onion.getByTestId('new-pick')).toHaveText('Movie');
  // Every row shows all five actions
  for (const a of ['new-yes', 'new-not-tonight', 'new-seen', 'new-save', 'new-never']) await expect(onion.getByTestId(a)).toBeVisible();
});

test('New feed: horror (Get Out) is for HG only; BG and Together never see it', async ({ page, browser }) => {
  await startMemoryPhone(page);
  await openTab(page, 'new');
  await expect(row(page, 'movie-419430')).toHaveCount(1); // HG, me
  await tid(page, 'new-who-Together').click();
  await expect(tid(page, 'new-row').first()).toBeVisible();
  await expect(row(page, 'movie-419430')).toHaveCount(0);

  // BG's own phone
  const bgContext = await browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block', baseURL: 'http://localhost:4173' });
  const bg = await bgContext.newPage();
  await startMemoryPhone(bg, { person: 'BG' });
  await openTab(bg, 'new');
  await expect(tid(bg, 'new-row').first()).toBeVisible();
  await expect(row(bg, 'movie-419430')).toHaveCount(0);
});

test('New feed: Yes / Save / Seen / Not tonight / Never behave like the deck actions', async ({ page }) => {
  await startMemoryPhone(page);
  await openTab(page, 'new');
  const rowsBefore = await tid(page, 'new-row').count();

  // Yes -> pick screen -> History (solo)
  await row(page, 'movie-661374').getByTestId('new-yes').click();
  await expect(tid(page, 'pick-screen')).toHaveAttribute('data-item-id', 'movie-661374');
  await expect(tid(page, 'pick-service')).toHaveText('Netflix');
  await tid(page, 'pick-keep').click();
  await expect(row(page, 'movie-661374')).toHaveCount(0);

  // Save to Ours
  await row(page, 'movie-346648').getByTestId('new-save').click();
  await expect(tid(page, 'save-sheet')).toBeVisible();
  await tid(page, 'save-option-ours').click();
  await expect(row(page, 'movie-346648')).toHaveCount(0);

  // Seen
  await row(page, 'tv-136315').getByTestId('new-seen').click();
  await expect(row(page, 'tv-136315')).toHaveCount(0);

  // Not tonight
  await row(page, 'tv-205715').getByTestId('new-not-tonight').click();
  await expect(row(page, 'tv-205715')).toHaveCount(0);

  // Never (asks first)
  await row(page, 'movie-419430').getByTestId('new-never').click();
  await expect(tid(page, 'never-sheet')).toBeVisible();
  await tid(page, 'never-confirm').click();
  await expect(row(page, 'movie-419430')).toHaveCount(0);

  expect(await tid(page, 'new-row').count()).toBe(rowsBefore - 5);

  const st = await sharedState(page);
  expect(st.history.find((h: any) => h.itemId === 'movie-661374')?.kind).toBe('solo');
  expect(st.watchlist.find((w: any) => w.itemId === 'movie-346648')?.list).toBe('ours');
  expect(Object.keys(st.seen.HG)).toContain('tv-136315');
  expect(st.notTonight.HG['tv-205715']).toBeTruthy();
  expect(Object.keys(st.never.HG)).toContain('movie-419430');

  // and they stay gone after a reload (not tonight returns another day, so only check the lasting ones)
  await page.reload();
  await openTab(page, 'new');
  await expect(tid(page, 'new-row').first()).toBeVisible();
  await expect(row(page, 'movie-419430')).toHaveCount(0);
  await expect(row(page, 'tv-205715')).toHaveCount(0);
});
