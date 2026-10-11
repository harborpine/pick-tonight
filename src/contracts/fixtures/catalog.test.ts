import { describe, expect, it } from 'vitest';
import { ALL_PROVIDER_IDS, GENRES, MOODS } from '../catalog';
import { FIXTURE_CATALOG, FIXTURE_NEW_ARRIVALS } from './catalog';

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
  it('resolves every seeded favourite to a taste reference', () => {
    const refs = new Set(FIXTURE_CATALOG.tasteRefs.map((r) => r.id));
    for (const id of [...FIXTURE_CATALOG.seedFavorites.HG, ...FIXTURE_CATALOG.seedFavorites.BG]) expect(refs.has(id)).toBe(true);
    expect(FIXTURE_CATALOG.seedFavorites.HG).toHaveLength(14);
    expect(FIXTURE_CATALOG.seedFavorites.BG).toHaveLength(22);
  });
  it('new arrivals point at catalog items', () => {
    for (const e of FIXTURE_NEW_ARRIVALS.entries) expect(ids.has(e.itemId)).toBe(true);
  });
});
