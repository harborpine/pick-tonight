/**
 * CONTRACT: what the app shell (src/app) hands to the UI (src/ui).
 * Only the lead edits files in src/contracts/.
 */
import type { Catalog, NewArrivals, ServiceId, TitleIndex } from './catalog';
import type { Engine } from './engine';
import type { SyncApi, Unsubscribe } from './sync';

export interface CatalogState {
  /**
   * idle    — nothing requested yet (e.g. before the household has chosen services).
   * loading — fetching; `catalog` still holds the previous one, if any.
   * ready   — `catalog` matches `services`.
   * error   — the last load failed; `error` is a plain-language message; `catalog` may hold an older one.
   */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The merged catalog for `services` (every title on any plan of those services), or null. */
  catalog: Catalog | null;
  /** The service ids the current / in-flight load is for, sorted. */
  services: ServiceId[];
  error: string | null;
}

/**
 * The catalog is published as one file per streaming service, so a phone downloads
 * only what its household subscribes to. This store fetches and merges them.
 */
export interface CatalogStore {
  get(): CatalogState;
  /** Fires immediately with the current value, then on every change. */
  on(cb: (state: CatalogState) => void): Unsubscribe;
  /**
   * Make the catalog match these services (order and duplicates ignored). Does nothing if it
   * already does. An empty list gives an empty catalog. Resolves when ready; rejects with a
   * plain-language Error on failure (the state also goes to 'error'). Safe to call repeatedly.
   */
  load(services: ServiceId[]): Promise<Catalog>;
}

export interface AppServices {
  catalogs: CatalogStore;
  /** Loaded at startup (may be empty). Entries for services the household lacks are simply not in the catalog. */
  newArrivals: NewArrivals;
  engine: Engine;
  /** init() has been called. The UI subscribes with onDevice / onState. */
  sync: SyncApi;
  /**
   * Fetch the broad title lookup (a few MB) on demand — for choosing favourites, importing a
   * watch history, or adding a watched title by hand. Cached after the first call; rejects with
   * a plain-language Error offline.
   */
  loadTitleIndex(): Promise<TitleIndex>;
  /** The address people open to use the app, ending in '/'. Invite links are `${siteUrl}?join=CODE`. */
  siteUrl: string;
  /**
   * The invite code from this page's `?join=CODE` link, if it was opened from one (upper-cased, validated shape only).
   * In a normal browser tab the code is deliberately LEFT in the address so that "Add to Home Screen"
   * carries it into the installed app (see `standalone`); it stays set on every later launch from that
   * icon, so ignore it once this phone is paired.
   */
  joinCode: string | null;
  /**
   * True when running as an installed home-screen app; false in an ordinary browser tab.
   * A browser tab and the installed app do NOT share storage on iPhone, so pairing done in a tab is
   * lost after "Add to Home Screen": when false, the UI should steer people to install first.
   */
  standalone: boolean;
}

/** src/ui/index.tsx must export: `export function App(props: { services: AppServices }): JSX.Element` */
export interface AppProps {
  services: AppServices;
}
