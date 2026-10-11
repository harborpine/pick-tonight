import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_NETFLIX_CSV } from '../../../src/contracts/fixtures/catalog';
import { askSolo, expectInViewport, expectNoHorizontalScroll, markWatched, openTab, startMemoryPhone, swipeCard, tid } from '../helpers/app';

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png` });

test('layout v2: six-tab bar, Matches, History, add sheet, import summary and follow-ups fit an iPhone', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00'));
  await startMemoryPhone(page);

  // six-tab bar: every tab fully on screen, labels not clipped, tap targets big enough, no overlap
  const tabs = ['tonight', 'new', 'watchlist', 'matches', 'history', 'us'] as const;
  const vw = page.viewportSize()!.width;
  let prevRight = -1;
  for (const t of tabs) {
    const el = tid(page, `tab-${t}`);
    await expect(el).toBeVisible();
    const b = (await el.boundingBox())!;
    expect(b.x, `${t} tab left`).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width, `${t} tab right`).toBeLessThanOrEqual(vw + 1);
    expect(b.width, `${t} tab is a usable tap target`).toBeGreaterThanOrEqual(40);
    expect(b.x, `${t} tab overlaps the previous one`).toBeGreaterThanOrEqual(prevRight - 1);
    prevRight = b.x + b.width;
    const clipped = await el.evaluate((n) => [n, ...Array.from(n.querySelectorAll('*'))].filter((c) => c.children.length === 0 && (c.textContent ?? '').trim().length > 0).some((c) => (c as HTMLElement).scrollWidth > (c as HTMLElement).clientWidth + 1));
    expect(clipped, `${t} tab label is cut off`).toBe(false);
    const text = ((await el.textContent()) ?? '').trim();
    expect(text.length, `${t} tab has a label`).toBeGreaterThanOrEqual(2);
  }
  await expectNoHorizontalScroll(page);
  await shot(page, '30-tabbar');

  // Ask screen with the "I don't care" chip
  await tid(page, 'ask-group-time').scrollIntoViewIfNeeded();
  await tid(page, 'ask-time-any').click();
  await expectInViewport(page, tid(page, 'ask-time-any'), "I don't care");
  await shot(page, '31-ask-time-any');

  // Liked chip over the deck
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 'any', novelty: 'new' });
  await swipeCard(page, 'right');
  await expect(tid(page, 'liked-chip')).toBeVisible();
  await expectInViewport(page, tid(page, 'liked-chip'), 'Liked chip');
  await expectNoHorizontalScroll(page);
  await shot(page, '32-deck-liked');

  // Matches
  await openTab(page, 'matches');
  await expect(tid(page, 'match-row').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  for (const f of ['all', 'mine', 'BG', 'together']) await expectInViewport(page, tid(page, `matches-filter-${f}`), `filter ${f}`);
  await shot(page, '33-matches');
  await tid(page, 'match-row').first().click();
  await expect(tid(page, 'match-detail')).toBeVisible();
  await page.waitForTimeout(600);
  await expectInViewport(page, tid(page, 'match-detail'), 'match detail sheet');
  await expectInViewport(page, tid(page, 'match-watched'), 'I watched this');
  await shot(page, '34-match-detail');
  await tid(page, 'match-close').click();

  // History with a few rows, then the add sheet
  await markWatched(page, 'HG', ['tv-8592', 'tv-48891', 'tv-18347']);
  await openTab(page, 'history');
  await expect(tid(page, 'history-row').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectInViewport(page, tid(page, 'history-add'), 'add button');
  await shot(page, '35-history');
  await tid(page, 'history-add').click();
  await tid(page, 'history-add-input').fill('breaking');
  await expect(tid(page, 'history-add-result').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await expectInViewport(page, tid(page, 'history-add-sheet'), 'add sheet');
  await expectInViewport(page, tid(page, 'history-add-close'), 'add sheet close');
  await expectNoHorizontalScroll(page);
  await shot(page, '36-history-add-sheet');
  await tid(page, 'history-add-close').click();

  // Import summary
  await openTab(page, 'us');
  await tid(page, 'us-seg-HG').click();
  await tid(page, 'import-section').scrollIntoViewIfNeeded();
  await expectNoHorizontalScroll(page);
  await shot(page, '37-import-start');
  const dir = mkdtempSync(join(tmpdir(), 'wtw-layout-'));
  const f = join(dir, 'n.csv');
  writeFileSync(f, FIXTURE_NETFLIX_CSV);
  await tid(page, 'import-file').setInputFiles(f);
  await expect(tid(page, 'import-summary')).toBeVisible({ timeout: 20_000 });
  await tid(page, 'import-unmatched-toggle').click();
  await tid(page, 'import-confirm').scrollIntoViewIfNeeded();
  await expectNoHorizontalScroll(page);
  await expectInViewport(page, tid(page, 'import-confirm'), 'import confirm');
  const tab = (await tid(page, 'tabbar').boundingBox())!;
  const conf = (await tid(page, 'import-confirm').boundingBox())!;
  expect(conf.y + conf.height, 'import confirm hidden under the tab bar').toBeLessThanOrEqual(tab.y + 1);
  await shot(page, '38-import-summary');
  await tid(page, 'import-cancel').click();

  // Follow-ups at the top of New
  await openTab(page, 'new');
  await expect(tid(page, 'followups')).toBeVisible();
  await expectNoHorizontalScroll(page);
  for (const r of await tid(page, 'followup-row').all()) {
    const b = (await r.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.x + b.width).toBeLessThanOrEqual(vw + 1);
  }
  await shot(page, '39-followups');
});
