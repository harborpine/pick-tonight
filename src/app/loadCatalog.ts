import { CATALOG_PATH, NEW_ARRIVALS_PATH, type Catalog, type NewArrivals } from '../contracts';

export interface LoadedData {
  catalog: Catalog;
  newArrivals: NewArrivals;
}

const EMPTY_NEW: NewArrivals = { schema: 1, builtAt: '', entries: [] };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Loads the daily-built catalog, or the built-in sample catalog when asked
 * (?catalog=fixture, used by development and the end-to-end tests).
 */
export async function loadData(source: 'live' | 'fixture'): Promise<LoadedData> {
  if (source === 'fixture') {
    const fx = await import('../contracts/fixtures/catalog');
    return { catalog: fx.FIXTURE_CATALOG, newArrivals: fx.FIXTURE_NEW_ARRIVALS };
  }
  const catalog = await getJson<Catalog>(CATALOG_PATH);
  if (catalog.schema !== 1 || !Array.isArray(catalog.items) || catalog.items.length === 0) {
    throw new Error('The catalog file is empty or in an unexpected format.');
  }
  // The New feed is a nice-to-have: never block the app on it.
  const newArrivals = await getJson<NewArrivals>(NEW_ARRIVALS_PATH).catch(() => EMPTY_NEW);
  return { catalog, newArrivals };
}
