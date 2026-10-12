/** Sanity checks on the finished build. Any returned problem fails the build so yesterday's site stays up. */
import type { Catalog, CatalogManifest, ServiceId } from '../../src/contracts/catalog';
import { CORE_SERVICES, MIN_SERVICE_TITLES, SERVICE_PROVIDERS } from './services';

export const LIMITS = {
  /** Distinct titles over all services. */
  minTotal: 3000,
  /** Every core service must hold at least this many titles. */
  minCoreService: 150,
  /** One service file, raw bytes. */
  maxFileBytes: 1_500_000,
  /** A drop of more than this share versus the previous build fails (total and per service). */
  maxShrink: 0.5,
};

export interface BuiltService {
  catalog: Catalog;
  bytes: number;
}

export interface Previous {
  total: number;
  perService: Record<ServiceId, number>;
}

export function distinctTitles(files: Iterable<BuiltService>): number {
  const ids = new Set<string>();
  for (const f of files) for (const i of f.catalog.items) ids.add(i.id);
  return ids.size;
}

export function validateBuild(
  manifest: CatalogManifest,
  files: Map<ServiceId, BuiltService>,
  prev: Previous | null,
  limits = LIMITS,
  core: ServiceId[] = CORE_SERVICES,
  providers: Record<ServiceId, Set<number>> = SERVICE_PROVIDERS,
): string[] {
  const problems: string[] = [];
  for (const id of core) {
    const entry = manifest.services[id];
    if (!entry) {
      problems.push(`core service ${id} is missing from the manifest`);
      continue;
    }
    if (entry.titles < limits.minCoreService) problems.push(`core service ${id} has only ${entry.titles} titles (minimum ${limits.minCoreService})`);
  }
  const total = distinctTitles(files.values());
  if (total < limits.minTotal) problems.push(`only ${total} distinct titles (minimum ${limits.minTotal})`);

  const seen = new Map<string, string>();
  for (const [id, f] of files) {
    const entry = manifest.services[id];
    if (!entry) problems.push(`${id} has a file but no manifest entry`);
    else if (entry.titles !== f.catalog.items.length || entry.bytes !== f.bytes) problems.push(`${id}: manifest says ${entry.titles} titles / ${entry.bytes} bytes but the file has ${f.catalog.items.length} / ${f.bytes}`);
    if (f.bytes > limits.maxFileBytes) problems.push(`${id}.json is ${f.bytes} bytes (limit ${limits.maxFileBytes})`);
    const ids = new Set(f.catalog.items.map((i) => i.id));
    if (ids.size !== f.catalog.items.length) problems.push(`${id}: duplicate item ids`);
    const bad = f.catalog.items.filter((i) => !(i.runtime > 0) || i.providers.length === 0 || !i.lang);
    if (bad.length) problems.push(`${id}: ${bad.length} items with bad runtime, no providers or no language`);
    const own = providers[id];
    if (own) {
      const stray = f.catalog.items.filter((i) => !i.providers.some((p) => own.has(p)));
      if (stray.length) problems.push(`${id}: ${stray.length} items that are not on this service`);
    }
    for (const i of f.catalog.items) {
      const json = JSON.stringify(i);
      const before = seen.get(i.id);
      if (before === undefined) seen.set(i.id, json);
      else if (before !== json) {
        problems.push(`item ${i.id} differs between service files`);
        break;
      }
    }
  }
  for (const id of Object.keys(manifest.services)) if (!files.has(id)) problems.push(`manifest lists ${id} but there is no file for it`);

  if (prev) {
    if (prev.total && total < prev.total * (1 - limits.maxShrink)) problems.push(`catalog shrank from ${prev.total} to ${total} distinct titles (more than ${limits.maxShrink * 100}%)`);
    for (const [id, n] of Object.entries(prev.perService)) {
      const now = manifest.services[id]?.titles;
      if (now !== undefined && n >= 100 && now < n * (1 - limits.maxShrink)) problems.push(`${id} shrank from ${n} to ${now} titles (more than ${limits.maxShrink * 100}%)`);
      if (now === undefined && core.includes(id)) problems.push(`${id} was published before (${n} titles) and is now gone`);
    }
  }
  return problems;
}

export { MIN_SERVICE_TITLES };
