import { createContext, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AppServices,
  Catalog,
  CatalogItem,
  CatalogState,
  CatalogStore,
  DeckCard,
  DeviceState,
  EngineContext,
  Member,
  MemberId,
  ServiceChoice,
  SharedState,
  SuggestRequest,
  SwipeAction,
  SyncApi,
  WatchPick,
  WatchlistOwner,
  Who,
} from '../contracts';

export type Tab = 'tonight' | 'new' | 'watchlist' | 'matches' | 'history' | 'us';

export const EMPTY_CATALOG: Catalog = { schema: 1, builtAt: '', items: [] };

export interface PerformArgs {
  item: CatalogItem;
  pick: WatchPick;
  service: ServiceChoice;
  action: SwipeAction;
  /** Who the card was requested for. */
  who: Who;
  /** Which watchlist for 'save'. */
  list?: WatchlistOwner;
  /** Set when swiping inside a Together session. */
  sessionId?: string;
}

export interface AppCtxValue {
  services: AppServices;
  state: SharedState;
  device: DeviceState;
  me: MemberId;
  /** Members in a stable display order. */
  members: Member[];
  /** True when the household has one person: no who-picker, no Together, one watchlist. */
  isSolo: boolean;
  /** The merged catalog for the household's services, or null while there is none yet. */
  catalog: Catalog | null;
  catalogState: CatalogState;
  /** Resolves with the catalog for the household's current services (an empty one if it cannot be loaded). */
  ensureCatalog: () => Promise<Catalog>;
  retryCatalog: () => void;
  /** Never has a null catalog: an empty one stands in until the real one arrives. */
  engineCtx: () => EngineContext;
  itemById: (id: string) => CatalogItem | undefined;
  /** Best-effort title for any id (catalog, then anything saved with a snapshot or as a favourite). */
  titleOf: (id: string) => string;
  perform: (args: PerformArgs) => Promise<void>;
  /** A short message; with `action` it carries one button (e.g. Undo). */
  toast: (message: string, action?: ToastAction) => void;
  /** Mark follow-up keys as displayed on this phone (clears the New-tab dot). */
  followUpsShown: (keys: string[]) => void;
  /** Open the full-screen "tick what you have seen" grid for a member. */
  startOnboarding: (member: MemberId) => void;
  goTab: (tab: Tab) => void;
  /** Tonight tab flow. */
  solo: SoloFlow | null;
  setSolo: Dispatch<SetStateAction<SoloFlow | null>>;
  /** Session id whose join banner was dismissed (the Ask screen then shows an inline prompt). */
  joinDismissed: string | null;
  sessionLeft: boolean;
  setSessionLeft: (v: boolean) => void;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface SoloFlow {
  request: SuggestRequest;
  cards: DeckCard[];
  /** How many cards were dealt to begin with (0 = nothing fit the request). */
  dealt: number;
  /** Right-swipes (yes) in this deck session, for the "Liked" chip. */
  liked: number;
}

export const AppCtx = createContext<AppCtxValue | null>(null);

export function useApp(): AppCtxValue {
  const v = useContext(AppCtx);
  if (!v) throw new Error('AppCtx missing');
  return v;
}

/** Subscribe to the device and shared state. State arrives (and changes) at any time. */
export function useSyncData(sync: SyncApi): { device: DeviceState; state: SharedState | null } {
  const [device, setDevice] = useState<DeviceState>(() => sync.getDevice());
  const [state, setState] = useState<SharedState | null>(() => sync.getState());
  useEffect(() => {
    const u1 = sync.onDevice(setDevice);
    const u2 = sync.onState(setState);
    return () => {
      u1();
      u2();
    };
  }, [sync]);
  // After unpairing, drop any stale shared data.
  const shown = device.status === 'paired' ? state : null;
  return { device, state: shown };
}

/** Subscribe to the catalog store. */
export function useCatalogState(store: CatalogStore): CatalogState {
  const [s, setS] = useState<CatalogState>(() => store.get());
  useEffect(() => store.on(setS), [store]);
  return s;
}

/** Small local-only memory (last choices, collapsed sections). Never throws. */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

export function plainError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
