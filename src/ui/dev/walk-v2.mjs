// Dev-only: walk the version-2 flows at iPhone size, save screenshots, print checks.
// Usage: node src/ui/dev/walk-v2.mjs <outDir> [baseUrl] [width]   (dev server must be running)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots-v2';
const base = process.argv[3] ?? 'http://localhost:5173/what-to-watch/';
const width = Number(process.argv[4] ?? 390);
mkdirSync(out, { recursive: true });
const URL = `${base}?catalog=fixture&sync=memory`;

const CSV = `Title,Date
"The Office (U.S.): Season 4: Dinner Party",10/2/26
"The Office (U.S.): Season 2: The Dundies",9/30/26
"The Office (U.S.): Season 2: Booze Cruise",9/29/26
"The Office (U.S.): Season 1: Pilot",9/28/26
"Breaking Bad: Season 5: Ozymandias",9/20/26
"Breaking Bad: Season 5: Felina",9/21/26
"Breaking Bad: Season 1: Pilot",8/1/26
"Stranger Things: Stranger Things 2: Chapter One: MADMAX",7/4/26
"Stranger Things: Chapter One: The Vanishing of Will Byers",7/1/26
"Paddington 2",6/15/26
"Parasite",5/5/26
"Ted Lasso: Season 1: Biscuits",4/1/26
"Black Mirror: Bandersnatch",3/3/26
"Zzyzx Road Trip Diaries: Limited Series: Part 1",2/2/26
"Completely Unknown Home Movie",1/1/26
`;
const csvPath = join(tmpdir(), 'NetflixViewingHistory.csv');
writeFileSync(csvPath, CSV);
// A big one: 10,000 rows.
let big = 'Title,Date\n';
for (let i = 0; i < 10000; i++) big += `"The Office (U.S.): Season ${1 + (i % 9)}: Episode ${i}",${1 + (i % 12)}/${1 + (i % 27)}/25\n`;
const bigPath = join(tmpdir(), 'BigHistory.csv');
writeFileSync(bigPath, big);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

page.on('framenavigated', (f) => { if (f === page.mainFrame()) errors.push('NAV ' + f.url()); });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const tid = (id) => page.getByTestId(id);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
process.on('uncaughtException', (e) => { console.log(results.join(String.fromCharCode(10))); console.log('CRASH:', String(e.message).split(String.fromCharCode(10))[0]); console.log('errors:', errors.join(String.fromCharCode(10))); process.exit(1); });
const overflowX = async () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || [...document.querySelectorAll('.app *')].some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && !el.closest('.chip-scroll, .confetti, .onboard-grid, [data-allow-overflow]') && getComputedStyle(el).position !== 'fixed'; }));

await page.goto(URL);
await tid('person-HG').click();
await tid('start-household').click();
await tid('onboarding').waitFor();
await page.locator('[data-testid^="onboard-item-"]').nth(0).click();
await page.locator('[data-testid^="onboard-item-"]').nth(2).click();
await tid('onboard-done').click();
await tid('ask').waitFor();
{
  const seen = await page.evaluate(() => { const s = window.__wtw.sync.getState(); return Object.entries(s.seen.HG).map(([id, e]) => [id, e.source, !!e.snapshot]); });
  check('first-run grid writes source=onboarding with snapshot', seen.length === 2 && seen.every((s) => s[1] === 'onboarding' && s[2]), JSON.stringify(seen));
}

// ---- tab bar
await shot('01-ask');
{
  const boxes = await page.$$eval('[data-testid^="tab-"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); const s = e.querySelector('span:last-child'); return { id: e.dataset.testid, w: Math.round(r.width), h: Math.round(r.height), truncated: s ? s.scrollWidth > s.clientWidth + 1 : false, right: Math.round(r.right) }; }));
  check('six tabs in bar', boxes.length === 6, JSON.stringify(boxes.map((b) => b.id)));
  check('tabs >= 44px wide & tall', boxes.every((b) => b.w >= 44 && b.h >= 44), JSON.stringify(boxes.map((b) => `${b.w}x${b.h}`)));
  check('no tab label truncated', boxes.every((b) => !b.truncated));
  check('tab bar inside screen', boxes.every((b) => b.right <= width), `max right ${Math.max(...boxes.map((b) => b.right))}`);
}

// ---- time row + novelty hint
{
  const chips = await page.$$eval('[data-testid^="ask-time-"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.testid, l: Math.round(r.left), r: Math.round(r.right), text: e.textContent }; }));
  check('time row has five chips incl. any', chips.length === 5 && chips.some((c) => c.id === 'ask-time-any'), JSON.stringify(chips.map((c) => c.text)));
  check('time chips inside 0..width', chips.every((c) => c.l >= 0 && c.r <= width));
  check('page has no horizontal overflow (ask)', !(await overflowX()));
  check("novelty 'Either' hint", (await tid('ask-novelty-either-hint').textContent()) === 'mostly new');
  await tid('ask-time-any').scrollIntoViewIfNeeded();
  await shot('02-ask-time-any');
}
await tid('ask-time-any').click();
check('time any selected', (await tid('ask-time-any').getAttribute('data-selected')) === 'true');

// ---- solo deck, right swipes stay on the deck
await tid('ask-who-HG').click();
await tid('ask-submit').click();
await tid('solo-deck').waitFor();
await page.waitForTimeout(400);
check('no liked chip before any yes', (await tid('liked-chip').count()) === 0);
await shot('03-deck');
const yesIds = [];
for (let i = 0; i < 3; i++) {
  yesIds.push(await tid('card').getAttribute('data-item-id'));
  await tid('action-yes').click();
  await page.waitForTimeout(i === 0 ? 120 : 500);
  if (i === 0) await shot('04-liked-pulse');
  await page.waitForTimeout(400);
}
check('still on the deck after 3 yes (no pick screen)', (await tid('pick-screen').count()) === 0 && (await tid('solo-deck').count()) === 1);
check('liked chip says 3', (await tid('liked-count').textContent()) === '3');
check('next card is there', (await tid('card').count()) === 1 && !yesIds.includes(await tid('card').getAttribute('data-item-id')));
await shot('05-liked-3');
{
  const picks = await page.evaluate(() => window.__wtw.sync.getState().picks.map((p) => ({ kind: p.kind, who: p.who, itemId: p.itemId })));
  check('3 solo picks stored', picks.length === 3 && picks.every((p) => p.kind === 'solo' && p.who === 'HG'), JSON.stringify(picks));
  const seen = await page.evaluate(() => Object.keys(window.__wtw.sync.getState().seen.HG).length);
  check('right-swipes do not touch seen', seen === 2, `seen=${seen}`);
}
check('header has no overflow', !(await overflowX()));

// ---- Matches tab via the chip
await tid('liked-chip').click();
await tid('matches').waitFor();
check('chip opens Matches', (await tid('page-title').textContent()) === 'Matches');
await page.waitForTimeout(200);
await shot('06-matches');
check('3 rows', (await tid('match-row').count()) === 3);
check('rows show Liked by HG', (await tid('match-label').first().textContent()) === 'Liked by HG');
check('where to watch shown', ((await tid('match-where').first().textContent()) ?? '').length > 3, await tid('match-where').first().textContent());
check('filter: Mine=3, BG=0, Together=0', await (async () => {
  await tid('matches-filter-mine').click(); const a = await tid('match-row').count();
  await tid('matches-filter-BG').click(); const b = await tid('match-row').count();
  const emptyShown = (await tid('matches-empty').count()) === 1;
  await tid('matches-filter-together').click(); const c = await tid('match-row').count();
  await tid('matches-filter-all').click();
  return a === 3 && b === 0 && c === 0 && emptyShown;
})());

// detail -> watched
const firstId = await tid('match-row').first().getAttribute('data-item-id');
await tid('match-row').first().click();
await tid('match-detail').waitFor();
await page.waitForTimeout(350);
await shot('07-match-detail');
check('detail button text', (await tid('match-watched').textContent()) === 'I watched this');
await tid('match-watched').click();
await page.waitForTimeout(300);
check('toast Moved to History', ((await tid('toast').textContent()) ?? '').includes('Moved to History'));
check('pick removed -> 2 rows', (await tid('match-row').count()) === 2);
{
  const s = await page.evaluate((id) => { const st = window.__wtw.sync.getState(); return { hg: st.seen.HG[id], bg: st.seen.BG[id] }; }, firstId);
  check('HG watched entry written (manual + snapshot), BG untouched', s.hg?.source === 'manual' && !!s.hg?.snapshot && !s.bg, JSON.stringify(s));
}
// remove
await tid('match-row').first().click();
await tid('match-remove').click();
await page.waitForTimeout(250);
check('Remove deletes pick and does not mark watched', (await tid('match-row').count()) === 1 && (await page.evaluate(() => Object.keys(window.__wtw.sync.getState().seen.HG).length)) === 3);

// ---- History tab
await tid('tab-history').click();
await tid('history').waitFor();
await page.waitForTimeout(200);
await shot('08-history');
check('History lists 3 watched (2 first-run + 1 watched)', (await tid('history-row').count()) === 3);
check('no picks in History', (await tid('history-row').evaluateAll((els, id) => els.filter((e) => e.dataset.itemId === id).length, firstId)) === 1);
const sources = await tid('history-source').allTextContents();
check('source notes', sources.includes('Marked watched') && sources.includes('From your first-run picks'), JSON.stringify(sources));
check('favourites note present', ((await tid('history-favorites-note').textContent()) ?? '').includes('Favourites'));
// remove + undo
const rm = await tid('history-row').first().getAttribute('data-item-id');
await tid('history-remove').first().click();
await page.waitForTimeout(250);
check('removed row gone', (await tid('history-row').count()) === 2);
await shot('09-history-undo-toast');
await tid('toast-action').click();
await page.waitForTimeout(250);
check('undo brings it back', (await tid('history-row').count()) === 3 && (await page.getByTestId('history-row').evaluateAll((els, id) => els.some((e) => e.dataset.itemId === id), rm)));
// search
await tid('history-search').fill('zzzz');
await page.waitForTimeout(300);
check('search no results message', (await tid('history-no-results').count()) === 1);
await tid('history-search').fill('');
// partner switch
await tid('history-person-partner').click();
check('partner starts empty', (await tid('history-empty').count()) === 1);
await tid('history-person-me').click();

// ---- add something I've watched
await tid('history-add').click();
await tid('history-add-sheet').waitFor();
await tid('history-add-input').fill('seinfeld');
await tid('history-add-result').first().waitFor();
await page.waitForTimeout(300);
await shot('10-add-sheet');
check('search finds Seinfeld', ((await tid('history-add-result-title').first().textContent()) ?? '').includes('Seinfeld'));
await tid('history-add-result').first().click();
await page.waitForTimeout(250);
check('result marked Added', (await tid('history-add-result').first().getAttribute('data-added')) === 'true');
await tid('history-add-close').click();
{
  const e = await page.evaluate(() => window.__wtw.sync.getState().seen.HG['tv-1400']);
  check('manual add stored with snapshot', e?.source === 'manual' && e?.snapshot?.title === 'Seinfeld', JSON.stringify(e));
}

// ---- Import (HG's own profile)
await tid('tab-us').click();
await tid('us-seg-HG').click();
await tid('import-section').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await shot('11-import-section');
check('import instructions mention Download all', ((await tid('import-instructions').textContent()) ?? '').includes('Download all'));
check('file input accepts documented types', (await tid('import-file').getAttribute('accept')) === '.csv,.tsv,.txt,.json,text/*,application/json');
await tid('import-file').setInputFiles(csvPath);
await tid('import-summary').waitFor({ timeout: 8000 });
await tid('import-summary').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await shot('12-import-summary');
const summaryText = await tid('import-summary').textContent();
check('summary says Found N titles across M plays', /Found \d+ titles? across [\d,]+ plays?/.test(summaryText ?? ''), (summaryText ?? '').slice(0, 90));
check('summary has unmatched', Number(await tid('import-summary').getAttribute('data-unmatched')) >= 1);
await tid('import-unmatched-toggle').click();
await shot('13-import-unmatched');
check('unmatched names listed', (await tid('import-unmatched-row').count()) >= 1, (await tid('import-unmatched-row').allTextContents()).join(' | '));
check('nothing saved yet', await page.evaluate(() => !window.__wtw.sync.getState().seen.HG['tv-1396']));
await tid('import-confirm').scrollIntoViewIfNeeded();
await tid('import-confirm').click();
await tid('import-result').waitFor({ timeout: 8000 });
await shot('14-import-done');
check('success message', ((await tid('import-result').textContent()) ?? '').includes('Your suggestions will now reflect them.'), await tid('import-result').textContent());
{
  const s = await page.evaluate(() => { const st = window.__wtw.sync.getState(); const e = st.seen.HG['tv-1396']; return { e, n: Object.keys(st.seen.HG).length }; });
  check('imported entry has plays + source import + snapshot', s.e?.source === 'import' && s.e?.plays === 3 && !!s.e?.snapshot, JSON.stringify(s.e));
}
// re-import: all already there
await tid('import-again').click();
await tid('import-file').setInputFiles(csvPath);
await tid('import-summary').waitFor();
check('re-import reports already there', (await tid('import-new-count').textContent()) === '0', `new=${await tid('import-new-count').textContent()} already=${await tid('import-already-count').textContent()}`);
await tid('import-cancel').click();
// unreadable
await tid('import-paste').fill('');
await tid('import-file').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"nothing": [1,2,3]}') });
await tid('import-problem').waitFor();
await shot('15-import-unreadable');
check('unreadable shows friendly message', ((await tid('import-problem').textContent()) ?? '').includes('couldn’t read'), await tid('import-problem').textContent());
await tid('import-retry').click();
// paste list
await tid('import-paste').fill('The Office\nInception\nNot A Real Title At All');
await tid('import-paste-go').click();
await tid('import-summary').waitFor();
check('pasted list parsed', Number(await tid('import-summary').getAttribute('data-matched')) >= 1);
await tid('import-cancel').click();

// big file
{
  const t0 = Date.now();
  await tid('import-file').setInputFiles(bigPath);
  await page.getByTestId('import-reading').waitFor({ timeout: 3000 }).catch(() => {});
  const sawSpinner = (await tid('import-reading').count()) === 1 || (await tid('import-summary').count()) === 1;
  await tid('import-summary').waitFor({ timeout: 30000 });
  check('10,000-row file summarised', true, `${Date.now() - t0} ms; spinner/summary seen=${sawSpinner}`);
  await tid('import-cancel').click();
}

// partner import needs confirmation
await tid('tab-us').click();
await tid('us-seg-BG').click();
await tid('import-file').setInputFiles(csvPath);
await tid('import-summary').waitFor();
await tid('import-confirm').scrollIntoViewIfNeeded();
check('partner button names them', ((await tid('import-confirm').textContent()) ?? '').includes('BG'));
await tid('import-confirm').click();
await tid('import-partner-sheet').waitFor();
await shot('16-import-partner-confirm');
check('nothing saved before confirm', await page.evaluate(() => Object.keys(window.__wtw.sync.getState().seen.BG).length === 0));
await tid('import-partner-cancel').click();
check('cancel keeps BG empty', await page.evaluate(() => Object.keys(window.__wtw.sync.getState().seen.BG).length === 0));
await tid('import-confirm').click();
await tid('import-partner-confirm').click();
await tid('import-result').waitFor();
check('BG now has imported titles', await page.evaluate(() => Object.keys(window.__wtw.sync.getState().seen.BG).length > 3));

// ---- History with many rows (windowing)
await page.evaluate(async () => {
  const s = window.__wtw.sync;
  const entries = [];
  for (let i = 0; i < 3000; i++) entries.push({ itemId: `x-${i}`, at: 1_700_000_000_000 + i * 1000, source: 'import', plays: (i % 9) + 1, snapshot: { title: `Imported Title ${i}`, year: 2000 + (i % 25), poster: null } });
  await s.markWatched('HG', entries);
});
await tid('tab-history').click();
await page.waitForTimeout(500);
{
  const rows = await tid('history-row').count();
  check('3000+ watched renders only a page of rows', rows <= 60, `rows in DOM = ${rows}`);
  await shot('17-history-big');
  await tid('history-search').fill('Imported Title 29');
  await page.waitForTimeout(400);
  check('search filters big list', (await tid('history-row').count()) > 0 && (await tid('history-row').count()) <= 60, `matches shown=${await tid('history-row').count()}`);
  await tid('history-search').fill('');
}

// ---- follow-ups + dot
{
  const hasDot = (await tid('new-dot').count()) === 1;
  const fus = await page.evaluate(() => { const w = window.__wtw; const st = w.sync.getState(); const c = { catalog: w.catalog, state: st, today: '2026-10-11' }; return { me: w.engine.followUps('HG', c).map((f) => f.key), tog: w.engine.followUps('Together', c).map((f) => f.key) }; });
  check('dot present before visiting New (when follow-ups exist)', hasDot === (fus.me.length + fus.tog.length > 0), JSON.stringify(fus));
  await tid('tab-new').click();
  await page.waitForTimeout(500);
  await shot('18-new-followups');
  const n = await tid('followup-row').count();
  check('follow-up rows match engine', n === fus.me.length || (fus.me.length === 0 && n === fus.tog.length), 'rows=' + n);
  if (n > 0) {
    check('follow-up text shown', ((await tid('followup-text').first().textContent()) ?? '').length > 3, await tid('followup-text').allTextContents().then((a) => a.join(' | ')));
    check('dot cleared after section shown', (await tid('new-dot').count()) === 0);
    const before = await page.evaluate(() => window.__wtw.sync.getState().picks.length);
    const itemId = await tid('followup-row').first().getAttribute('data-item-id');
    await tid('followup-yes').first().click();
    await page.waitForTimeout(300);
    check('follow-up yes: toast + stays on New + pick added', ((await tid('toast').textContent()) ?? '').includes('Added to Matches') && (await tid('new-feed').count()) === 1 && (await page.evaluate(() => window.__wtw.sync.getState().picks.length)) === before + 1);
    check('row removed after yes', (await tid('followup-row').evaluateAll((els, id) => els.filter((e) => e.dataset.itemId === id).length, itemId)) === 0);
    await shot('19-new-after-yes');
  }
  const newBefore = await tid('new-row').count();
  if (newBefore > 0) {
    const pb = await page.evaluate(() => window.__wtw.sync.getState().picks.length);
    await tid('new-yes').first().click();
    await page.waitForTimeout(300);
    check('new-feed yes: pick + toast, no navigation', (await tid('new-feed').count()) === 1 && (await page.evaluate(() => window.__wtw.sync.getState().picks.length)) === pb + 1 && (await tid('pick-screen').count()) === 0);
  }
  await tid('tab-tonight').click();
  await tid('tab-new').click();
  await page.waitForTimeout(200);
  check('dot stays cleared on revisit', (await tid('new-dot').count()) === 0);
}

// ---- tab shots
for (const t of ['new', 'watchlist', 'matches', 'history', 'us']) {
  await tid(`tab-${t}`).click();
  await page.waitForTimeout(300);
  await shot(`20-tab-${t}`);
  check(`no horizontal overflow on ${t}`, !(await overflowX()));
}

console.log(results.join('\n'));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
