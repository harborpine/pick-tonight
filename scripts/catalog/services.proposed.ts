/**
 * PROPOSED replacement for SERVICES in src/contracts/catalog.ts (the lead pastes this table there).
 * Until the contract carries it, the catalog build reads THIS table (see services.ts), and a unit
 * test fails if the contract and this table disagree.
 *
 * Rules the table follows:
 *  - A plan's providerIds are the TMDB (JustWatch) US provider ids whose titles are INCLUDED in that
 *    plan. A higher tier lists the lower tier's ids too.
 *  - Never an "X Amazon Channel" / "X Apple TV Channel" / "X Roku Premium Channel" add-on id.
 *  - Where TMDB has one id for a service's ad and ad-free tiers, both plans share it and differ only in `adFree`.
 *  - Free ad-supported services are separate services, plans with adFree:false.
 *
 * STATUS: every id below was checked against TMDB's US provider list (workflow "TMDB check", 12 Oct 2026).
 */
import type { ServiceDef } from '../../src/contracts/catalog';

export const PROPOSED_SERVICES: ServiceDef[] = [
  { id: 'netflix', name: 'Netflix', plans: [
    { id: 'standard', label: 'Ad-free', adFree: true, providerIds: [8, 1796] },
    { id: 'ads', label: 'Standard with ads', adFree: false, providerIds: [1796] },
  ] },
  { id: 'disney', name: 'Disney+', plans: [
    { id: 'premium', label: 'Ad-free', adFree: true, providerIds: [337] },
    { id: 'ads', label: 'With ads', adFree: false, providerIds: [337] },
  ] },
  { id: 'hulu', name: 'Hulu', plans: [
    { id: 'ads', label: 'With ads', adFree: false, providerIds: [15] },
    { id: 'noads', label: 'No ads', adFree: true, providerIds: [15] },
  ] },
  { id: 'hbo', name: 'HBO Max', plans: [
    { id: 'ads', label: 'With ads', adFree: false, providerIds: [1899] },
    { id: 'adfree', label: 'Ad-free', adFree: true, providerIds: [1899] },
  ] },
  { id: 'peacock', name: 'Peacock', plans: [
    { id: 'premium', label: 'Premium (with ads)', adFree: false, providerIds: [386] },
    { id: 'premium-plus', label: 'Premium Plus', adFree: true, providerIds: [386, 387] },
  ] },
  { id: 'paramount', name: 'Paramount+', plans: [
    { id: 'essential', label: 'Essential (with ads)', adFree: false, providerIds: [2616] },
    { id: 'premium', label: 'Premium', adFree: true, providerIds: [2616, 2303] },
  ] },
  { id: 'prime', name: 'Prime Video', plans: [
    { id: 'ads', label: 'Prime (with ads)', adFree: false, providerIds: [2100] },
    { id: 'adfree', label: 'Prime + ad-free add-on', adFree: true, providerIds: [9, 2100] },
  ] },
  { id: 'apple', name: 'Apple TV+', plans: [{ id: 'standard', label: 'Apple TV+', adFree: true, providerIds: [350] }] },
  { id: 'starz', name: 'Starz', plans: [{ id: 'standard', label: 'Starz', adFree: true, providerIds: [43] }] },
  { id: 'amc', name: 'AMC+', plans: [{ id: 'standard', label: 'AMC+', adFree: true, providerIds: [526] }] },
  { id: 'mgm', name: 'MGM+', plans: [{ id: 'standard', label: 'MGM+', adFree: true, providerIds: [34] }] },
  { id: 'britbox', name: 'BritBox', plans: [{ id: 'standard', label: 'BritBox', adFree: true, providerIds: [151] }] },
  { id: 'crunchyroll', name: 'Crunchyroll', plans: [{ id: 'standard', label: 'Crunchyroll', adFree: true, providerIds: [283] }] },
  { id: 'discovery', name: 'discovery+', plans: [{ id: 'standard', label: 'discovery+', adFree: true, providerIds: [520] }] },
  { id: 'shudder', name: 'Shudder', plans: [{ id: 'standard', label: 'Shudder', adFree: true, providerIds: [99] }] },
  { id: 'criterion', name: 'Criterion Channel', plans: [{ id: 'standard', label: 'Criterion Channel', adFree: true, providerIds: [258] }] },
  { id: 'mubi', name: 'MUBI', plans: [{ id: 'standard', label: 'MUBI', adFree: true, providerIds: [11] }] },
  { id: 'sundance', name: 'Sundance Now', plans: [{ id: 'standard', label: 'Sundance Now', adFree: true, providerIds: [143] }] },
  { id: 'hidive', name: 'HIDIVE', plans: [{ id: 'standard', label: 'HIDIVE', adFree: true, providerIds: [430] }] },
  { id: 'kanopy', name: 'Kanopy (free with a library card)', plans: [{ id: 'library', label: 'Library card', adFree: true, providerIds: [191] }] },
  { id: 'hoopla', name: 'Hoopla (free with a library card)', plans: [{ id: 'library', label: 'Library card', adFree: true, providerIds: [212] }] },
  { id: 'tubi', name: 'Tubi (free)', plans: [{ id: 'free', label: 'Free with ads', adFree: false, providerIds: [73] }] },
  { id: 'pluto', name: 'Pluto TV (free)', plans: [{ id: 'free', label: 'Free with ads', adFree: false, providerIds: [300] }] },
  { id: 'primefree', name: 'Prime Video free tier (free)', plans: [{ id: 'free', label: 'Free with ads, no Prime needed', adFree: false, providerIds: [613] }] },
  { id: 'plex', name: 'Plex (free)', plans: [{ id: 'free', label: 'Free with ads', adFree: false, providerIds: [538] }] },
  { id: 'fandangofree', name: 'Fandango at Home Free', plans: [{ id: 'free', label: 'Free with ads', adFree: false, providerIds: [332] }] },
  { id: 'cw', name: 'The CW (free)', plans: [{ id: 'free', label: 'Free with ads', adFree: false, providerIds: [83] }] },
  { id: 'roku', name: 'The Roku Channel (free)', plans: [{ id: 'free', label: 'Free with ads', adFree: false, providerIds: [207] }] },
];
