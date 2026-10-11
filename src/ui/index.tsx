import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppProps, CatalogItem, EngineContext, PersonId } from '../contracts';
import { THEME_ACCENT, THEME_BACKGROUND } from '../config';
import { Icon } from './components';
import {
  AppCtx,
  readLocal,
  useSyncData,
  writeLocal,
  type AppCtxValue,
  type PerformArgs,
  type SoloFlow,
  type Tab,
  type ToastAction,
} from './context';
import { inSession, needsToJoin, nextUnshownMatch, snapshotOf, todayLocal } from './helpers';
import { History } from './History';
import { Watchlist } from './Lists';
import { Matches } from './Matches';
import { NewFeed } from './NewFeed';
import { Onboarding } from './Onboarding';
import { JoinCard, MatchScreen } from './Overlays';
import { Setup, Splash } from './Setup';
import { Tonight } from './Tonight';
import { Us } from './Us';
import './styles.css';

declare global {
  interface Window {
    /** Dev/debug hook (dev server or ?debug=1): the live services, so a second "phone" can be simulated. */
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

const SHOWN_KEY = 'wtw.ui.followups.shown.v1';
const matchKey = (sessionId: string) => `wtw.ui.matchShown.${sessionId}`;

function debugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    if (new URLSearchParams(location.search).get('debug') === '1') {
      sessionStorage.setItem('wtw.debug', '1');
      return true;
    }
    return sessionStorage.getItem('wtw.debug') === '1';
  } catch {
    return false;
  }
}

export function App({ services }: AppProps) {
  const { catalog, engine, sync } = services;
  const { device, state } = useSyncData(sync);

  const [tab, setTab] = useState<Tab>('tonight');
  const [solo, setSolo] = useState<SoloFlow | null>(null);
  const [sessionLeft, setSessionLeft] = useState(false);
  const [onboardFor, setOnboardFor] = useState<PersonId | null>(null);
  const [onboardDismissed, setOnboardDismissed] = useState(false);
  const [matchIdx, setMatchIdx] = useState<number | null>(null);
  const [joinDismissed, setJoinDismissed] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ id: number; text: string; action?: ToastAction } | null>(null);
  const [shownKeys, setShownKeys] = useState<string[]>(() => readLocal<string[]>(SHOWN_KEY, []));

  // Dev / QA hook.
  useEffect(() => {
    if (debugEnabled()) window.__wtw = services;
  }, [services]);

  const items = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog]);
  const refs = useMemo(() => new Map(catalog.tasteRefs.map((i) => [i.id, i])), [catalog]);
  const itemById = useCallback((id: string): CatalogItem | undefined => items.get(id), [items]);
  const titleOf = useCallback((id: string) => items.get(id)?.title ?? refs.get(id)?.title ?? id, [items, refs]);

  const toast = useCallback((text: string, action?: ToastAction) => {
    const id = Date.now();
    setToastMsg({ id, text, action });
    window.setTimeout(() => setToastMsg((t) => (t && t.id === id ? null : t)), action ? 6500 : 3200);
  }, []);

  const me: PersonId | null = device.person;
  const session = state?.activeSession ?? null;

  // Leaving the household clears the local flow.
  useEffect(() => {
    if (device.status !== 'paired') {
      setSolo(null);
      setMatchIdx(null);
      setOnboardFor(null);
      setOnboardDismissed(false);
      setTab('tonight');
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

  // Tell the person when the other phone ends the session.
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
    (): EngineContext => ({ catalog, state: sync.getState() ?? (state as NonNullable<typeof state>), today: todayLocal() }),
    [catalog, sync, state],
  );

  const perform = useCallback(
    async (a: PerformArgs) => {
      const st = sync.getState();
      const meNow = sync.getDevice().person;
      if (!st || !meNow) return;
      const { item, action, who, sessionId } = a;
      const snapshot = snapshotOf(item);
      // Solo: the chosen person. Together: only this phone's person.
      const actors: PersonId[] = who === 'Together' ? [meNow] : [who];
      try {
        if (sessionId) await sync.swipeInSession(sessionId, meNow, item.id, action === 'yes', snapshot);
        switch (action) {
          case 'yes':
            // Solo yes: onto the Matches tab. No screen change; the deck carries on.
            if (!sessionId) await sync.addPick({ kind: 'solo', who, itemId: item.id, snapshot, pick: a.pick, service: a.service });
            break;
          case 'not-tonight':
            for (const p of actors) await sync.setNotTonight(p, item.id, todayLocal());
            break;
          case 'seen':
            for (const p of actors) await sync.markWatched(p, [{ itemId: item.id, source: 'manual', snapshot }]);
            break;
          case 'save':
            await sync.addToWatchlist(a.list ?? (who === 'Together' ? 'ours' : who), item.id, meNow, snapshot);
            break;
          case 'never':
            for (const p of actors) await sync.setNever(p, item.id, true);
            break;
        }
        for (const p of actors) {
          const latest = sync.getState();
          if (!latest) break;
          await sync.saveProfile(engine.learnFromSwipe(latest.profiles[p], item, action, catalog));
        }
      } catch {
        toast('Something did not save. Please try that again.');
      }
    },
    [sync, engine, catalog, toast],
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

  // The dot on the New tab: follow-ups for me or Together that this phone has not displayed yet.
  const followUpKeys = useMemo(() => {
    if (!state || !me || device.status !== 'paired') return [] as string[];
    try {
      const ctx = engineCtx();
      return [...engine.followUps(me, ctx), ...engine.followUps('Together', ctx)].map((f) => f.key);
    } catch {
      return [] as string[];
    }
    // Recomputed only when the shared data (or who/engine) changes, not on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, me, device.status, engine]);
  const newDot = useMemo(() => {
    const seenKeys = new Set(shownKeys);
    return followUpKeys.some((k) => !seenKeys.has(k));
  }, [followUpKeys, shownKeys]);

  // ---- not ready yet ------------------------------------------------------
  if (device.status === 'loading') return <Shell><Splash message={'Starting up…'} /></Shell>;
  if (device.status === 'unpaired' || !me) {
    return (
      <Shell>
        <Setup services={services} device={device} />
      </Shell>
    );
  }
  if (!state) return <Shell><Splash message={'Loading your shared lists…'} /></Shell>;

  const value: AppCtxValue = {
    services,
    state,
    device,
    me,
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

  const onboardingPerson: PersonId | null = onboardFor ?? (!state.profiles[me].onboarded && !onboardDismissed ? me : null);

  const matchShown =
    matchIdx !== null && inSession(session, me) && session.matches[matchIdx] ? session.matches[matchIdx] : null;
  const dismissMatch = () => {
    if (session && matchIdx !== null) writeLocal(matchKey(session.id), matchIdx + 1);
    setMatchIdx(null);
  };

  const showJoinBanner = needsToJoin(session, me) && joinDismissed !== session.id;

  return (
    <AppCtx.Provider value={value}>
      <Shell>
        {onboardingPerson ? (
          <Onboarding
            person={onboardingPerson}
            onClose={() => {
              setOnboardFor(null);
              setOnboardDismissed(true);
            }}
          />
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
          <div className="notice error floating" data-testid="device-error">
            {device.error}
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
