import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogItem, CatalogManifest, ServiceDef } from '../../src/contracts/catalog';
import { SERVICES } from '../../src/contracts/catalog';
import { FIXTURE_CATALOG } from '../../src/contracts/fixtures/catalog';
import { PROPOSED_SERVICES } from './services.proposed';
import { ALL_IDS, CORE_SERVICES, isChannelAddOn, onPlan, plansOn, providerMap, SERVICE_PROVIDERS, validateServiceTable } from './services';
import { selectAll } from './select';
import { distinctTitles, validateBuild, type BuiltService } from './validate';
import { diffArrivals, prevFromPool, prevUniverse } from './diff';
import { isFresh, overlayProviders, pruneStore, ttlDays } from './detailcache';
import { parseDetail, toCatalogItem } from './parse';
import { findOverride } from './overrides';

const fx = (id: string, providers: number[], over: Partial<CatalogItem> = {}): CatalogItem => ({
  ...FIXTURE_CATALOG.items[0],
  kind: id.startsWith('tv') ? 'tv' : 'movie',
  id,
  tmdbId: Number(id.replace(/\D/g, '')) || 1,
  providers,
  ...over,
});

describe('services table', () => {
  it('the contract SERVICES and the proposed table are identical (drift guard)', () => {
    expect(SERVICES).toEqual(PROPOSED_SERVICES);
  });
  it('is structurally sane', () => {
    expect(validateServiceTable(SERVICES)).toEqual([]);
  });
  it('contains every core service and keeps the original six plan ids', () => {
    for (const id of CORE_SERVICES) expect(SERVICES.some((s) => s.id === id)).toBe(true);
    const plans = (id: string) => SERVICES.find((s) => s.id === id)!.plans.map((p) => p.id);
    expect(plans('netflix')).toEqual(['standard', 'ads']);
    expect(plans('disney')).toEqual(['premium', 'ads']);
    expect(plans('hulu')).toEqual(['ads', 'noads']);
    expect(plans('hbo')).toEqual(['ads', 'adfree']);
    expect(plans('peacock')).toEqual(['premium', 'premium-plus']);
    expect(plans('paramount')).toEqual(['essential', 'premium']);
  });
  it('rejects channel add-ons, unknown ids, shared ids and an ad-free tier missing the ad tier ids', () => {
    expect(isChannelAddOn('HBO Max Amazon Channel')).toBe(true);
    expect(isChannelAddOn('Starz Apple TV channel')).toBe(true);
    expect(isChannelAddOn('AMC+ Roku Premium Channel')).toBe(true);
    expect(isChannelAddOn('Netflix Standard with Ads')).toBe(false);
    expect(isChannelAddOn('Amazon Prime Video with Ads')).toBe(false);
    const names = new Map([[1, 'Thing'], [2, 'Thing Amazon Channel'], [3, 'Other']]);
    const mk = (id: string, ...ids: number[]): ServiceDef => ({ id, name: id, plans: [{ id: 'p', label: 'p', adFree: true, providerIds: ids }] });
    expect(validateServiceTable([mk('a', 1)], names)).toEqual([]);
    expect(validateServiceTable([mk('a', 2)], names).join()).toMatch(/channel add-on/);
    expect(validateServiceTable([mk('a', 99)], names).join()).toMatch(/not in TMDB/);
    expect(validateServiceTable([mk('a', 1), mk('b', 1)], names).join()).toMatch(/belongs to both/);
    const bad: ServiceDef = { id: 'x', name: 'x', plans: [{ id: 'ads', label: '', adFree: false, providerIds: [1, 3] }, { id: 'free', label: '', adFree: true, providerIds: [1] }] };
    expect(validateServiceTable([bad]).join()).toMatch(/lacks provider 3/);
  });
  it('no provider id is used by two services, and none is a known add-on id', () => {
    const owner = new Map<number, string>();
    for (const s of SERVICES) for (const p of s.plans) for (const id of p.providerIds) {
      expect(owner.get(id) ?? s.id).toBe(s.id);
      owner.set(id, s.id);
    }
    // ids TMDB lists as Amazon / Apple TV / Roku Premium channels
    for (const banned of [1825, 583, 582, 584, 528, 635, 636, 633, 1853, 1854, 1852, 1855, 1794, 634, 1968, 2553]) expect(ALL_IDS).not.toContain(banned);
  });
  it('maps providers to plans: ad-free includes the ad tier, ad tier does not include the ad-free-only ids', () => {
    const peacock = SERVICES.find((s) => s.id === 'peacock')!;
    expect(plansOn([386], peacock)).toEqual(['premium', 'premium-plus']);
    expect(plansOn([387], peacock)).toEqual(['premium-plus']);
    const netflix = SERVICES.find((s) => s.id === 'netflix')!;
    expect(plansOn([8], netflix)).toEqual(['standard']);
    expect(plansOn([1796], netflix)).toEqual(['standard', 'ads']);
    const prime = SERVICES.find((s) => s.id === 'prime')!;
    expect(onPlan([9], prime.plans[0])).toBe(false);
    expect(onPlan([9], prime.plans[1])).toBe(true);
    expect(plansOn([15], SERVICES.find((s) => s.id === 'hulu')!)).toEqual(['ads', 'noads']);
  });
  it('providerMap lists each service once', () => {
    expect(Object.keys(providerMap()).length).toBe(SERVICES.length);
  });
});

describe('per-service selection', () => {
  const pool: CatalogItem[] = [
    ...Array.from({ length: 60 }, (_, n) => fx(`movie-${n}`, [8], { popularity: 100 - n, votes: 5000 })),
    ...Array.from({ length: 30 }, (_, n) => fx(`movie-${100 + n}`, [8, 337], { popularity: 80 - n, votes: 5000 })),
    ...Array.from({ length: 50 }, (_, n) => fx(`tv-${200 + n}`, [337], { kind: 'tv', popularity: 30 - n / 3, votes: 900 })),
  ];
  it('each service holds only its own titles; a shared title is the very same item in both', () => {
    const sel = selectAll(pool, ['netflix', 'disney']);
    const n = sel.get('netflix')!.items;
    const d = sel.get('disney')!.items;
    expect(n.every((i) => i.providers.includes(8))).toBe(true);
    expect(d.every((i) => i.providers.includes(337))).toBe(true);
    const shared = n.filter((i) => d.some((x) => x.id === i.id));
    expect(shared.length).toBeGreaterThan(0);
    for (const i of shared) expect(JSON.stringify(i)).toBe(JSON.stringify(d.find((x) => x.id === i.id)));
  });
  it('a small service is taken whole when under quota', () => {
    const sel = selectAll(pool, ['disney']).get('disney')!.items;
    expect(sel.length).toBe(80);
  });
});

describe('build validation', () => {
  const svc = (id: string, providerId: number, n: number): [string, BuiltService] => {
    const items = Array.from({ length: n }, (_, k) => fx(`movie-${providerId * 10000 + k}`, [providerId]));
    return [id, { catalog: { schema: 1, builtAt: 'x', items } as Catalog, bytes: 100_000 }];
  };
  const coreIds: Record<string, number> = { netflix: 8, disney: 337, hulu: 15, hbo: 1899, peacock: 386, paramount: 2616, prime: 9, apple: 350 };
  const good = () => {
    const files = new Map<string, BuiltService>(Object.entries(coreIds).map(([id, p]) => svc(id, p, 500)));
    const manifest: CatalogManifest = { schema: 1, builtAt: 'x', services: {} };
    for (const [id, f] of files) manifest.services[id] = { file: `data/catalog/${id}.json`, titles: f.catalog.items.length, bytes: f.bytes };
    return { files, manifest };
  };
  it('passes a healthy build', () => {
    const { files, manifest } = good();
    expect(distinctTitles(files.values())).toBe(4000);
    expect(validateBuild(manifest, files, null)).toEqual([]);
  });
  it('fails when a core service is missing or too small', () => {
    const { files, manifest } = good();
    delete manifest.services.peacock;
    files.delete('peacock');
    expect(validateBuild(manifest, files, null).join()).toMatch(/core service peacock is missing/);
    const g = good();
    g.files.get('apple')!.catalog.items.length = 20;
    g.manifest.services.apple.titles = 20;
    expect(validateBuild(g.manifest, g.files, null).join()).toMatch(/apple has only 20/);
  });
  it('fails on too few distinct titles, an oversized file, or a big shrink', () => {
    const small = new Map<string, BuiltService>(Object.entries(coreIds).map(([id, p]) => svc(id, p, 200)));
    const m: CatalogManifest = { schema: 1, builtAt: 'x', services: Object.fromEntries([...small].map(([id, f]) => [id, { file: 'f', titles: 200, bytes: f.bytes }])) };
    expect(validateBuild(m, small, null).join()).toMatch(/only 1600 distinct/);
    const g = good();
    g.files.get('netflix')!.bytes = 2_000_000;
    g.manifest.services.netflix.bytes = 2_000_000;
    expect(validateBuild(g.manifest, g.files, null).join()).toMatch(/netflix.json is 2000000 bytes/);
    const h = good();
    expect(validateBuild(h.manifest, h.files, { total: 20000, perService: { netflix: 2000 } }).join()).toMatch(/shrank from 20000 to 4000/);
  });
  it('fails when the same title differs between files, or a file holds a title that is not on its service', () => {
    const g = good();
    const a = g.files.get('netflix')!.catalog.items;
    g.files.get('disney')!.catalog.items.push({ ...a[0], providers: [8, 337], rating: 1 });
    g.manifest.services.disney.titles++;
    expect(validateBuild(g.manifest, g.files, null).join()).toMatch(/differs between service files/);
    const h = good();
    h.files.get('hulu')!.catalog.items.push(fx('movie-1', [8]));
    h.manifest.services.hulu.titles++;
    expect(validateBuild(h.manifest, h.files, null, undefined, undefined, SERVICE_PROVIDERS).join()).toMatch(/hulu: 1 items that are not on this service/);
  });
});

describe('new arrivals across services', () => {
  const run = (items: CatalogItem[], prev: any, knownProviders?: Set<number>) =>
    diffArrivals({ items, prev, prevNew: null, today: '2026-10-12', builtAt: 'x', info: new Map(), knownProviders });
  it('does not flood the feed when a whole service is added', () => {
    const old = fx('movie-1', [8]);
    const onNewService = fx('movie-2', [43]);
    const prev = new Map([['movie-1', { providers: [8] }]]);
    const r = run([old, onNewService], prev, new Set([8]));
    expect(r.arrivals.entries).toEqual([]);
    expect(run([old, onNewService], prev).arrivals.entries.length).toBe(1);
  });
  it('knows the previous provider universe from the pool or from what titles were on', () => {
    const pool = { schema: 1 as const, builtAt: '', ids: [8, 15], titles: { 'movie-1': { p: [8] } } };
    expect([...prevUniverse(pool, prevFromPool(pool, null))!].sort((a, b) => a - b)).toEqual([8, 15]);
    const noIds = { schema: 1 as const, builtAt: '', titles: { 'movie-1': { p: [8] }, 'movie-2': { p: [15, 8] } } };
    expect([...prevUniverse(noIds, prevFromPool(noIds, null))!].sort((a, b) => a - b)).toEqual([8, 15]);
    expect(prevUniverse(null, null)).toBeUndefined();
  });
  it('previous state is built from several per-service files', () => {
    const c1: Catalog = { schema: 1, builtAt: '', items: [fx('movie-1', [8])] };
    const c2: Catalog = { schema: 1, builtAt: '', items: [fx('movie-2', [15])] };
    expect([...prevFromPool(null, [c1, c2])!.keys()]).toEqual(['movie-1', 'movie-2']);
  });
  it('keeps at most 400 entries, newest first', () => {
    const items = Array.from({ length: 500 }, (_, n) => fx(`movie-${n}`, [8]));
    const info = new Map(items.map((i, n) => [i.id, { releaseDate: `2026-10-${String(1 + (n % 11)).padStart(2, '0')}`, seasonPremieres: [] }]));
    const r = diffArrivals({ items, prev: null, prevNew: null, today: '2026-10-12', builtAt: 'x', info });
    expect(r.arrivals.entries.length).toBe(400);
    expect(r.arrivals.entries[0].date >= r.arrivals.entries[399].date).toBe(true);
  });
});

describe('detail cache', () => {
  const parsed = (providers: number[]) => parseDetail('movie', { id: 1, title: 'M', release_date: '2020-01-01', genres: [], runtime: 100, 'watch/providers': { results: { US: { flatrate: providers.map((p) => ({ provider_id: p })) } } } })!;
  it('entries live 3 to 6 days, spread by id', () => {
    const days = new Set(Array.from({ length: 200 }, (_, n) => ttlDays(`tv-${n}`)));
    expect([...days].sort()).toEqual([3, 4, 5, 6]);
    const now = Date.now();
    expect(isFresh({ at: now - 2 * 86_400_000, parsed: parsed([8]) }, 'tv-1', now)).toBe(true);
    expect(isFresh({ at: now - 7 * 86_400_000, parsed: parsed([8]) }, 'tv-1', now)).toBe(false);
    expect(isFresh(undefined, 'tv-1', now)).toBe(false);
  });
  it("today's discovery adds providers to a cached title", () => {
    const p = parsed([8]);
    expect(overlayProviders(p, new Set([15, 8])).providers).toEqual([8, 15]);
    expect(overlayProviders(p, undefined)).toBe(p);
  });
  it('prunes entries nobody asked for after twice their lifetime', () => {
    const now = Date.now();
    const store = { 'movie-1': { at: now - 30 * 86_400_000, parsed: parsed([8]) }, 'movie-2': { at: now - 30 * 86_400_000, parsed: parsed([8]) }, 'movie-3': { at: now, parsed: parsed([8]) } };
    expect(pruneStore(store, new Set(['movie-2']), now)).toBe(1);
    expect(Object.keys(store).sort()).toEqual(['movie-2', 'movie-3']);
  });
});

describe('item language and overrides', () => {
  it('lang is the original language', () => {
    const p = parseDetail('tv', { id: 1, name: 'X', first_air_date: '2020-01-01', original_language: 'ko', genres: [] })!;
    expect(toCatalogItem(p).lang).toBe('ko');
  });
  it('keeps objective overrides and has dropped the taste-only ones', () => {
    expect(findOverride('tv', 'Game of Thrones', 2011)?.attention).toBe('high');
    expect(findOverride('tv', 'Family Guy', 1999)).toMatchObject({ attention: 'low', dropIn: true });
    expect(findOverride('tv', 'Why Women Kill', 2019)).toBeUndefined();
    expect(findOverride('tv', 'Paradise', 2025)).toBeUndefined();
  });
});
