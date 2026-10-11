import { describe, expect, it } from 'vitest';
import { ALL_PROVIDER_IDS, GENRES, MOODS, SERVICES } from '../catalog';
import { FIXTURE_CATALOG, FIXTURE_FAVORITES, FIXTURE_MEMBERS, FIXTURE_NEW_ARRIVALS, FIXTURE_PLANS } from './catalog';

describe('fixture catalog', () => {
  const ids = new Set(FIXTURE_CATALOG.items.map((i) => i.id));
  it('has unique, well-formed items', () => {
    expect(ids.size).toBe(FIXTURE_CATALOG.items.length);
    const moods = new Set<string>(MOODS.map((m) => m.id));
    for (const i of FIXTURE_CATALOG.items) {
      expect(i.id).toBe(`${i.kind}-${i.tmdbId}`);
      expect(i.runtime).toBeGreaterThan(0);
      expect(i.providers.length).toBeGreaterThan(0);
      for (const p of i.providers) expect(ALL_PROVIDER_IDS).toContain(p);
      for (const g of i.genres) expect(Object.keys(GENRES)).toContain(g);
      for (const m of Object.keys(i.moods)) expect(moods.has(m)).toBe(true);
    }
  });
  it('has a sample household with favourites, including ones outside the catalog', () => {
    expect(FIXTURE_FAVORITES.alex).toHaveLength(14);
    expect(FIXTURE_FAVORITES.sam).toHaveLength(22);
    expect(FIXTURE_FAVORITES.kit).toHaveLength(0);
    expect(FIXTURE_FAVORITES.alex.some((f) => !ids.has(f.id))).toBe(true);
    expect(Object.keys(FIXTURE_MEMBERS)).toEqual(['alex', 'sam', 'kit']);
    for (const svc of Object.keys(FIXTURE_PLANS)) expect(SERVICES.some((s) => s.id === svc)).toBe(true);
  });
  it('new arrivals point at catalog items', () => {
    for (const e of FIXTURE_NEW_ARRIVALS.entries) expect(ids.has(e.itemId)).toBe(true);
  });
});
