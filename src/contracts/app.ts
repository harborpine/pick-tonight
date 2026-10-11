/**
 * CONTRACT: what the app shell (src/app) hands to the UI (src/ui).
 * Only the lead edits files in src/contracts/.
 */
import type { Catalog, NewArrivals } from './catalog';
import type { Engine } from './engine';
import type { SyncApi } from './sync';

export interface AppServices {
  /** Loaded before the UI renders. */
  catalog: Catalog;
  newArrivals: NewArrivals;
  engine: Engine;
  /** Already init()-ed. The UI subscribes with onDevice / onState. */
  sync: SyncApi;
}

/** src/ui/index.tsx must export: `export function App(props: { services: AppServices }): JSX.Element` */
export interface AppProps {
  services: AppServices;
}
