/** Sanity checks on the finished catalog. Any returned problem fails the build so yesterday's site stays up. */
import type { Catalog, ServiceId } from '../../src/contracts/catalog';
import { DEFAULT_PLANS, SERVICES } from '../../src/contracts/catalog';
import { DEFAULT_PROVIDERS, servicesOf } from './select';

export const LIMITS = {
  minTitles: 1800,
  minPerDefaultService: 150,
  maxBytes: 2_600_000,
  maxShrink: 0.5,
};

export function countByDefaultService(c: Pick<Catalog, 'items'>): Record<ServiceId, number> {
  const out = Object.fromEntries(SERVICES.map((s) => [s.id, 0])) as Record<ServiceId, number>;
  for (const i of c.items) for (const s of servicesOf(i.providers, DEFAULT_PROVIDERS)) out[s]++;
  return out;
}

export function validateCatalog(c: Catalog, bytes: number, prevCount: number | null, limits = LIMITS): string[] {
  const problems: string[] = [];
  if (c.items.length < limits.minTitles) problems.push(`only ${c.items.length} titles (minimum ${limits.minTitles})`);
  const per = countByDefaultService(c);
  for (const s of SERVICES) {
    if (DEFAULT_PLANS[s.id] && per[s.id] < limits.minPerDefaultService)
      problems.push(`${s.name} has only ${per[s.id]} titles on the default plan (minimum ${limits.minPerDefaultService})`);
  }
  if (prevCount && c.items.length < prevCount * (1 - limits.maxShrink))
    problems.push(`catalog shrank from ${prevCount} to ${c.items.length} titles (more than ${limits.maxShrink * 100}%)`);
  if (bytes > limits.maxBytes) problems.push(`catalog.json is ${bytes} bytes (limit ${limits.maxBytes})`);
  const ids = new Set(c.items.map((i) => i.id));
  if (ids.size !== c.items.length) problems.push('duplicate item ids');
  const badRuntime = c.items.filter((i) => !(i.runtime > 0) || i.providers.length === 0);
  if (badRuntime.length) problems.push(`${badRuntime.length} items with bad runtime or no providers`);
  for (const who of ['HG', 'BG'] as const) {
    const refs = new Set(c.tasteRefs.map((r) => r.id));
    const missing = c.seedFavorites[who].filter((id) => !refs.has(id));
    if (missing.length) problems.push(`seed favourites for ${who} missing from tasteRefs: ${missing.join(', ')}`);
  }
  return problems;
}
