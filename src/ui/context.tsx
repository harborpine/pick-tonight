import { createContext, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AppServices,
  CatalogItem,
  DeviceState,
  EngineContext,
  PersonId,
  ServiceChoice,
  SharedState,
  SuggestRequest,
  SwipeAction,
  SyncApi,
  WatchPick,
  WatchlistOwner,
  Who,
} from '../contracts';

export type Tab = 'tonight' | 'new' | 'watchlist' | 'history' | 'us';

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

export interface PickInfo {
  item: CatalogItem;
  pick: WatchPick;
  service: ServiceChoice;
  who: Who;
}

export interface AppCtxValue {
  services: AppServices;
  state: SharedState;
  device: DeviceState;
  me: PersonId;
  engineCtx: () => EngineContext;
  itemById: (id: string) => CatalogItem | undefined;
  /** Best-effort title for any id (catalog items, then taste references). */
  titleOf: (id: string) => string;
  perform: (args: PerformArgs) => Promise<void>;
  toast: (message: string) => void;
  showPick: (info: PickInfo) => void;
  startOnboarding: (person: PersonId) => void;
  goTab: (tab: Tab) => void;
  /** Tonight tab flow. */
  solo: SoloFlow | null;
  setSolo: Dispatch<SetStateAction<SoloFlow | null>>;
  /** Session id whose join banner was dismissed (the Ask screen then shows an inline prompt). */
  joinDismissed: string | null;
  sessionLeft: boolean;
  setSessionLeft: (v: boolean) => void;
}

export interface SoloFlow {
  request: SuggestRequest;
  cards: import('../contracts').DeckCard[];
  /** How many cards were dealt to begin with (0 = nothing fit the request). */
  dealt: number;
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
