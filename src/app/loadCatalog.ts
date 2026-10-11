import {
  CATALOG_MANIFEST_PATH,
  NEW_ARRIVALS_PATH,
  TITLE_INDEX_PATH,
  type Catalog,
  type CatalogItem,
  type CatalogManifest,
  type CatalogState,
  type CatalogStore,
  type NewArrivals,
  type ServiceId,
  type TitleIndex,
} from '../contracts';

export type DataSource = 'live' | 'fixture';

const EMPTY_NEW: NewArrivals = { schema: 1, builtAt: '', entries: [] };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The New feed is a nice-to-have: never block the app on it. */
export async function loadNewArrivals(source: DataSource): Promise<NewArrivals> {
  if (source === 'fixture') return (await import('../contracts/fixtures/catalog')).FIXTURE_NEW_ARRIVALS;
  return getJson<NewArrivals>(NEW_ARRIVALS_PATH).catch(() => EMPTY_NEW);
}

const key = (services: ServiceId[]): string => [...new Set(services)].sort().join(',');

/**
 * Fetches the per-service catalog files a household needs and merges them into one
 * catalog. Service files are cached for the life of the page, so changing plans only
 * downloads what is new. In fixture mode the built-in sample catalog is used for any
 * non-empty selection.
 */
export function createCatalogStore(source: DataSource): CatalogStore {
  let state: CatalogState = { status: 'idle', catalog: null, services: [], error: null };
  const subs = new Set<(s: CatalogState) => void>();
  const set = (next: CatalogState) => {
    state = next;
    subs.forEach((cb) => cb(state));
  };

  let manifest: Promise<CatalogManifest> | null = null;
  const files = new Map<ServiceId, Promise<Catalog>>();
  let inFlight: { key: string; promise: Promise<Catalog> } | null = null;

  const getManifest = () => {
    manifest ??= getJson<CatalogManifest>(CATALOG_MANIFEST_PATH).catch((err) => {
      manifest = null;
      throw err;
    });
    return manifest;
  };
  const getFile = (id: ServiceId, path: string) => {
    let p = files.get(id);
    if (!p) {
      p = getJson<Catalog>(path).catch((err) => {
        files.delete(id);
        throw err;
      });
      files.set(id, p);
    }
    return p;
  };

  async function build(services: ServiceId[]): Promise<Catalog> {
    if (services.length === 0) return { schema: 1, builtAt: '', items: [] };
    if (source === 'fixture') return (await import('../contracts/fixtures/catalog')).FIXTURE_CATALOG;
    const m = await getManifest();
    // A service the catalog doesn't publish (yet) simply contributes nothing.
    const wanted = services.filter((id) => m.services[id]);
    const parts = await Promise.all(wanted.map((id) => getFile(id, m.services[id].file)));
    const byId = new Map<string, CatalogItem>();
    for (const part of parts) for (const item of part.items) if (!byId.has(item.id)) byId.set(item.id, item);
    return { schema: 1, builtAt: m.builtAt, items: [...byId.values()] };
  }

  return {
    get: () => state,
    on(cb) {
      subs.add(cb);
      cb(state);
      return () => subs.delete(cb);
    },
    load(services) {
      const sorted = [...new Set(services)].sort();
      const k = key(sorted);
      if (state.status === 'ready' && state.catalog && key(state.services) === k) return Promise.resolve(state.catalog);
      if (inFlight && inFlight.key === k) return inFlight.promise;
      set({ status: 'loading', catalog: state.catalog, services: sorted, error: null });
      const promise = build(sorted).then(
        (catalog) => {
          // A newer request may have started meanwhile; only the latest one publishes.
          if (inFlight?.key === k) {
            inFlight = null;
            set({ status: 'ready', catalog, services: sorted, error: null });
          }
          return catalog;
        },
        (err) => {
          console.error('catalog load failed', err);
          const message = "Couldn't load the list of shows and films. Check your connection and try again.";
          if (inFlight?.key === k) {
            inFlight = null;
            set({ status: 'error', catalog: state.catalog, services: sorted, error: message });
          }
          throw new Error(message);
        },
      );
      inFlight = { key: k, promise };
      return promise;
    },
  };
}

/**
 * The broad title lookup, fetched only when someone chooses favourites, imports a
 * watch history, or adds a watched title by hand. Cached for the life of the page.
 */
export function titleIndexLoader(source: DataSource): () => Promise<TitleIndex> {
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
