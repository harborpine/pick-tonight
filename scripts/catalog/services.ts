/**
 * The services the build covers, and everything derived from them (provider ids, plan lookups, quotas).
 * The table comes from services.proposed.ts until the lead has pasted it into the contract, then from
 * the contract (the two are kept identical by a unit test).
 */
import type { PlanDef, ServiceDef, ServiceId } from '../../src/contracts/catalog';
import { SERVICES } from '../../src/contracts/catalog';
import { PROPOSED_SERVICES } from './services.proposed';

export const SERVICES_IN_USE: ServiceDef[] = PROPOSED_SERVICES.length ? PROPOSED_SERVICES : SERVICES;

/** Every provider id the build records on items. */
export const ALL_IDS: number[] = [...new Set(SERVICES_IN_USE.flatMap((s) => s.plans.flatMap((p) => p.providerIds)))];

/** Every provider id of each service across all its plans. */
export function providerMap(services: ServiceDef[] = SERVICES_IN_USE): Record<ServiceId, Set<number>> {
  return Object.fromEntries(services.map((s) => [s.id, new Set(s.plans.flatMap((p) => p.providerIds))]));
}
export const SERVICE_PROVIDERS: Record<ServiceId, Set<number>> = providerMap();

export function servicesOf(providers: number[], map: Record<ServiceId, Set<number>> = SERVICE_PROVIDERS): ServiceId[] {
  return Object.keys(map).filter((s) => providers.some((p) => map[s].has(p)));
}

/** Ids of the plans of `service` that include a title carried by `providers`. */
export function plansOn(providers: number[], service: ServiceDef): string[] {
  return service.plans.filter((p) => p.providerIds.some((id) => providers.includes(id))).map((p) => p.id);
}

/** The plans a household on `plan` can watch: does a title with `providers` appear on it? */
export function onPlan(providers: number[], plan: PlanDef): boolean {
  return plan.providerIds.some((id) => providers.includes(id));
}

/** Services that must always be present and healthy, or the build fails (nothing is deployed). */
export const CORE_SERVICES: ServiceId[] = ['netflix', 'disney', 'hulu', 'hbo', 'peacock', 'paramount', 'prime', 'apple'];

/** A service published with fewer titles than this is left out of the manifest. */
export const MIN_SERVICE_TITLES = 40;

/** How many titles at most each service's file holds (catalog size drives download size). */
const QUOTA: Record<ServiceId, number> = {
  netflix: 1100,
  prime: 1100,
  hulu: 900,
  tubi: 800,
  hbo: 800,
  disney: 800,
  paramount: 700,
  peacock: 700,
  roku: 600,
  pluto: 600,
};
export const DEFAULT_QUOTA = 600;
export const quotaFor = (id: ServiceId): number => QUOTA[id] ?? DEFAULT_QUOTA;

/** Services with big back catalogs get deeper discovery so the quota can be filled with good titles. */
export function isBigService(id: ServiceId): boolean {
  return quotaFor(id) >= 700;
}

/** Add-on stores inside other stores. Their titles are never part of a service's own plans. */
const CHANNEL_ADDON = /\b(amazon|apple tv|roku premium|prime video|youtube)\s+(primetime\s+)?channels?\b/i;
export function isChannelAddOn(providerName: string): boolean {
  return CHANNEL_ADDON.test(providerName);
}

/**
 * Structural checks on a services table; `names` (provider id -> TMDB name) adds checks against TMDB's real list.
 * Returns human-readable problems, empty when sane.
 */
export function validateServiceTable(services: ServiceDef[], names?: Map<number, string>): string[] {
  const problems: string[] = [];
  const owner = new Map<number, string>();
  const seenService = new Set<string>();
  for (const s of services) {
    if (seenService.has(s.id)) problems.push(`duplicate service id ${s.id}`);
    seenService.add(s.id);
    if (!s.plans.length) problems.push(`${s.id} has no plans`);
    const seenPlan = new Set<string>();
    for (const p of s.plans) {
      if (seenPlan.has(p.id)) problems.push(`${s.id}: duplicate plan id ${p.id}`);
      seenPlan.add(p.id);
      if (!p.providerIds.length) problems.push(`${s.id}/${p.id} has no provider ids`);
      for (const id of p.providerIds) {
        const other = owner.get(id);
        if (other && other !== s.id) problems.push(`provider ${id} belongs to both ${other} and ${s.id}`);
        owner.set(id, s.id);
        const name = names?.get(id);
        if (names && !name) problems.push(`${s.id}/${p.id}: provider ${id} is not in TMDB's US provider list`);
        if (name && isChannelAddOn(name)) problems.push(`${s.id}/${p.id}: provider ${id} "${name}" is a channel add-on, not the service itself`);
      }
    }
    // An ad-free plan is the top tier: it includes everything the ad tier includes.
    const adFree = s.plans.filter((p) => p.adFree);
    const withAds = s.plans.filter((p) => !p.adFree);
    for (const top of adFree) for (const low of withAds) {
      const missing = low.providerIds.filter((id) => !top.providerIds.includes(id));
      if (missing.length) problems.push(`${s.id}: ad-free plan ${top.id} lacks provider ${missing.join(',')} of ${low.id}`);
    }
  }
  return problems;
}
