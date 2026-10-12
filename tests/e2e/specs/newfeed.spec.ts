import { expect, test, type Page } from '@playwright/test';
import { OFF_PLAN, SAMPLE, catalogRows, markWatched, openTab, quickHousehold, sharedState, tid, wtw } from '../helpers/app';

// The fixture's follow-up dates are fixed (Grey's S21 on 2026-10-01 ...), so pretend it is 11 Oct 2026.
const NOW = '2026-10-11T12:00:00';
const MS = (iso: string) => new Date(iso).getTime();

const fRow = (page: Page, id: string) => page.locator(`[data-testid="followup-row"][data-item-id="${id}"]`);
const nRow = (page: Page, id: string) => page.locator(`[data-testid="new-row"][data-item-id="${id}"]`);
const fIds = (page: Page) => tid(page, 'followup-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')));

test('New feed: arrivals on the household\'s plans with a label, date, what to watch and where; off-plan arrivals are absent', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]], { now: NOW });
  await openTab(page, 'new');
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(tid(page, 'new-row').first()).toBeVisible();
  expect(await tid(page, 'new-row').count()).toBeGreaterThanOrEqual(4);
  for (const id of OFF_PLAN) await expect(nRow(page, id), `${id} is off-plan`).toHaveCount(0);

  const abbott = nRow(page, 'tv-125935');
  await expect(abbott).toHaveAttribute('data-type', 'season');
  await expect(abbott.getByTestId('new-title')).toHaveText('Abbott Elementary');
  await expect(abbott.getByTestId('new-label')).toHaveText('New season 4');
  await expect(abbott.getByTestId('new-date')).not.toHaveText('');
  await expect(abbott.getByTestId('new-pick')).not.toHaveText('');
  await expect(abbott.getByTestId('new-service-name')).not.toHaveText('');
  const onion = nRow(page, 'movie-661374');
  await expect(onion).toHaveAttribute('data-type', 'title');
  await expect(onion.getByTestId('new-label')).toHaveText('New');
  await expect(onion.getByTestId('new-service-name')).toHaveText('Netflix');
  await expect(onion.getByTestId('new-service-ad-badge')).toHaveAttribute('data-adfree', 'true');
  await expect(onion.getByTestId('new-pick')).toHaveText('Movie');
  for (const a of ['new-yes', 'new-not-tonight', 'new-seen', 'new-save', 'new-never']) await expect(onion.getByTestId(a)).toBeVisible();
});

test('New feed with fewer services: arrivals on a service the household does not have disappear', async ({ page }) => {
  await quickHousehold(page, [SAMPLE[0]], { plans: { netflix: 'standard' }, now: NOW });
  await openTab(page, 'new');
  await expect(nRow(page, 'movie-661374')).toHaveCount(1); // Netflix
  await expect(nRow(page, 'tv-125935')).toHaveCount(0); // Hulu / HBO only
  await expect(nRow(page, 'tv-205715')).toHaveCount(0); // Peacock only
});

test('New feed: scary arrivals (Get Out) are for Alex alone; Sam, and any audience with Sam in it, never see them', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE, { now: NOW });
  await openTab(page, 'new');
  await expect(nRow(page, 'movie-419430')).toHaveCount(1);
  await tid(page, `who-${h.ids.Sam}`).click(); // Alex + Sam
  await expect(tid(page, 'new-row').first()).toBeVisible();
  await expect(nRow(page, 'movie-419430')).toHaveCount(0);
  await tid(page, 'who-everyone').click();
  await expect(nRow(page, 'movie-419430')).toHaveCount(0);
  await h.actAs('Sam');
  await expect(tid(page, 'new-row').first()).toBeVisible();
  await expect(nRow(page, 'movie-419430')).toHaveCount(0);
});

test('New feed: Yes / Save / Seen / Not tonight / Never behave like the deck actions', async ({ page }) => {
  const h = await quickHousehold(page, [SAMPLE[0]], { now: NOW });
  await openTab(page, 'new');
  const rowsBefore = await tid(page, 'new-row').count();
  await nRow(page, 'movie-661374').getByTestId('new-yes').click();
  await expect(tid(page, 'toast')).toContainText('Matches');
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(nRow(page, 'movie-661374')).toHaveCount(0);
  await nRow(page, 'movie-346648').getByTestId('new-save').click();
  await expect(tid(page, 'save-sheet'), 'a household of one has one list: Save should not ask which').toHaveCount(0);
  await expect(nRow(page, 'movie-346648')).toHaveCount(0); // straight to the one list
  await nRow(page, 'tv-136315').getByTestId('new-seen').click();
  await expect(nRow(page, 'tv-136315')).toHaveCount(0);
  await nRow(page, 'tv-205715').getByTestId('new-not-tonight').click();
  await expect(nRow(page, 'tv-205715')).toHaveCount(0);
  await nRow(page, 'movie-419430').getByTestId('new-never').click();
  await expect(tid(page, 'never-sheet')).toBeVisible();
  await tid(page, 'never-confirm').click();
  await expect(nRow(page, 'movie-419430')).toHaveCount(0);
  expect(await tid(page, 'new-row').count()).toBe(rowsBefore - 5);

  const st = await sharedState(page);
  expect(st.picks.find((p: { itemId: string }) => p.itemId === 'movie-661374')?.kind).toBe('solo');
  expect(st.watchlist.find((w: { itemId: string }) => w.itemId === 'movie-346648')?.list).toBe(h.first);
  expect(Object.keys(st.seen[h.first])).toContain('tv-136315');
  expect(st.notTonight[h.first]['tv-205715']).toBeTruthy();
  expect(Object.keys(st.never[h.first])).toContain('movie-419430');
  await page.reload();
  await openTab(page, 'new');
  await expect(tid(page, 'new-row').first()).toBeVisible();
  await expect(nRow(page, 'movie-419430')).toHaveCount(0);
  await expect(nRow(page, 'tv-205715')).toHaveCount(0);
});

test('follow-ups: Alex sees "Because you watched..." at the top: House of the Dragon (spinoff) and Grey\'s Anatomy S21', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE, { now: NOW });
  await openTab(page, 'new');
  await expect(tid(page, 'followups')).toBeVisible();
  await expect(tid(page, 'followups-title')).toContainText('Because you watched');
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
  await expect(grey.getByTestId('followup-pick')).toHaveText('Watch the new season (Season 21)');
  await expect(grey).toHaveAttribute('data-type', 'new-season');
  await expect(grey.getByTestId('followup-text')).toContainText('Season 21');
  await expect(grey.getByTestId('followup-date')).not.toHaveText('');
  for (const id of await fIds(page)) await expect(nRow(page, id!)).toHaveCount(0); // not repeated below

  // Alex + Sam: Grey's is a favourite of both; the spinoff comes from Game of Thrones, which only Alex loves, and says so
  await tid(page, `who-${h.ids.Sam}`).click();
  await expect(fRow(page, 'tv-1416')).toHaveCount(1);
  await expect(fRow(page, 'tv-94997').getByTestId('followup-text')).toContainText('Alex');
  await expect(fRow(page, 'tv-1416').getByTestId('followup-text')).not.toContainText('one of');
});

test('follow-ups: Sam sees her own (Grey\'s S21, The Traitors S3), never a spinoff of a show she has not watched, nothing that breaks her never-show-me choices', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE, { now: NOW });
  await h.actAs('Sam');
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
    expect(f.horror || f.trueCrime || f.scary, `${rows[id].title} breaks Sam's choices`).toBe(false);
  }
  for (const who of [[h.ids.Sam], [h.ids.Alex, h.ids.Sam].sort(), Object.values(h.ids).sort()]) {
    const list: { itemId: string }[] = await wtw(page, (w, a) => w.engine.followUps(a.who, { catalog: w.catalogs.get().catalog, state: w.sync.getState(), today: '2026-10-11' }), { who });
    for (const f of list) {
      const fl = rows[f.itemId].flags;
      expect(fl.horror || fl.trueCrime || fl.scary, `${rows[f.itemId].title} for ${who.join('+')}`).toBe(false);
    }
  }
});

test('follow-ups: a new season after an older watch date appears; a watch dated after it does not; a brand-new person has none', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE, { now: NOW });
  await openTab(page, 'new');
  await expect(fRow(page, 'tv-125935')).toHaveCount(0); // Abbott S4 (7 Oct) is not something Alex has watched
  await markWatched(page, h.first, ['tv-125935'], 'manual', MS('2026-01-15T12:00:00'));
  await openTab(page, 'tonight');
  await openTab(page, 'new');
  const row = fRow(page, 'tv-125935');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-type', 'new-season');
  await expect(row.getByTestId('followup-text')).toContainText('Season 4');
  await expect(nRow(page, 'tv-125935')).toHaveCount(0);
  await markWatched(page, h.first, ['tv-136315'], 'manual', MS('2026-10-10T12:00:00')); // The Bear S3 aired 25 Sep
  await openTab(page, 'tonight');
  await openTab(page, 'new');
  await expect(fRow(page, 'tv-136315')).toHaveCount(0);
  await h.actAs('Kit');
  await openTab(page, 'tonight');
  await openTab(page, 'new');
  await expect(tid(page, 'followup-row')).toHaveCount(0);
  await expect(tid(page, 'new-feed')).toBeVisible();
});

test('follow-ups: the row actions work (yes -> Matches, watched -> History) and the row disappears', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE, { now: NOW });
  await openTab(page, 'new');
  for (const a of ['yes', 'not-tonight', 'seen', 'save', 'never']) await expect(fRow(page, 'tv-94997').getByTestId(`followup-${a}`)).toBeVisible();
  await fRow(page, 'tv-94997').getByTestId('followup-yes').click();
  await expect(fRow(page, 'tv-94997')).toHaveCount(0);
  await expect(tid(page, 'new-feed')).toBeVisible();
  await expect(tid(page, 'toast')).toContainText('Matches');
  expect((await sharedState(page)).picks.map((p: { itemId: string }) => p.itemId)).toContain('tv-94997');
  await fRow(page, 'tv-1416').getByTestId('followup-seen').click();
  await expect(fRow(page, 'tv-1416')).toHaveCount(0);
  expect(Object.keys((await sharedState(page)).seen[h.first])).toContain('tv-1416');
  await openTab(page, 'history');
  await expect(page.locator('[data-testid="history-row"][data-item-id="tv-1416"]')).toHaveCount(1);
});

test('follow-ups: save (to a chosen list) and never open their sheets; several follow-ups are capped and the rest can be revealed', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE, { now: NOW });
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
  expect(Object.keys((await sharedState(page)).never[h.first])).toContain('tv-1416');
  await markWatched(page, h.first, ['tv-125935', 'tv-136315', 'tv-205715', 'tv-14658'], 'manual', MS('2026-01-15T12:00:00'));
  await openTab(page, 'tonight');
  await openTab(page, 'new');
  const n = await tid(page, 'followup-row').count();
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(6);
  const first = (await fIds(page))[0]!;
  await fRow(page, first).getByTestId('followup-not-tonight').click();
  await expect(fRow(page, first)).toHaveCount(0);
});

test('follow-ups: the dot on the New tab shows before the section was seen and is gone after (per phone)', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE, { now: NOW });
  await expect(tid(page, 'new-dot')).toBeVisible();
  await openTab(page, 'new');
  await expect(tid(page, 'followups')).toBeVisible();
  await expect(tid(page, 'new-dot')).toHaveCount(0);
  await openTab(page, 'tonight');
  await expect(tid(page, 'new-dot')).toHaveCount(0);
  await page.reload();
  await expect(tid(page, 'tabbar')).toBeVisible();
  await expect(tid(page, 'new-dot')).toHaveCount(0);
  await markWatched(page, h.first, ['tv-125935'], 'manual', MS('2026-01-15T12:00:00'));
  await expect(tid(page, 'new-dot')).toBeVisible();
  await openTab(page, 'new');
  await expect(fRow(page, 'tv-125935')).toHaveCount(1);
  await expect(tid(page, 'new-dot')).toHaveCount(0);
});

test('follow-ups: a follow-up disappears once the title is watched or sitting in Matches', async ({ page }) => {
  const h = await quickHousehold(page, SAMPLE, { now: NOW });
  await openTab(page, 'new');
  await expect(fRow(page, 'tv-1416')).toHaveCount(1);
  await expect(fRow(page, 'tv-94997')).toHaveCount(1);
  await markWatched(page, h.first, ['tv-1416'], 'manual', MS(NOW));
  await wtw(page, async (w, who) => {
    const item = w.catalogs.get().catalog.items.find((i: { id: string }) => i.id === 'tv-94997');
    const svc = w.engine.chooseService(item, w.sync.getState().settings.plans);
    await w.sync.addPick({ kind: 'solo', who: [who], itemId: 'tv-94997', snapshot: { title: item.title, year: item.year, poster: null }, pick: { type: 'series-start' }, service: svc });
  }, h.first);
  await expect(fRow(page, 'tv-1416')).toHaveCount(0);
  await expect(fRow(page, 'tv-94997')).toHaveCount(0);
});
