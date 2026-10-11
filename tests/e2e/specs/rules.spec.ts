import { expect, test, type Page } from '@playwright/test';
import {
  HIGH_ATTENTION,
  OFF_PLAN,
  REQ,
  SCARY_TITLES,
  askSolo,
  catalogRows,
  engineDeck,
  fillAsk,
  pageThroughDeck,
  parseMinutes,
  startMemoryPhone,
  tid,
  type CardInfo,
  type Who,
} from '../helpers/app';

/** Page through a whole Together deck on this one phone (memory mode starts the session for us). */
async function togetherDeck(page: Page, o: Parameters<typeof fillAsk>[1]): Promise<CardInfo[]> {
  await tid(page, 'tab-tonight').click();
  await fillAsk(page, { ...o, who: 'Together' });
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  return pageThroughDeck(page);
}

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

test('rule 1: nothing off-plan (Poker Face, Yellowjackets) in any deck or in the New feed', async ({ page }) => {
  await startMemoryPhone(page);
  // New feed (the fixture lists Poker Face as a recent arrival, but on a plan we do not have)
  await tid(page, 'tab-new').click();
  await expect(tid(page, 'new-row').first()).toBeVisible();
  for (const id of OFF_PLAN) await expect(page.locator(`[data-testid="new-row"][data-item-id="${id}"]`)).toHaveCount(0);
  await tid(page, 'new-who-Together').click();
  for (const id of OFF_PLAN) await expect(page.locator(`[data-testid="new-row"][data-item-id="${id}"]`)).toHaveCount(0);
  await tid(page, 'tab-tonight').click();
  for (const mood of ['laugh', 'gripped', 'feelgood']) {
    await askSolo(page, { who: 'HG', viewing: 'focused', mood, time: 120, novelty: 'either' });
    const deck = await pageThroughDeck(page);
    // (earlier decks were paged with Not tonight, so later decks are naturally shorter)
    expect(deck.length, `${mood} deck is not empty`).toBeGreaterThan(mood === 'laugh' ? 15 : 0);
    for (const id of OFF_PLAN) expect(ids(deck), `${id} in the ${mood} deck`).not.toContain(id);
    await tid(page, 'empty-back').click();
  }
});

test('rule 2: no horror / true crime / scary for BG alone or Together (while HG alone does get them)', async ({ page }) => {
  await startMemoryPhone(page);
  // Control: for HG the same question does offer the scary titles, so the check below is not vacuous.
  const hg = ids(await engineDeck(page, { ...REQ, who: 'HG', mood: 'gripped' }));
  for (const id of SCARY_TITLES) expect(hg, `control: HG gripped deck should contain ${id}`).toContain(id);

  const together = await togetherDeck(page, { mood: 'gripped', time: 120, viewing: 'focused', novelty: 'either' });
  expect(together.length).toBeGreaterThan(5);
  for (const id of SCARY_TITLES) expect(ids(together), `Together deck contains ${id}`).not.toContain(id);

  await tid(page, 'session-end').click();
  await tid(page, 'end-confirm').click();
  await expect(tid(page, 'ask')).toBeVisible();
  await askSolo(page, { who: 'BG', viewing: 'focused', mood: 'gripped', time: 120 });
  const bg = await pageThroughDeck(page);
  expect(bg.length).toBeGreaterThan(5);
  for (const id of SCARY_TITLES) expect(ids(bg), `BG deck contains ${id}`).not.toContain(id);
  await tid(page, 'empty-back').click();

  // The flags themselves: nothing flagged as horror/true crime/scary appears in either deck
  const rows = await catalogRows(page);
  for (const c of [...bg, ...together]) {
    const f = rows[c.id].flags;
    expect(f.horror || f.trueCrime || f.scary, `${c.title} is flagged`).toBe(false);
  }
});

test('rule 2: HG alone, Scared mood, actually delivers spooky titles', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'scared', time: 120, viewing: 'focused' });
  const deck = await pageThroughDeck(page);
  expect(deck.length).toBeGreaterThan(0);
  const rows = await catalogRows(page);
  expect(deck.some((c) => rows[c.id].flags.horror || rows[c.id].flags.scary)).toBe(true);
});

test('rule 3: Background and While eating only ever show low-attention titles', async ({ page }) => {
  await startMemoryPhone(page);
  const rows = await catalogRows(page);
  for (const [viewing, mood] of [
    ['background', 'laugh'],
    ['eating', 'gripped'], // the most tempting mood for heavy dramas
  ] as const) {
    await askSolo(page, { who: 'HG', viewing, mood, time: 120, novelty: 'either' });
    const deck = await pageThroughDeck(page);
    expect(deck.length, `${viewing}/${mood} deck is not empty`).toBeGreaterThan(2);
    for (const c of deck) expect(rows[c.id].attention, `${c.title} in ${viewing}`).toBe('low');
    for (const id of HIGH_ATTENTION) expect(ids(deck)).not.toContain(id);
    await tid(page, 'empty-back').click();
  }
  // Control: Focused + gripped does offer the heavy ones.
  const focused = ids(await engineDeck(page, { ...REQ, mood: 'gripped', viewing: 'focused' }));
  for (const id of HIGH_ATTENTION) expect(focused).toContain(id);
});

test('rule 4: "about 20 min" never shows anything longer than 25 minutes; longer budgets open up movies', async ({ page }) => {
  await startMemoryPhone(page);
  await askSolo(page, { who: 'HG', mood: 'laugh', time: 20, viewing: 'focused', novelty: 'either' });
  const short = await pageThroughDeck(page);
  expect(short.length).toBeGreaterThan(3);
  for (const c of short) expect(parseMinutes(c.minutes), `${c.title} is ${c.minutes}`).toBeLessThanOrEqual(25);
  await tid(page, 'empty-back').click();

  await askSolo(page, { time: 45 });
  const mid = await pageThroughDeck(page);
  expect(mid.length).toBeGreaterThan(2);
  for (const c of mid) expect(parseMinutes(c.minutes), `${c.title} is ${c.minutes}`).toBeLessThanOrEqual(50);
  await tid(page, 'empty-back').click();

  await askSolo(page, { time: 120 });
  const long = await pageThroughDeck(page);
  expect(long.some((c) => parseMinutes(c.minutes) > 90), 'a 2+ hr budget includes feature-length titles').toBe(true);
});

test('rule 5: New hides what has been seen; Rewatch only shows seen titles (Together: either of us)', async ({ page }) => {
  await startMemoryPhone(page);
  const hgSeen: string[] = await page.evaluate(() => (window as any).__wtw.sync.getState().profiles.HG.favorites);
  const bgSeen: string[] = await page.evaluate(() => (window as any).__wtw.sync.getState().profiles.BG.favorites);
  expect(hgSeen.length).toBeGreaterThan(3);

  await askSolo(page, { who: 'HG', mood: 'laugh', time: 120, novelty: 'rewatch' });
  const rew = await pageThroughDeck(page);
  expect(rew.length).toBeGreaterThan(2);
  for (const c of rew) expect(hgSeen, `${c.title} is not something HG has seen`).toContain(c.id);
  await tid(page, 'empty-back').click();

  await askSolo(page, { novelty: 'new' });
  const fresh = await pageThroughDeck(page);
  expect(fresh.length).toBeGreaterThan(5);
  for (const c of fresh) expect(hgSeen, `${c.title} was already seen by HG`).not.toContain(c.id);
  await tid(page, 'empty-back').click();

  // Together + Rewatch: at least one of us has seen it; Together + New: neither has.
  const tRew = await togetherDeck(page, { mood: 'laugh', time: 120, novelty: 'rewatch' });
  expect(tRew.length).toBeGreaterThan(2);
  for (const c of tRew) expect([...hgSeen, ...bgSeen], `${c.title}`).toContain(c.id);
  await tid(page, 'session-end').click();
  await tid(page, 'end-confirm').click();
  await expect(tid(page, 'ask')).toBeVisible();
  const tNew = await togetherDeck(page, { mood: 'laugh', time: 120, novelty: 'new' });
  expect(tNew.length).toBeGreaterThan(2);
  for (const c of tNew) expect([...hgSeen, ...bgSeen], `${c.title}`).not.toContain(c.id);
});

test('rule 6: How I Met Your Mother (Hulu with ads + Netflix ad-free) is shown as Netflix, Ad-free', async ({ page }) => {
  await startMemoryPhone(page);
  for (const who of ['HG', 'BG'] as Who[]) {
    await tid(page, 'tab-tonight').click();
    // v2: "Either" leans new and HIMYM is a favourite of both, so ask for Rewatch to make sure it is in the deck.
    await askSolo(page, { who, mood: 'laugh', time: 60, viewing: 'focused', novelty: 'rewatch' });
    const deck = await pageThroughDeck(page);
    const himym = deck.find((c) => c.id === 'tv-1100');
    expect(himym, `HIMYM is in ${who}'s deck`).toBeTruthy();
    expect(himym!.service).toBe('Netflix');
    expect(himym!.adFree).toBe(true);
    expect(himym!.badge.toLowerCase()).toBe('ad-free');
    // Glass Onion is on Netflix ad-free and Netflix-with-ads (not our plan): never shown as ads
    const onion = deck.find((c) => c.id === 'movie-661374');
    if (onion) expect(onion.adFree).toBe(true);
    // Whenever a title is on an ad-free service, no card that has an ad-free home shows Ads: Community is Netflix + Hulu + Peacock
    const community = deck.find((c) => c.id === 'tv-18347');
    if (community) expect([community.service, community.adFree]).toEqual(['Netflix', true]);
    await tid(page, 'empty-back').click();
  }
});
