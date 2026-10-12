import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { memberOrder, normalizeWho, subscribedServices, type AppProps, type Catalog, type CatalogItem, type EngineContext, type MemberId } from '../contracts';
import { THEME_ACCENT, THEME_BACKGROUND } from '../config';
import { Icon } from './components';
import {
  AppCtx,
  EMPTY_CATALOG,
  readLocal,
  useCatalogState,
  useSyncData,
  writeLocal,
  type AppCtxValue,
  type PerformArgs,
  type SoloFlow,
  type Tab,
  type ToastAction,
} from './context';
import { SPENT_CODES_KEY, addSpentCode, inSession, needsToJoin, nextUnshownMatch, parseSpentCodes, snapshotOf, todayLocal, usableAddressCode } from './helpers';
import { History } from './History';
import { Watchlist } from './Lists';
import { Matches } from './Matches';
import { NewFeed } from './NewFeed';
import { Onboarding } from './Onboarding';
import { JoinCard, MatchScreen } from './Overlays';
import { DeviceErrorBanner, Setup, Splash } from './Setup';
import { Tonight } from './Tonight';
import { Us } from './Us';
import { Wizard } from './Wizard';
import './styles.css';

declare global {
  interface Window {
    /** Dev/debug hook (dev server or ?debug=1): the live services, so other "phones" can be simulated. */
    __wtw?: AppProps['services'];
  }
}

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'tonight', label: 'Tonight', icon: Icon.tonight },
  { id: 'new', label: 'New', icon: Icon.fresh },
  { id: 'watchlist', label: 'Watchlist', icon: Icon.list },
  { id: 'matches', label: 'Matches', icon: Icon.heart },
  { id: 'history', label: 'History', icon: Icon.history },
  { id: 'us', label: 'Us', icon: Icon.us },
];

const SHOWN_KEY = 'pt.ui.followups.shown.v1';
const matchKey = (sessionId: string) => `pt.ui.matchShown.${sessionId}`;

function debugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    if (new URLSearchParams(location.search).get('debug') === '1') {
      sessionStorage.setItem('pt.debug', '1');
      return true;
    }
    return sessionStorage.getItem('pt.debug') === '1';
  } catch {
    return false;
  }
}

export function App({ services }: AppProps) {
  const { engine, sync, catalogs } = services;
  const { device, state } = useSyncData(sync);
  const catalogState = useCatalogState(catalogs);
  const catalog = catalogState.catalog;

  const [tab, setTab] = useState<Tab>('tonight');
  const [solo, setSolo] = useState<SoloFlow | null>(null);
  const [sessionLeft, setSessionLeft] = useState(false);
  const [onboardFor, setOnboardFor] = useState<MemberId | null>(null);
  const [matchIdx, setMatchIdx] = useState<number | null>(null);
  const [joinDismissed, setJoinDismissed] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ id: number; text: string; action?: ToastAction } | null>(null);
  const [shownKeys, setShownKeys] = useState<string[]>(() => readLocal<string[]>(SHOWN_KEY, []));

  // Dev / QA hook.
  useEffect(() => {
    if (debugEnabled()) window.__wtw = services;
  }, [services]);

  const me: MemberId | null = device.memberId;

  // Joining (or otherwise pairing) with the address's ?join= code uses it up. The installed icon keeps that address
  // forever, so remember the code on this phone and ignore it from then on.
  useEffect(() => {
    if (device.status === 'paired' && services.joinCode) {
      writeLocal(SPENT_CODES_KEY, addSpentCode(parseSpentCodes(readLocal<unknown>(SPENT_CODES_KEY, [])), services.joinCode));
    }
  }, [device.status, services.joinCode]);
  const members = useMemo(() => (state ? memberOrder(state.members).map((id) => state.members[id]) : []), [state]);
  const isSolo = members.length <= 1;
  const session = state?.activeSession ?? null;

  // The catalog follows the household's plans.
  const serviceKey = state ? subscribedServices(state.settings.plans).join(',') : '';
  useEffect(() => {
    if (device.status !== 'paired' || !state) return;
    void catalogs.load(serviceKey ? serviceKey.split(',') : []).catch(() => {});
  }, [device.status, serviceKey, !!state, catalogs]); // eslint-disable-line react-hooks/exhaustive-deps
  const retryCatalog = useCallback(() => {
    void catalogs.load(serviceKey ? serviceKey.split(',') : []).catch(() => {});
  }, [catalogs, serviceKey]);
  const ensureCatalog = useCallback(async (): Promise<Catalog> => {
    if (!serviceKey) return EMPTY_CATALOG;
    try {
      return await catalogs.load(serviceKey.split(','));
    } catch {
      return catalogs.get().catalog ?? EMPTY_CATALOG;
    }
  }, [catalogs, serviceKey]);

  const items = useMemo(() => new Map((catalog?.items ?? []).map((i) => [i.id, i])), [catalog]);
  const itemById = useCallback((id: string): CatalogItem | undefined => items.get(id), [items]);

  // Titles for ids that may not be in the catalog: anything saved with a snapshot, or picked as a favourite.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    if (!state) return m;
    for (const p of Object.values(state.profiles)) for (const f of p.favorites) m.set(f.id, f.title);
    for (const per of Object.values(state.seen)) for (const [id, e] of Object.entries(per)) if (e.snapshot) m.set(id, e.snapshot.title);
    for (const w of state.watchlist) m.set(w.itemId, w.snapshot.title);
    for (const p of state.picks) m.set(p.itemId, p.snapshot.title);
    return m;
  }, [state]);
  const titleOf = useCallback((id: string) => items.get(id)?.title ?? names.get(id) ?? id, [items, names]);

  const toast = useCallback((text: string, action?: ToastAction) => {
    const id = Date.now();
    setToastMsg({ id, text, action });
    window.setTimeout(() => setToastMsg((t) => (t && t.id === id ? null : t)), action ? 6500 : 3200);
  }, []);

  // Leaving the household clears the local flow.
  useEffect(() => {
    if (device.status !== 'paired') {
      setSolo(null);
      setMatchIdx(null);
      setOnboardFor(null);
      setTab('tonight');
      setSessionLeft(false);
    }
  }, [device.status]);

  // Match moments: show any match this phone has not shown yet; drop the screen if the session goes away.
  useEffect(() => {
    if (!me || !inSession(session, me)) {
      if (matchIdx !== null) setMatchIdx(null);
      return;
    }
    if (matchIdx !== null) return;
    const i = nextUnshownMatch(session, readLocal<number>(matchKey(session.id), 0));
    if (i >= 0) setMatchIdx(i);
  }, [session, me, matchIdx]);

  // Tell the person when someone ends the session.
  const wasIn = useRef<string | null>(null);
  useEffect(() => {
    if (!me) return;
    const nowIn = inSession(session, me) ? session.id : null;
    if (wasIn.current && !nowIn) {
      toast('The Together session ended.');
      setSessionLeft(false);
    }
    wasIn.current = nowIn;
  }, [session, me, toast]);

  const engineCtx = useCallback(
    (): EngineContext => ({
      catalog: catalog ?? EMPTY_CATALOG,
      state: sync.getState() ?? (state as NonNullable<typeof state>),
      today: todayLocal(),
    }),
    [catalog, sync, state],
  );

  const perform = useCallback(
    async (a: PerformArgs) => {
      const st = sync.getState();
      const meNow = sync.getDevice().memberId;
      if (!st || !meNow) return;
      const { item, action, who, sessionId } = a;
      const snapshot = snapshotOf(item);
      // Alone: the chosen person. A group: only this phone's person (what you do with a card is yours).
      const actors: MemberId[] = who.length === 1 ? who : [meNow];
      const cat = catalogs.get().catalog ?? EMPTY_CATALOG;
      try {
        if (sessionId) await sync.swipeInSession(sessionId, meNow, item.id, action === 'yes', snapshot);
        switch (action) {
          case 'yes':
            // Solo yes: onto the Matches tab. No screen change; the deck carries on.
            if (!sessionId) await sync.addPick({ kind: 'solo', who: normalizeWho(who), itemId: item.id, snapshot, pick: a.pick, service: a.service });
            break;
          case 'not-tonight':
            for (const p of actors) await sync.setNotTonight(p, item.id, todayLocal());
            break;
          case 'seen':
            for (const p of actors) await sync.markWatched(p, [{ itemId: item.id, source: 'manual', snapshot }]);
            break;
          case 'save':
            await sync.addToWatchlist(a.list ?? (who.length > 1 ? 'ours' : who[0]), item.id, meNow, snapshot);
            break;
          case 'never':
            for (const p of actors) await sync.setNever(p, item.id, true);
            break;
        }
        for (const p of actors) {
          const latest = sync.getState();
          if (!latest || !latest.profiles[p]) break;
          await sync.saveProfile(engine.learnFromSwipe(latest.profiles[p], item, action, cat));
        }
      } catch {
        toast('Something did not save. Please try that again.');
      }
    },
    [sync, engine, catalogs, toast],
  );

  const goTab = useCallback((t: Tab) => setTab(t), []);

  const followUpsShown = useCallback((keys: string[]) => {
    setShownKeys((prev) => {
      const next = [...new Set([...prev, ...keys])].slice(-400);
      if (next.length === prev.length && next.every((k, i) => k === prev[i])) return prev;
      writeLocal(SHOWN_KEY, next);
      return next;
    });
  }, []);

  // The dot on the New tab: follow-ups for me (or for everyone together) that this phone has not displayed yet.
  const followUpKeys = useMemo(() => {
    if (!state || !me || device.status !== 'paired' || !catalog || !state.profiles[me]) return [] as string[];
    try {
      const ctx = engineCtx();
      return engine.followUps([me], ctx).map((f) => f.key);
    } catch {
      return [] as string[];
    }
    // Recomputed only when the shared data (or catalog) changes, not on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, me, device.status, engine, catalog]);
  const newDot = useMemo(() => {
    const seenKeys = new Set(shownKeys);
    return followUpKeys.some((k) => !seenKeys.has(k));
  }, [followUpKeys, shownKeys]);

  // ---- not ready yet ------------------------------------------------------
  if (device.status === 'loading') return <Shell><Splash message={'Starting up…'} /></Shell>;
  if (device.status === 'unpaired' || !me) {
    return (
      <Shell>
        <Setup
          services={{ ...services, joinCode: usableAddressCode(services.joinCode, parseSpentCodes(readLocal<unknown>(SPENT_CODES_KEY, []))) }}
          device={device}
        />
      </Shell>
    );
  }
  if (!state) return <Shell><Splash message={'Loading your shared lists…'} /></Shell>;
  if (!state.profiles[me] || !state.members[me]) return <Shell><Splash message={'Loading your shared lists…'} /></Shell>;

  const value: AppCtxValue = {
    services,
    state,
    device,
    me,
    members,
    isSolo,
    catalog,
    catalogState,
    ensureCatalog,
    retryCatalog,
    engineCtx,
    itemById,
    titleOf,
    perform,
    toast,
    followUpsShown,
    startOnboarding: setOnboardFor,
    goTab,
    solo,
    setSolo,
    joinDismissed,
    sessionLeft,
    setSessionLeft,
  };

  const needsWizard = !state.profiles[me].onboarded;

  const matchShown =
    matchIdx !== null && inSession(session, me) && session.matches[matchIdx] ? session.matches[matchIdx] : null;
  const dismissMatch = () => {
    if (session && matchIdx !== null) writeLocal(matchKey(session.id), matchIdx + 1);
    setMatchIdx(null);
  };

  const showJoinBanner = !needsWizard && needsToJoin(session, me) && joinDismissed !== session.id;

  return (
    <AppCtx.Provider value={value}>
      <Shell>
        {needsWizard ? (
          <Wizard />
        ) : onboardFor && state.members[onboardFor] ? (
          <Onboarding memberId={onboardFor} onClose={() => setOnboardFor(null)} />
        ) : (
          <>
            <main className="app-main">
              {tab === 'tonight' && <Tonight />}
              {tab === 'new' && <NewFeed />}
              {tab === 'watchlist' && <Watchlist />}
              {tab === 'matches' && <Matches />}
              {tab === 'history' && <History />}
              {tab === 'us' && <Us />}
            </main>
            <nav className="tabbar" data-testid="tabbar" aria-label="Main">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tab === t.id ? 'on' : ''}
                  aria-current={tab === t.id ? 'page' : undefined}
                  data-testid={`tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                >
                  <span className="tab-icon">
                    {t.icon}
                    {t.id === 'new' && newDot && <i className="tab-dot" data-testid="new-dot" aria-label="New follow-ups" />}
                  </span>
                  <span>{t.label}</span>
                </button>
              ))}
            </nav>
          </>
        )}

        {showJoinBanner && session && <JoinCard session={session} onDismiss={() => setJoinDismissed(session.id)} />}

        {matchShown && session && (
          <MatchScreen
            item={itemById(matchShown.itemId)}
            card={session.deck.find((c) => c.itemId === matchShown.itemId)}
            audienceSize={session.request.who.length}
            onKeep={() => {
              dismissMatch();
              setSessionLeft(false);
              setTab('tonight');
            }}
            onWatching={() => {
              const id = session.id;
              dismissMatch();
              setSolo(null);
              setTab('tonight');
              sync.endSession(id).catch(() => toast('Could not end the session. Please try again.'));
            }}
          />
        )}

        {device.error && (
          <div className="floating-wrap">
            <DeviceErrorBanner device={device} />
          </div>
        )}
        {toastMsg && (
          <div className="toast" role="status" data-testid="toast">
            <span data-testid="toast-text">{toastMsg.text}</span>
            {toastMsg.action && (
              <button
                type="button"
                className="toast-action"
                data-testid="toast-action"
                onClick={() => {
                  const act = toastMsg.action;
                  setToastMsg(null);
                  act?.onClick();
                }}
              >
                {toastMsg.action.label}
              </button>
            )}
          </div>
        )}
      </Shell>
    </AppCtx.Provider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app" style={{ ['--bg' as string]: THEME_BACKGROUND, ['--accent' as string]: THEME_ACCENT }}>
      {children}
    </div>
  );
}
