/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { FIXTURE_FAVORITES, FIXTURE_PLANS } from '../../../src/contracts/fixtures/catalog';

export const BASE = '/pick-tonight/';
/** Single-device mode: everything stays in this browser context. */
export const MEM_URL = `${BASE}?catalog=fixture&debug=1&sync=memory`;
/** Real Firebase mode: needed whenever two phones talk to each other. */
export const FB_URL = `${BASE}?catalog=fixture&debug=1`;

export type Action = 'yes' | 'not-tonight' | 'seen' | 'save' | 'never';
export type Sample = 'alex' | 'sam' | 'kit';

export const tid = (page: Page, id: string): Locator => page.getByTestId(id);

// ---------------------------------------------------------------------------
// Debug hook: look at state / drive the live services (window.__wtw, enabled by ?debug=1)
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

export async function sharedState(page: Page): Promise<any> {
  return wtw(page, (w) => JSON.parse(JSON.stringify(w.sync.getState())));
}
export async function myId(page: Page): Promise<string> {
  return wtw(page, (w) => w.sync.getDevice().memberId);
}
export async function memberIds(page: Page): Promise<Record<string, string>> {
  return wtw(page, (w) => {
    const out: Record<string, string> = {};
    for (const m of Object.values<any>(w.sync.getState().members)) out[m.name] = m.id;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Start-up / first run
// ---------------------------------------------------------------------------

/** Open the app in a browser tab and get past the "add to Home Screen" guidance. Ends on the create-or-join screen. */
export async function openApp(page: Page, url: string = MEM_URL): Promise<void> {
  await page.goto(url);
  await expect(tid(page, 'welcome').or(tid(page, 'setup')).or(tid(page, 'invite-preview')).or(tid(page, 'tabbar'))).toBeVisible({ timeout: 30_000 });
  if (await tid(page, 'welcome').isVisible()) await tid(page, 'continue-in-browser').click();
}

export type ServiceSpec = string | [string, string];
export const DEFAULT_SERVICES: ServiceSpec[] = [['netflix', 'standard']];

export interface CreateOpts {
  name: string;
  services?: ServiceSpec[];
  /** Title search words; the first usable result for each is added as a favourite. */
  favourites?: string[];
  never?: { toggles?: ('horror' | 'trueCrime' | 'scary' | 'subtitled')[]; genres?: string[] };
  /** Tick this many posters on the seen grid. */
  seen?: number;
  /** Skip every optional step (default true unless favourites/never/seen are given). */
  skipAll?: boolean;
  /** Stop after the services step is accepted (on the favourites step). */
  stopAtFavourites?: boolean;
  /** Stay on the final "You're all set" screen. */
  stopAtDone?: boolean;
}

export async function pickServices(page: Page, services: ServiceSpec[]): Promise<void> {
  for (const s of services) {
    const [id, plan] = Array.isArray(s) ? s : [s, undefined];
    await tid(page, `service-toggle-${id}`).scrollIntoViewIfNeeded();
    await tid(page, `service-toggle-${id}`).click();
    if (plan) {
      const p = tid(page, `plan-${id}-${plan}`);
      if (await p.count()) await p.click();
    }
  }
}

export async function addFavourite(page: Page, query: string): Promise<string> {
  await tid(page, 'fav-search').fill(query);
  const words = query.trim().split(/\s+/).map((w) => w.replace(/[^\w]/g, '')).filter(Boolean);
  // results lag the typing a little: only take one that matches what was typed
  const result = page
    .locator('[data-testid="fav-result"][data-added="false"]')
    .filter({ hasText: new RegExp(words.join('.*'), 'i') })
    .first();
  await expect(result).toBeVisible();
  const id = (await result.getAttribute('data-item-id'))!;
  await result.click();
  await expect(page.locator(`[data-testid="fav-chip"][data-item-id="${id}"]`)).toHaveCount(1);
  return id;
}

/** Start a household through the real screens. Ends on the Ask screen (or on the step named by stop*). */
export async function createHousehold(page: Page, o: CreateOpts, startUrl: string = MEM_URL): Promise<void> {
  await openApp(page, startUrl);
  await tid(page, 'start-household').click();
  await tid(page, 'name-input').fill(o.name);
  await tid(page, 'wizard-next').click();
  await expect(tid(page, 'setup-services')).toBeVisible();
  await pickServices(page, o.services ?? DEFAULT_SERVICES);
  await tid(page, 'wizard-next').click();
  await expect(tid(page, 'wizard-favorites')).toBeVisible({ timeout: 30_000 });
  if (o.stopAtFavourites) return;
  const skipAll = o.skipAll ?? !(o.favourites?.length || o.never || o.seen);
  if (skipAll) {
    for (const step of ['wizard-favorites', 'wizard-never', 'wizard-import', 'wizard-seen']) {
      await expect(tid(page, step)).toBeVisible();
      await tid(page, 'wizard-skip').click();
    }
  } else {
    for (const q of o.favourites ?? []) await addFavourite(page, q);
    await tid(page, 'wizard-next').click();
    await expect(tid(page, 'wizard-never')).toBeVisible();
    for (const t of o.never?.toggles ?? []) await tid(page, `dealbreaker-${t}`).click();
    for (const g of o.never?.genres ?? []) await tid(page, `dealbreaker-genre-${g}`).click();
    await tid(page, 'wizard-next').click();
    await expect(tid(page, 'wizard-import')).toBeVisible();
    await tid(page, 'wizard-skip').click();
    await expect(tid(page, 'wizard-seen')).toBeVisible();
    const tiles = page.locator('[data-testid^="onboard-item-"]');
    await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < (o.seen ?? 0); i++) await tiles.nth(i).click();
    await tid(page, 'wizard-next').click();
  }
  await expect(tid(page, 'wizard-done')).toBeVisible();
  if (o.stopAtDone) return;
  await tid(page, 'wizard-finish').click();
  await expect(tid(page, 'tabbar')).toBeVisible();
  await expect(tid(page, 'ask')).toBeVisible();
}

export interface MemberSpec {
  name: string;
  /** Which sample person's favourites to copy (see the fixture), or none. */
  like?: Sample;
  dealbreakers?: Partial<{ horror: boolean; trueCrime: boolean; scary: boolean; subtitled: boolean; genres: string[] }>;
  /** Fixture favourite ids to give instead of a sample person's list. */
  favorites?: string[];
}

export const SAM_NEVER = { horror: true, trueCrime: true, scary: true };

/** Change a member's profile directly (memory mode only; the rules tests need exact tastes). */
export async function setProfile(page: Page, memberId: string, patch: { favorites?: any[]; dealbreakers?: any }): Promise<void> {
  await wtw(
    page,
    async (w, a) => {
      const cur = w.sync.getState().profiles[a.id];
      await w.sync.saveProfile({
        ...cur,
        ...(a.patch.favorites ? { favorites: a.patch.favorites } : {}),
        ...(a.patch.dealbreakers ? { dealbreakers: { ...cur.dealbreakers, ...a.patch.dealbreakers } } : {}),
        onboarded: true,
      });
    },
    { id: memberId, patch },
  );
}

export async function setPlans(page: Page, plans: Record<string, string | null>): Promise<void> {
  await wtw(page, async (w, p) => w.sync.saveSettings({ ...w.sync.getState().settings, plans: p }), plans);
}

export interface Household {
  /** name -> member id */
  ids: Record<string, string>;
  /** First member's id (the one who created it; this device starts as them). */
  first: string;
  /** Make this device act as the named member. */
  actAs: (name: string) => Promise<void>;
}

/**
 * Memory mode: a household with the sample plans (six services) and the given members. The first member is created through the real
 * screens (name + Netflix only, everything else skipped); the rest are added with the debug helper. Profiles are then set exactly.
 */
export async function quickHousehold(page: Page, members: MemberSpec[], opts: { plans?: Record<string, string | null> | null; url?: string; now?: string } = {}): Promise<Household> {
  if (opts.now) await page.clock.setFixedTime(new Date(opts.now));
  await createHousehold(page, { name: members[0].name }, opts.url ?? MEM_URL);
  if (opts.plans !== null) await setPlans(page, opts.plans ?? (FIXTURE_PLANS as Record<string, string>));
  const ids: Record<string, string> = {};
  ids[members[0].name] = await myId(page);
  for (const m of members.slice(1)) {
    ids[m.name] = await wtw(page, async (w, name) => w.sync.debugAddMember(name, { ...w.engine.emptyProfile(), onboarded: true }), m.name);
  }
  for (const m of members) {
    const favorites = m.favorites
      ? await wtw(
          page,
          async (w, list) => {
            const idx = await w.loadTitleIndex();
            return list.map((id: string) => {
              const t = idx.titles.find((x: any) => x.id === id);
              return { id: t.id, kind: t.kind, title: t.title, year: t.year, genres: t.genres, keywords: t.keywords, poster: null };
            });
          },
          m.favorites,
        )
      : m.like
        ? FIXTURE_FAVORITES[m.like]
        : undefined;
    if (favorites || m.dealbreakers) await setProfile(page, ids[m.name], { favorites, dealbreakers: m.dealbreakers });
  }
  const actAs = async (name: string) => {
    await wtw(page, (w, id) => w.sync.debugActAs(id), ids[name]);
  };
  return { ids, first: ids[members[0].name], actAs };
}

/** The sample household: Alex (comedy fan), Sam (never scary things), Kit (brand new). */
export const SAMPLE: MemberSpec[] = [
  { name: 'Alex', like: 'alex' },
  { name: 'Sam', like: 'sam', dealbreakers: SAM_NEVER },
  { name: 'Kit' },
];

export async function openTab(page: Page, tab: 'tonight' | 'new' | 'watchlist' | 'matches' | 'history' | 'us'): Promise<void> {
  await tid(page, `tab-${tab}`).click();
}

export async function openSettings(page: Page): Promise<void> {
  await openTab(page, 'us');
  await tid(page, 'us-seg-settings').click();
  await expect(tid(page, 'settings')).toBeVisible();
}

export async function openProfile(page: Page, memberId: string): Promise<void> {
  await openTab(page, 'us');
  await tid(page, `us-seg-${memberId}`).click();
  await expect(tid(page, `profile-${memberId}`)).toBeVisible();
}

// ---------------------------------------------------------------------------
// Ask screen
// ---------------------------------------------------------------------------

export interface AskOptions {
  /** Member ids that should be selected (omit for "just me"). */
  who?: string[];
  viewing?: 'focused' | 'background' | 'eating';
  mood?: string;
  time?: 20 | 45 | 60 | 120 | 'any';
  novelty?: 'new' | 'rewatch' | 'either';
  genre?: string | null;
}

/** Tap the who chips until exactly `ids` are selected. */
export async function setWho(page: Page, ids: string[]): Promise<void> {
  const chips = page.locator('[data-testid^="who-"]:not([data-testid="who-everyone"]):not([data-testid="who-picker"])');
  const all = await chips.evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid')!.slice(4), on: e.getAttribute('data-selected') === 'true' })));
  for (const c of all) if (ids.includes(c.id) && !c.on) await tid(page, `who-${c.id}`).click();
  for (const c of all) if (!ids.includes(c.id) && c.on) await tid(page, `who-${c.id}`).click();
  for (const id of ids) await expect(tid(page, `who-${id}`)).toHaveAttribute('data-selected', 'true');
}

/** Tap the chosen chips (anything left undefined keeps its default). Does not submit. */
export async function fillAsk(page: Page, o: AskOptions = {}): Promise<void> {
  if (o.who) await setWho(page, o.who);
  if (o.viewing) await tid(page, `ask-viewing-${o.viewing}`).click();
  if (o.mood) await tid(page, `ask-mood-${o.mood}`).click();
  if (o.time) await tid(page, `ask-time-${o.time}`).click();
  if (o.novelty) await tid(page, `ask-novelty-${o.novelty}`).click();
  if (o.genre !== undefined) await tid(page, o.genre === null ? 'ask-genre-any' : `ask-genre-${o.genre}`).click();
}

/** Fill the Ask screen and press the main button. Resolves when a deck (solo or together) or an empty deck is on screen. */
export async function ask(page: Page, o: AskOptions = {}): Promise<void> {
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

export async function saveCard(page: Page, list?: string): Promise<void> {
  const id = await currentCardId(page);
  await tid(page, 'action-save').click();
  if (list) await tid(page, `save-option-${list}`).click();
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

const DECK_END = (page: Page) => tid(page, 'empty-deck').or(tid(page, 'session-deck-done'));

/** Walk through a whole deck pressing `action` on every card (default Not tonight); returns what each card showed. */
export async function pageThroughDeck(page: Page, action: 'not-tonight' | 'seen' = 'not-tonight', max = 90): Promise<CardInfo[]> {
  const out: CardInfo[] = [];
  for (let i = 0; i < max; i++) {
    const end = DECK_END(page);
    await expect(tid(page, 'card').or(end)).toBeVisible();
    if ((await end.count()) > 0) break;
    out.push(await readCard(page));
    await act(page, action);
  }
  return out;
}

/** Walk the deck (Not tonight on each) until a card matching `want` shows; null if the deck ran out. */
export async function findCard(page: Page, want: (c: CardInfo) => boolean, max = 90): Promise<CardInfo | null> {
  for (let i = 0; i < max; i++) {
    const end = DECK_END(page);
    await expect(tid(page, 'card').or(end)).toBeVisible();
    if ((await end.count()) > 0) return null;
    const c = await readCard(page);
    if (want(c)) return c;
    await act(page, 'not-tonight');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Together sessions on one device (memory mode): the other members are simulated with debugActAs
// ---------------------------------------------------------------------------

/** Wait for a swipe to be saved (it saves after its exit animation). */
export const settle = (page: Page) => page.waitForTimeout(700);

/** As the current member, start a Together session for `who` (member ids, including this member). */
export async function startTogether(page: Page, who: string[], o: AskOptions = {}): Promise<void> {
  await openTab(page, 'tonight');
  await ask(page, { time: 120, ...o, who });
  await expect(tid(page, 'session-deck')).toBeVisible();
}

/** Switch to another simulated member, join the open session and wait for their first card. */
export async function joinAs(page: Page, h: Household, name: string): Promise<void> {
  await h.actAs(name);
  await tid(page, 'join-button').click();
  await expect(tid(page, 'session-deck')).toBeVisible();
  await expect(tid(page, 'card')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Engine queries through the debug hook (what the engine itself would return right now)
// ---------------------------------------------------------------------------

export interface Req {
  who: string[];
  viewing: 'focused' | 'background' | 'eating';
  mood: string;
  time: 20 | 45 | 60 | 120 | 'any';
  novelty: 'new' | 'rewatch' | 'either';
  genre: string | null;
}
export const REQ = { viewing: 'focused', mood: 'laugh', time: 120, novelty: 'either', genre: null } as const;
export const request = (who: string[], o: Partial<Omit<Req, 'who'>> = {}): Req => ({ ...(REQ as any), ...o, who });

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
      const ctx = { catalog: w.catalogs.get().catalog, state: w.sync.getState(), today: a.today };
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

export async function availableMoods(page: Page, who: string[]): Promise<string[]> {
  return wtw(page, (w, ids) => w.engine.availableMoods(ids, { catalog: w.catalogs.get().catalog, state: w.sync.getState(), today: '2026-10-11' }), who);
}

export interface CatalogRow {
  id: string;
  title: string;
  attention: 'low' | 'medium' | 'high';
  runtime: number;
  lang: string;
  genres: string[];
  flags: { horror: boolean; trueCrime: boolean; scary: boolean };
  providers: number[];
}
export async function catalogRows(page: Page): Promise<Record<string, CatalogRow>> {
  return wtw(page, (w) => {
    const out: Record<string, any> = {};
    for (const i of w.catalogs.get().catalog.items) {
      out[i.id] = { id: i.id, title: i.title, attention: i.attention, runtime: i.runtime, lang: i.lang, genres: i.genres, flags: i.flags, providers: i.providers };
    }
    return out;
  });
}

/** Mark titles watched for a member through the sync layer (what "I watched this" does under the hood). */
export async function markWatched(page: Page, memberId: string, ids: string[], source: 'manual' | 'import' | 'onboarding' = 'manual', at?: number): Promise<void> {
  await wtw(
    page,
    async (w, a) => {
      const rows: Record<string, any> = {};
      for (const i of w.catalogs.get().catalog.items) rows[i.id] = i;
      await w.sync.markWatched(
        a.memberId,
        a.ids.map((id: string) => ({
          itemId: id,
          source: a.source,
          ...(a.at ? { at: a.at } : {}),
          snapshot: { title: rows[id]?.title ?? id, year: rows[id]?.year ?? 2000, poster: null },
        })),
      );
    },
    { memberId, ids, source, at },
  );
}

// Fixture titles the rules tests refer to.
export const OFF_PLAN = ['tv-120998', 'tv-117488']; // Poker Face (Peacock Premium Plus), Yellowjackets (Paramount+ Premium)
export const SCARY_TITLES = ['movie-419430', 'tv-72844', 'tv-66732', 'tv-70523', 'tv-64439', 'tv-4601']; // Get Out, Hill House, Stranger Things, Dark, Making a Murderer, Dateline
export const HIGH_ATTENTION = ['tv-1399', 'tv-70523', 'tv-76331', 'movie-27205']; // GoT, Dark, Succession, Inception

// ---------------------------------------------------------------------------
// Layout checks
// ---------------------------------------------------------------------------

export async function expectNoHorizontalScroll(page: Page, label = 'page'): Promise<void> {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    bw: document.body.scrollWidth,
  }));
  expect(r.sw, `${label} is wider than the screen`).toBeLessThanOrEqual(r.cw + 1);
  expect(r.bw, `${label} body is wider than the screen`).toBeLessThanOrEqual(r.cw + 1);
}

export async function expectInViewport(page: Page, locator: Locator, name: string): Promise<void> {
  const vp = page.viewportSize()!;
  // sheets slide in: give them a moment to settle
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        if (!box) return 'no box';
        if (box.x < -1) return `left edge ${box.x}`;
        if (box.y < -1) return `top edge ${box.y}`;
        if (box.x + box.width > vp.width + 1) return `right edge ${box.x + box.width} > ${vp.width}`;
        if (box.y + box.height > vp.height + 1) return `bottom edge ${box.y + box.height} > ${vp.height}`;
        return 'ok';
      },
      { message: `${name} is not fully on screen`, timeout: 4000 },
    )
    .toBe('ok');
}

/** Text inside `locator` must not be clipped sideways (every descendant stays inside the viewport width). */
export async function expectNothingClippedSideways(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && cs.visibility === 'hidden') continue;
      if (el.closest('.confetti')) continue; // decorative falling bits
      // Elements inside a horizontally scrolling strip are meant to extend past the edge.
      let p: HTMLElement | null = el.parentElement;
      let inStrip = false;
      while (p) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) {
          inStrip = true;
          break;
        }
        p = p.parentElement;
      }
      if (inStrip) continue;
      // text cut off with an ellipsis inside a box that is itself on screen is fine
      let q: HTMLElement | null = el.parentElement;
      let clippedByBox = false;
      while (q && q !== document.body) {
        const o = getComputedStyle(q).overflowX;
        const qr = q.getBoundingClientRect();
        if ((o === 'hidden' || o === 'clip') && qr.left >= -1 && qr.right <= w + 1) {
          clippedByBox = true;
          break;
        }
        q = q.parentElement;
      }
      if (clippedByBox) continue;
      if (r.left < -1 || r.right > w + 1) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? el.className}] ${Math.round(r.left)}..${Math.round(r.right)} of ${w}`);
    }
    return out.slice(0, 5);
  });
  expect(bad, `${label}: things stick out sideways`).toEqual([]);
}

/** Screenshot into the git-ignored test-results/screens folder, and check the page does not scroll sideways. */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  await expectNoHorizontalScroll(page, name);
  await page.screenshot({ path: `${process.cwd()}/test-results/screens/${name}.png`, fullPage: opts.fullPage ?? false });
}

// ---------------------------------------------------------------------------
// Real Firebase: separate browser contexts are separate phones
// ---------------------------------------------------------------------------

export function phoneOptions(testInfo: TestInfo, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const u = testInfo.project.use;
  return {
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    serviceWorkers: 'block',
    baseURL: u.baseURL ?? 'http://localhost:4173',
    ...extra,
  };
}

export interface Phone {
  ctx: BrowserContext;
  page: Page;
}

export async function newPhone(browser: Browser, testInfo: TestInfo): Promise<Phone> {
  const ctx = await browser.newContext(phoneOptions(testInfo));
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Make an invite on a paired phone through the Settings screen; returns the link and the bare code. */
export async function makeInvite(page: Page): Promise<{ link: string; code: string }> {
  await openSettings(page);
  if ((await tid(page, 'invite-code').count()) === 0) await tid(page, 'invite-make').click();
  await expect(tid(page, 'invite-code')).toHaveText(/[A-Z0-9]{3}\s?[A-Z0-9]{3}/, { timeout: 30_000 });
  const code = ((await tid(page, 'invite-code').textContent()) ?? '').replace(/\s+/g, '');
  const link = ((await tid(page, 'invite-link').textContent()) ?? '').trim();
  await tid(page, 'invite-hide').click();
  await openTab(page, 'tonight');
  return { link, code };
}

/** The link from the invite screen, opened on the fixture catalog with the debug hook on. */
export const withDebug = (link: string): string => `${link}${link.includes('?') ? '&' : '?'}catalog=fixture&debug=1`;

/** A new phone opens an invite link and gets as far as the "Join <names>" screen. */
export async function openInvite(page: Page, link: string): Promise<void> {
  await page.goto(withDebug(link));
  await expect(tid(page, 'welcome').or(tid(page, 'invite-preview'))).toBeVisible({ timeout: 30_000 });
  if (await tid(page, 'welcome').isVisible()) await tid(page, 'continue-in-browser').click();
  await expect(tid(page, 'invite-preview')).toBeVisible();
  await expect(tid(page, 'invite-loading')).toHaveCount(0, { timeout: 60_000 });
}

/** Join as a new member from the invite preview, skip the optional steps, land on the Ask screen. */
export async function joinAsNew(page: Page, name: string): Promise<void> {
  await tid(page, 'join-new').click({ timeout: 60_000 });
  await tid(page, 'name-input').fill(name);
  await tid(page, 'wizard-next').click();
  await expect(tid(page, 'wizard-favorites')).toBeVisible({ timeout: 90_000 });
  for (const step of ['wizard-favorites', 'wizard-never', 'wizard-import', 'wizard-seen']) {
    await expect(tid(page, step)).toBeVisible();
    await tid(page, 'wizard-skip').click();
  }
  await expect(tid(page, 'wizard-done')).toBeVisible();
  await tid(page, 'wizard-finish').click();
  await expect(tid(page, 'ask')).toBeVisible();
}

/** Re-claim an existing member from the invite preview. */
export async function joinAsExisting(page: Page, name: string): Promise<void> {
  await tid(page, 'join-existing').click();
  await page.locator('[data-testid^="existing-"][data-member-id]', { hasText: name }).first().click();
  await expect(tid(page, 'existing-warning')).toBeVisible();
  await tid(page, 'existing-confirm').click();
  await expect(tid(page, 'tabbar')).toBeVisible({ timeout: 45_000 });
}

export interface Group {
  phones: Phone[];
  pages: Page[];
  /** name -> member id (read from the first phone once everyone is in) */
  ids: Record<string, string>;
  cleanup: () => Promise<void>;
}

/**
 * Real Firebase: the first phone creates a household (Netflix + the other sample services), the others join by invite link.
 * Everybody ends on the Ask screen. `cleanup()` deletes the household from the first phone that still belongs to it.
 */
export async function makeGroup(browser: Browser, testInfo: TestInfo, names: string[]): Promise<Group> {
  const phones: Phone[] = [];
  const cleanup = async () => {
    for (const p of phones) {
      try {
        const ok = await p.page.evaluate(async () => {
          const w = (window as any).__wtw;
          if (!w || w.sync.getDevice().status !== 'paired') return false;
          await Promise.race([w.sync.deleteHousehold(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20_000))]);
          return true;
        });
        if (ok) break;
      } catch {
        /* try the next phone */
      }
    }
    for (const p of phones) await p.ctx.close().catch(() => {});
  };
  try {
    const first = await newPhone(browser, testInfo);
    phones.push(first);
    await createHousehold(first.page, { name: names[0] }, FB_URL);
    await setPlans(first.page, FIXTURE_PLANS as Record<string, string>);
    for (const name of names.slice(1)) {
      const { link } = await makeInvite(first.page);
      const p = await newPhone(browser, testInfo);
      phones.push(p);
      await openInvite(p.page, link);
      await joinAsNew(p.page, name);
    }
    for (const p of phones) await expect(p.page.getByTestId('tabbar')).toBeVisible();
    const ids = await memberIds(first.page);
    // everyone sees everyone
    for (const p of phones) await expect.poll(async () => Object.keys(await memberIds(p.page)).length, { timeout: 45_000 }).toBe(names.length);
    return { phones, pages: phones.map((p) => p.page), ids, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** Is anonymous sign-in on for the Firebase project? Fails the Firebase tests with a clear message if not. */
export async function firebaseSignInAvailable(): Promise<boolean> {
  try {
    const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'firebase.web-config.json'), 'utf8'));
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    const body: any = await res.json();
    // Only "admin only" means the switch is off; a rate-limit or network blip must not be mistaken for it.
    return !(body?.error?.message ?? '').includes('ADMIN_ONLY_OPERATION');
  } catch {
    return true;
  }
}

/** Go to the Tonight tab and back to the questions, whatever deck (or none) is open. */
export async function toAsk(page: Page): Promise<void> {
  await openTab(page, 'tonight');
  await expect(tid(page, 'ask').or(tid(page, 'solo-deck')).or(tid(page, 'session-deck'))).toBeVisible();
  if (await tid(page, 'ask').count()) return;
  if (await tid(page, 'deck-back').count()) await tid(page, 'deck-back').click();
  else if (await tid(page, 'session-back').count()) await tid(page, 'session-back').click();
  await expect(tid(page, 'ask')).toBeVisible();
}

/** Several engine decks in one round trip. */
export async function engineDecks(page: Page, reqs: Req[], today: string = todayLocal()): Promise<EngineCard[][]> {
  return wtw(
    page,
    (w, a) => {
      const ctx = { catalog: w.catalogs.get().catalog, state: w.sync.getState(), today: a.today };
      return a.reqs.map((req: any) =>
        w.engine.buildDeck(req, ctx, { limit: 500 }).map((c: any) => ({
          id: c.itemId,
          service: c.service.serviceId,
          adFree: c.service.adFree,
          minutes: c.minutes,
          pick: c.pick,
        })),
      );
    },
    { reqs, today },
  );
}

/** Who has seen what, according to the engine (favourites count as seen). */
export async function seenBy(page: Page, ids: string[]): Promise<Record<string, Set<string>>> {
  const raw = await wtw(
    page,
    (w, members) => {
      const ctx = { catalog: w.catalogs.get().catalog, state: w.sync.getState(), today: '2026-10-11' };
      const out: Record<string, string[]> = {};
      for (const m of members) out[m] = w.catalogs.get().catalog.items.filter((i: any) => w.engine.hasSeen(m, i.id, ctx)).map((i: any) => i.id);
      return out;
    },
    ids,
  );
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, new Set(v)]));
}

/** Every non-empty subset of the given ids. */
export function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)));
  return out;
}

// ---------------------------------------------------------------------------
// Raw access to the real Firebase project over its public REST interface, with the SAME rules a phone is subject to.
// Used to prove isolation and deletion without going through the app.
// ---------------------------------------------------------------------------

async function webConfig(): Promise<{ apiKey: string; projectId: string }> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return JSON.parse(readFileSync(join(process.cwd(), 'firebase.web-config.json'), 'utf8'));
}

/** The id token of the anonymous user a phone (page) is signed in as, read from the page's own browser storage. */
export async function idToken(page: Page): Promise<string> {
  const token = await page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('firebaseLocalStorageDb');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          try {
            const db = open.result;
            const req = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll();
            req.onsuccess = () => {
              const row = (req.result as any[]).find((r) => String(r.fbase_key).startsWith('firebase:authUser:'));
              resolve(row?.value?.stsTokenManager?.accessToken ?? null);
            };
            req.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        };
      }),
  );
  if (!token) throw new Error('could not read the phone\'s sign-in token from its browser storage');
  return token;
}

/** A brand-new anonymous identity that belongs to no household. */
export async function strangerToken(): Promise<string> {
  const { apiKey } = await webConfig();
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const body: any = await res.json();
  if (!body.idToken) throw new Error(`could not sign in a stranger: ${JSON.stringify(body)}`);
  return body.idToken;
}

/** HTTP status of a Firestore read (200 = allowed; 403 = refused by the rules; 404 = no such document). */
export async function fsStatus(token: string, path: string, method: 'GET' | 'PATCH' | 'DELETE' = 'GET'): Promise<number> {
  const { projectId } = await webConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { x: { stringValue: 'y' } } }) } : {}),
  });
  return res.status;
}

/** The household id this phone belongs to (from the sync layer's debug view). */
export async function householdId(page: Page): Promise<string> {
  const hid = await wtw(page, (w) => w.sync.debug?.().hid ?? null);
  if (!hid) throw new Error('this phone is not in a household (or the debug view is missing)');
  return hid;
}
