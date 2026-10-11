/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

export const BASE = '/what-to-watch/';
/** Single-device mode: everything stays in this browser context. */
export const MEM_URL = `${BASE}?catalog=fixture&debug=1&sync=memory`;
/** Real Firebase mode: needed whenever two phones talk to each other. */
export const FB_URL = `${BASE}?catalog=fixture&debug=1&sync=firebase`;

export type Person = 'HG' | 'BG';
export type Who = Person | 'Together';
export type Action = 'yes' | 'not-tonight' | 'seen' | 'save' | 'never';

export const tid = (page: Page, id: string): Locator => page.getByTestId(id);

// ---------------------------------------------------------------------------
// Start-up / pairing
// ---------------------------------------------------------------------------

export interface StartOptions {
  person?: Person;
  /** 'skip' (default) taps Skip on the "what have you seen" grid, 'tick' ticks `tick` ids then Done, 'leave' leaves it open. */
  onboarding?: 'skip' | 'tick' | 'leave';
  tick?: string[];
  /** Pretend "now" is this moment (ISO), so date-based rules (follow-ups: 60 days) do not drift as real time passes. */
  now?: string;
}

/** Fresh single-device (memory) phone, ready on the Ask screen. */
export async function startMemoryPhone(page: Page, opts: StartOptions = {}): Promise<void> {
  const person = opts.person ?? 'HG';
  if (opts.now) await page.clock.setFixedTime(new Date(opts.now));
  await page.goto(MEM_URL);
  await tid(page, `person-${person}`).click();
  await tid(page, 'start-household').click();
  await finishOnboarding(page, opts);
}

export async function finishOnboarding(page: Page, opts: StartOptions = {}): Promise<void> {
  const mode = opts.onboarding ?? 'skip';
  await expect(tid(page, 'onboarding')).toBeVisible();
  if (mode === 'leave') return;
  if (mode === 'tick') {
    for (const id of opts.tick ?? []) await tid(page, `onboard-item-${id}`).click();
    await tid(page, 'onboard-done').click();
  } else {
    await tid(page, 'onboard-skip').click();
  }
  await expect(tid(page, 'ask')).toBeVisible();
}

export async function openTab(page: Page, tab: 'tonight' | 'new' | 'watchlist' | 'matches' | 'history' | 'us'): Promise<void> {
  await tid(page, `tab-${tab}`).click();
}

/** Settings -> "show pairing code" -> returns the code text. */
export async function readPairingCode(page: Page): Promise<string> {
  await openTab(page, 'us');
  await tid(page, 'us-seg-settings').click();
  await tid(page, 'show-pairing-code').click();
  const code = tid(page, 'pairing-code');
  await expect(code).toHaveText(/[A-Z0-9]{6}/, { timeout: 30_000 });
  const text = ((await code.textContent()) ?? '').replace(/\s+/g, '');
  await openTab(page, 'tonight');
  return text;
}

export interface Pair {
  ctxA: BrowserContext;
  ctxB: BrowserContext;
  A: Page; // HG's phone
  B: Page; // BG's phone
  cleanup: () => Promise<void>;
}

/**
 * Two phones = two separate browser contexts (separate storage, separate anonymous users).
 * HG starts the household, BG joins with the pairing code. Both finish with the Ask screen showing.
 */
export async function makePairedPhones(browser: Browser, contextOptions: Record<string, unknown> = {}): Promise<Pair> {
  const ctxA = await browser.newContext(contextOptions);
  const ctxB = await browser.newContext(contextOptions);
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  const cleanup = async () => {
    try {
      await A.evaluate(async () => {
        const w = window as any;
        await Promise.race([w.__wtw?.sync.destroyHousehold?.(), new Promise((r) => setTimeout(r, 15_000))]);
      });
    } catch {
      /* best effort */
    }
    await ctxA.close().catch(() => {});
    await ctxB.close().catch(() => {});
  };
  try {
    await A.goto(FB_URL);
    await tid(A, 'person-HG').click();
    await tid(A, 'start-household').click();
    await finishOnboarding(A);
    const code = await readPairingCode(A);

    await B.goto(FB_URL);
    await tid(B, 'person-BG').click();
    await tid(B, 'have-code').click();
    await tid(B, 'code-input').fill(code);
    await tid(B, 'code-submit').click();
    await finishOnboarding(B);
  } catch (e) {
    await cleanup();
    throw e;
  }
  return { ctxA, ctxB, A, B, cleanup };
}

// ---------------------------------------------------------------------------
// Ask screen
// ---------------------------------------------------------------------------

export interface AskOptions {
  who?: Who;
  viewing?: 'focused' | 'background' | 'eating';
  mood?: string;
  time?: 20 | 45 | 60 | 120 | 'any';
  novelty?: 'new' | 'rewatch' | 'either';
  genre?: string | null;
}

/** Tap the chosen chips (anything left undefined keeps its default). Does not submit. */
export async function fillAsk(page: Page, o: AskOptions = {}): Promise<void> {
  if (o.who) await tid(page, `ask-who-${o.who}`).click();
  if (o.viewing) await tid(page, `ask-viewing-${o.viewing}`).click();
  if (o.mood) await tid(page, `ask-mood-${o.mood}`).click();
  if (o.time) await tid(page, `ask-time-${o.time}`).click();
  if (o.novelty) await tid(page, `ask-novelty-${o.novelty}`).click();
  if (o.genre !== undefined) await tid(page, o.genre === null ? 'ask-genre-any' : `ask-genre-${o.genre}`).click();
}

/** Fill the Ask screen and press "Show me" (solo). Resolves when the deck (or empty-deck) is on screen. */
export async function askSolo(page: Page, o: AskOptions = {}): Promise<void> {
  await expect(tid(page, 'ask')).toBeVisible();
  await fillAsk(page, o);
  await tid(page, 'ask-submit').click();
  await expect(tid(page, 'card').or(tid(page, 'empty-deck'))).toBeVisible();
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface CardInfo {
  id: string;
  title: string;
  year: string;
  minutes: string;
  service: string;
  adFree: boolean | null;
  badge: string;
  pick: string;
}

/** Read everything the current top card shows. */
export async function readCard(page: Page): Promise<CardInfo> {
  const card = tid(page, 'card');
  await expect(card).toBeVisible();
  return card.evaluate((el): CardInfo => {
    const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const badge = q('card-ad-badge');
    return {
      id: el.getAttribute('data-item-id') ?? '',
      title: q('card-title')?.textContent?.trim() ?? '',
      year: q('card-year')?.textContent?.trim() ?? '',
      minutes: q('card-minutes')?.textContent?.trim() ?? '',
      service: q('card-service')?.textContent?.trim() ?? '',
      adFree: badge ? badge.getAttribute('data-adfree') === 'true' : null,
      badge: badge?.textContent?.trim() ?? '',
      pick: q('card-pick')?.textContent?.trim() ?? '',
    };
  });
}

export async function currentCardId(page: Page): Promise<string | null> {
  // The card can leave the page between looking and reading, so never wait long for it.
  return tid(page, 'card').getAttribute('data-item-id', { timeout: 2000 }).catch(() => null);
}

/** "22 min" / "1h 5m" / "2h" -> minutes. */
export function parseMinutes(text: string): number {
  const h = /(\d+)\s*h/.exec(text);
  const m = /(\d+)\s*(?:min|m)\b/.exec(text);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/** Click a card button. Under heavy machine load Playwright sometimes never sees the button as "stable" while cards animate; fall back to a forced click. */
async function press(page: Page, id: string): Promise<void> {
  try {
    await tid(page, id).click({ timeout: 5000 });
  } catch {
    await tid(page, id).click({ force: true });
  }
}

async function gone(page: Page, id: string | null): Promise<void> {
  if (id) await expect(page.locator(`[data-testid="card"][data-item-id="${id}"]`)).toHaveCount(0);
}

/** Press a card button and wait for that card to leave the screen. */
export async function act(page: Page, action: 'yes' | 'not-tonight' | 'seen'): Promise<void> {
  const id = await currentCardId(page);
  await press(page, `action-${action}`);
  await gone(page, id);
}

export async function saveCard(page: Page, list: 'HG' | 'BG' | 'ours'): Promise<void> {
  const id = await currentCardId(page);
  await tid(page, 'action-save').click();
  await tid(page, `save-option-${list}`).click();
  await gone(page, id);
}

export async function neverCard(page: Page): Promise<void> {
  const id = await currentCardId(page);
  await tid(page, 'action-never').click();
  await tid(page, 'never-confirm').click();
  await gone(page, id);
}

/** A real touch-style drag on the current card (mouse events, which the deck turns into pointer events). */
export async function swipeCard(page: Page, dir: 'right' | 'left'): Promise<void> {
  const id = await currentCardId(page);
  const box = await tid(page, 'card').boundingBox();
  if (!box) throw new Error('no card to swipe');
  const y = box.y + box.height * 0.35;
  const x0 = box.x + box.width / 2;
  const dx = (dir === 'right' ? 1 : -1) * box.width * 0.6;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 + dx * 0.3, y, { steps: 4 });
  await page.mouse.move(x0 + dx, y, { steps: 8 });
  await page.mouse.up();
  await gone(page, id);
}

/** Walk through a whole deck pressing `action` on every card (default Not tonight); returns what each card showed. */
export async function pageThroughDeck(page: Page, action: 'not-tonight' | 'seen' = 'not-tonight', max = 80): Promise<CardInfo[]> {
  const out: CardInfo[] = [];
  for (let i = 0; i < max; i++) {
    const end = tid(page, 'empty-deck').or(tid(page, 'session-deck-done'));
    await expect(tid(page, 'card').or(end)).toBeVisible();
    if ((await end.count()) > 0) break;
    out.push(await readCard(page));
    await act(page, action);
  }
  return out;
}

/** Walk the deck (Not tonight on each) until a card matching `want` shows; null if the deck ran out. */
export async function findCard(page: Page, want: (c: CardInfo) => boolean, max = 80): Promise<CardInfo | null> {
  for (let i = 0; i < max; i++) {
    const end = tid(page, 'empty-deck').or(tid(page, 'session-deck-done'));
    await expect(tid(page, 'card').or(end)).toBeVisible();
    if ((await end.count()) > 0) return null;
    const c = await readCard(page);
    if (want(c)) return c;
    await act(page, 'not-tonight');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Debug hook: look at state / ask the engine directly (window.__wtw, enabled by ?debug=1)
// ---------------------------------------------------------------------------

/** Run `fn` inside the page with the live services as first argument. */
export async function wtw<T, A = undefined>(page: Page, fn: (w: any, arg: A) => T | Promise<T>, arg?: A): Promise<T> {
  // The app installs the debug hook just after its first render; right after a reload it may not be there yet.
  await page.waitForFunction(() => (window as any).__wtw != null, null, { timeout: 30_000 });
  return page.evaluate(
    ({ src, a }) => {
      const f = new Function('w', 'a', `return (${src})(w, a);`);
      return f((window as any).__wtw, a);
    },
    { src: fn.toString(), a: arg },
  ) as Promise<T>;
}

/** Mark titles watched for a person through the sync layer (what "I watched this" does under the hood). */
export async function markWatched(page: Page, person: Person, ids: string[], source: 'manual' | 'import' | 'onboarding' = 'manual', at?: number): Promise<void> {
  await wtw(
    page,
    async (w, a) => {
      const rows: Record<string, any> = {};
      for (const i of w.catalog.items) rows[i.id] = i;
      await w.sync.markWatched(
        a.person,
        a.ids.map((id: string) => ({
          itemId: id,
          source: a.source,
          ...(a.at ? { at: a.at } : {}),
          snapshot: { title: rows[id]?.title ?? id, year: rows[id]?.year ?? 2000, poster: null },
        })),
      );
    },
    { person, ids, source, at },
  );
}

export async function sharedState(page: Page): Promise<any> {
  return wtw(page, (w) => JSON.parse(JSON.stringify(w.sync.getState())));
}

// ---------------------------------------------------------------------------
// Layout checks
// ---------------------------------------------------------------------------

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    bw: document.body.scrollWidth,
  }));
  expect(r.sw, 'page is wider than the screen').toBeLessThanOrEqual(r.cw + 1);
  expect(r.bw, 'body is wider than the screen').toBeLessThanOrEqual(r.cw + 1);
}

export async function expectInViewport(page: Page, locator: Locator, name: string): Promise<void> {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  expect(box, `${name} has no box`).not.toBeNull();
  expect(box!.x, `${name} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.y, `${name} top edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${name} right edge`).toBeLessThanOrEqual(vp!.width + 1);
  expect(box!.y + box!.height, `${name} bottom edge`).toBeLessThanOrEqual(vp!.height + 1);
}

// ---------------------------------------------------------------------------
// Engine queries through the debug hook (what the engine itself would return right now)
// ---------------------------------------------------------------------------

export interface Req {
  who: Who;
  viewing: 'focused' | 'background' | 'eating';
  mood: string;
  time: 20 | 45 | 60 | 120 | 'any';
  novelty: 'new' | 'rewatch' | 'either';
  genre: string | null;
}
export const REQ: Req = { who: 'HG', viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either', genre: null };

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface EngineCard {
  id: string;
  service: string;
  adFree: boolean;
  minutes: number;
  pick: { type: string };
}

/** The full deck the engine builds right now for this request (up to 500 cards). */
export async function engineDeck(page: Page, req: Req, today: string = todayLocal()): Promise<EngineCard[]> {
  return wtw(
    page,
    (w, a) => {
      const ctx = { catalog: w.catalog, state: w.sync.getState(), today: a.today };
      return w.engine.buildDeck(a.req, ctx, { limit: 500 }).map((c: any) => ({
        id: c.itemId,
        service: c.service.serviceId,
        adFree: c.service.adFree,
        minutes: c.minutes,
        pick: c.pick,
      }));
    },
    { req, today },
  );
}

export interface CatalogRow {
  id: string;
  title: string;
  attention: 'low' | 'medium' | 'high';
  runtime: number;
  flags: { horror: boolean; trueCrime: boolean; scary: boolean };
}
export async function catalogRows(page: Page): Promise<Record<string, CatalogRow>> {
  return wtw(page, (w) => {
    const out: Record<string, any> = {};
    for (const i of w.catalog.items) out[i.id] = { id: i.id, title: i.title, attention: i.attention, runtime: i.runtime, flags: i.flags };
    return out;
  });
}

export const OFF_PLAN = ['tv-120998', 'tv-117488']; // Poker Face (Peacock Premium Plus), Yellowjackets (Paramount+ Premium)
export const SCARY_TITLES = ['movie-419430', 'tv-72844', 'tv-66732', 'tv-70523', 'tv-64439', 'tv-4601']; // Get Out, Hill House, Stranger Things, Dark, Making a Murderer, Dateline
export const HIGH_ATTENTION = ['tv-1399', 'tv-70523', 'tv-76331', 'movie-27205']; // GoT, Dark, Succession, Inception
