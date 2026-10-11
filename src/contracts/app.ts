/**
 * CONTRACT: what the app shell (src/app) hands to the UI (src/ui).
 * Only the lead edits files in src/contracts/.
 */
import type { Catalog, NewArrivals, TitleIndex } from './catalog';
import type { Engine } from './engine';
import type { SyncApi } from './sync';

export interface AppServices {
  /** Loaded before the UI renders. */
  catalog: Catalog;
  newArrivals: NewArrivals;
  engine: Engine;
  /** Already init()-ed. The UI subscribes with onDevice / onState. */
  sync: SyncApi;
  /**
   * Fetch the broad title lookup (a few MB) on demand — only when importing a watch history or
   * adding a watched title by hand. Cached after the first call; rejects with a plain-language Error offline.
   */
  loadTitleIndex(): Promise<TitleIndex>;
}

/** src/ui/index.tsx must export: `export function App(props: { services: AppServices }): JSX.Element` */
export interface AppProps {
  services: AppServices;
}
