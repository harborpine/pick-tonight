import { CATALOG_PATH, NEW_ARRIVALS_PATH, TITLE_INDEX_PATH, type Catalog, type NewArrivals, type TitleIndex } from '../contracts';

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

/**
 * The broad title lookup, fetched only when someone imports a watch history or
 * adds a watched title by hand. Cached for the life of the page.
 */
export function titleIndexLoader(source: 'live' | 'fixture'): () => Promise<TitleIndex> {
  let cached: Promise<TitleIndex> | null = null;
  return () => {
    cached ??= (async () => {
      if (source === 'fixture') return (await import('../contracts/fixtures/catalog')).FIXTURE_TITLE_INDEX;
      const index = await getJson<TitleIndex>(TITLE_INDEX_PATH);
      if (index.schema !== 1 || !Array.isArray(index.titles)) throw new Error('unexpected format');
      return index;
    })().catch((err) => {
      cached = null;
      console.error('title index failed', err);
      throw new Error("Couldn't load the list of titles. Check your connection and try again.");
    });
    return cached;
  };
}
