import { expect, test, type Page } from '@playwright/test';
import { catalogRows, markWatched, openTab, sharedState, startMemoryPhone, tid, wtw } from '../helpers/app';

// The fixture's follow-up dates are fixed (Grey's S21 on 2026-10-01 ...), so pretend it is 11 Oct 2026.
const NOW = '2026-10-11T12:00:00';
const MS = (iso: string) => new Date(iso).getTime();

const fRow = (page: Page, id: string) => page.locator(`[data-testid="followup-row"][data-item-id="${id}"]`);
const nRow = (page: Page, id: string) => page.locator(`[data-testid="new-row"][data-item-id="${id}"]`);
const fIds = (page: Page) => tid(page, 'followup-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')));

test('follow-ups: HG sees "Because you watched..." at the top: House of the Dragon (spinoff) and Grey\'s Anatomy S21', async ({ page }) => {
  await startMemoryPhone(page, { now: NOW });
  await openTab(page, 'new');
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(tid(page, 'followups')).toBeVisible();
  await expect(tid(page, 'followups-title')).toContainText('Because you watched');
  // the section is above the ordinary list
  const fb = (await tid(page, 'followups').boundingBox())!;
  const nb = (await tid(page, 'new-section-title').boundingBox())!;
  expect(fb.y).toBeLessThan(nb.y);

  const hotd = fRow(page, 'tv-94997');
  await expect(hotd).toHaveCount(1);
  await expect(hotd).toHaveAttribute('data-type', 'spinoff');
  await expect(hotd.getByTestId('followup-title')).toHaveText('House of the Dragon');
  await expect(hotd.getByTestId('followup-text')).toContainText('Game of Thrones');
  await expect(hotd.getByTestId('followup-pick')).not.toHaveText('');
  await expect(hotd.getByTestId('followup-service-name')).toHaveText('HBO Max');
  await expect(hotd.getByTestId('followup-service-ad-badge')).toHaveAttribute('data-adfree', 'false');

  const grey = fRow(page, 'tv-1416');
  await expect(grey).toHaveCount(1);
  await expect(grey).toHaveAttribute('data-type', 'new-season');
  await expect(grey.getByTestId('followup-text')).toContainText('Season 21');
  await expect(grey.getByTestId('followup-date')).not.toHaveText('');

  // a title in follow-ups does not repeat in the general list below
  for (const id of await fIds(page)) await expect(nRow(page, id!)).toHaveCount(0);
  // Together: Grey's is a favourite of both; the spinoff needs GoT, which only HG loves, so it is HG-only
  await tid(page, 'new-who-Together').click();
  await expect(fRow(page, 'tv-1416')).toHaveCount(1);
  await tid(page, 'new-who-me').click();
  await expect(fRow(page, 'tv-94997')).toHaveCount(1);
});

test('follow-ups: BG sees her own (Grey\'s S21, The Traitors S3), never a spinoff of a show she has not watched, and nothing that breaks her dealbreakers', async ({ page }) => {
  await startMemoryPhone(page, { person: 'BG', now: NOW });
  await openTab(page, 'new');
  await expect(tid(page, 'followups')).toBeVisible();
  await expect(fRow(page, 'tv-1416')).toHaveCount(1);
  await expect(fRow(page, 'tv-205715')).toHaveCount(1);
  await expect(fRow(page, 'tv-94997')).toHaveCount(0);
  const rows = await catalogRows(page);
  const ids = (await fIds(page)) as string[];
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const f = rows[id].flags;
    expect(f.horror || f.trueCrime || f.scary, `${rows[id].title} breaks a dealbreaker`).toBe(false);
  }
  // the engine agrees for every audience BG is part of
  for (const who of ['BG', 'Together']) {
    const list: { itemId: string }[] = await wtw(page, (w, a) => w.engine.followUps(a.who, { catalog: w.catalog, state: w.sync.getState(), today: '2026-10-11' }), { who });
    for (const f of list) {
      const fl = rows[f.itemId].flags;
      expect(fl.horror || fl.trueCrime || fl.scary, `${rows[f.itemId].title} for ${who}`).toBe(false);
    }
  }
});

test('follow-ups: a new season after an older watch date appears; a watch dated after it does not', async ({ page }) => {
  await startMemoryPhone(page, { now: NOW });
  await openTab(page, 'new');
  // Abbott Elementary (S4 aired 7 Oct 2026) is not a favourite, so no follow-up yet
  await expect(fRow(page, 'tv-125935')).toHaveCount(0);
  await markWatched(page, 'HG', ['tv-125935'], 'manual', MS('2026-01-15T12:00:00'));
  await openTab(page, 'tonight');
  await openTab(page, 'new');
  const row = fRow(page, 'tv-125935');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-type', 'new-season');
  await expect(row.getByTestId('followup-text')).toContainText('Season 4');
  await expect(nRow(page, 'tv-125935')).toHaveCount(0);

  // a watch AFTER the season came out: nothing new for them
  await markWatched(page, 'HG', ['tv-136315'], 'manual', MS('2026-10-10T12:00:00')); // The Bear S3 aired 25 Sep
  await openTab(page, 'tonight');
  await openTab(page, 'new');
  await expect(fRow(page, 'tv-136315')).toHaveCount(0);
});

test('follow-ups: the row actions work (yes -> Matches, watched -> History, not tonight, save, never) and the row disappears', async ({ page }) => {
  await startMemoryPhone(page, { now: NOW });
  await openTab(page, 'new');
  await expect(fRow(page, 'tv-94997')).toHaveCount(1);
  for (const a of ['yes', 'not-tonight', 'seen', 'save', 'never']) await expect(fRow(page, 'tv-94997').getByTestId(`followup-${a}`)).toBeVisible();

  // Yes -> Matches, row gone, stays on the page
  await fRow(page, 'tv-94997').getByTestId('followup-yes').click();
  await expect(fRow(page, 'tv-94997')).toHaveCount(0);
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(tid(page, 'toast')).toContainText('Added to Matches');
  expect((await sharedState(page)).picks.map((p: { itemId: string }) => p.itemId)).toContain('tv-94997');

  // Seen -> History
  await fRow(page, 'tv-1416').getByTestId('followup-seen').click();
  await expect(fRow(page, 'tv-1416')).toHaveCount(0);
  const st = await sharedState(page);
  expect(Object.keys(st.seen.HG)).toContain('tv-1416');
  await openTab(page, 'history');
  await expect(page.locator('[data-testid="history-row"][data-item-id="tv-1416"]')).toHaveCount(1);
});

test('follow-ups: save and never open their sheets; not tonight hides the row; with several the section lists them and later ones can be revealed', async ({ page }) => {
  await startMemoryPhone(page, { now: NOW });
  await openTab(page, 'new');
  await fRow(page, 'tv-94997').getByTestId('followup-save').click();
  await expect(tid(page, 'save-sheet')).toBeVisible();
  await tid(page, 'save-option-ours').click();
  await expect(fRow(page, 'tv-94997')).toHaveCount(0);
  expect((await sharedState(page)).watchlist.find((w: { itemId: string }) => w.itemId === 'tv-94997')?.list).toBe('ours');

  await fRow(page, 'tv-1416').getByTestId('followup-never').click();
  await expect(tid(page, 'never-sheet')).toBeVisible();
  await tid(page, 'never-confirm').click();
  await expect(fRow(page, 'tv-1416')).toHaveCount(0);
  expect(Object.keys((await sharedState(page)).never.HG)).toContain('tv-1416');

  // watching several shows long ago makes several follow-ups; at most 6 are listed, the button reveals the rest
  const ids = ['tv-125935', 'tv-136315', 'tv-205715', 'tv-14658'];
  await markWatched(page, 'HG', ids, 'manual', MS('2026-01-15T12:00:00'));
  await openTab(page, 'tonight');
  await openTab(page, 'new');
  const n = await tid(page, 'followup-row').count();
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(6);
  const first = (await fIds(page))[0]!;
  await fRow(page, first).getByTestId('followup-not-tonight').click();
  await expect(fRow(page, first)).toHaveCount(0);
});

test('follow-ups: the dot on the New tab is there before the section was seen and gone after', async ({ page }) => {
  await startMemoryPhone(page, { now: NOW });
  await expect(tid(page, 'new-dot')).toBeVisible();
  await openTab(page, 'new');
  await expect(tid(page, 'followups')).toBeVisible();
  await expect(tid(page, 'new-dot')).toHaveCount(0);
  await openTab(page, 'tonight');
  await expect(tid(page, 'new-dot')).toHaveCount(0);
  await page.reload();
  await expect(tid(page, 'tabbar')).toBeVisible();
  await expect(tid(page, 'new-dot')).toHaveCount(0);
  // a fresh follow-up brings the dot back
  await markWatched(page, 'HG', ['tv-125935'], 'manual', MS('2026-01-15T12:00:00'));
  await expect(tid(page, 'new-dot')).toBeVisible();
  await openTab(page, 'new');
  await expect(fRow(page, 'tv-125935')).toHaveCount(1);
  await expect(tid(page, 'new-dot')).toHaveCount(0);
});

test('follow-ups: a follow-up disappears once the title is on the Matches tab or marked watched elsewhere', async ({ page }) => {
  await startMemoryPhone(page, { now: NOW });
  await openTab(page, 'new');
  await expect(fRow(page, 'tv-1416')).toHaveCount(1);
  await expect(fRow(page, 'tv-94997')).toHaveCount(1);
  // mark Grey's watched "now" from the Matches/History side and add HotD as a pick through the deck API
  await markWatched(page, 'HG', ['tv-1416'], 'manual', MS(NOW));
  await wtw(page, async (w) => {
    const item = w.catalog.items.find((i: { id: string }) => i.id === 'tv-94997');
    const svc = w.engine.chooseService(item, w.sync.getState().settings.plans);
    await w.sync.addPick({ kind: 'solo', who: 'HG', itemId: 'tv-94997', snapshot: { title: item.title, year: item.year, poster: null }, pick: { type: 'series-start' }, service: svc });
  });
  await expect(fRow(page, 'tv-1416')).toHaveCount(0);
  await expect(fRow(page, 'tv-94997')).toHaveCount(0);
});
