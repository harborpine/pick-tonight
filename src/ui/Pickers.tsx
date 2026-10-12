import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  GENRES,
  MAX_FAVORITES,
  SERVICES,
  subscribedServices,
  type Dealbreakers,
  type FavoriteTitle,
  type GenreId,
  type MemberId,
  type PlanSelection,
  type ServiceDef,
  type TitleIndex,
  type TitleIndexEntry,
  type Who,
} from '../contracts';
import { Chip, Icon, Poster } from './components';
import { useApp } from './context';
import { namesOf, toggleWho } from './helpers';

/** Scroll a focused field into view once the on-screen keyboard has opened. */
export function keepVisible(e: { currentTarget: HTMLElement }) {
  const el = e.currentTarget;
  window.setTimeout(() => el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 320);
}

// ---------------------------------------------------------------------------
// Catalog gate: calm loading / retry / "choose your services" states
// ---------------------------------------------------------------------------

export function CatalogGate({ children, onSettings }: { children: ReactNode; onSettings?: () => void }) {
  const { state, catalog, catalogState, retryCatalog, goTab } = useApp();
  const hasServices = subscribedServices(state.settings.plans).length > 0;
  if (!hasServices) {
    return (
      <div className="gate" data-testid="catalog-no-services">
        <div className="empty-emoji">{'📺'}</div>
        <h2>Choose your streaming services</h2>
        <p>We only suggest things you can watch right now, so we need to know which services you have.</p>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          data-testid="catalog-choose-services"
          onClick={() => {
            if (onSettings) onSettings();
            else goTab('us');
          }}
        >
          Choose services
        </button>
      </div>
    );
  }
  if (!catalog) {
    if (catalogState.status === 'error') {
      return (
        <div className="gate" data-testid="catalog-error" role="alert">
          <div className="empty-emoji">{'📡'}</div>
          <h2>Couldn’t load the titles</h2>
          <p>{catalogState.error ?? 'Check your internet connection and try again.'}</p>
          <button type="button" className="btn btn-primary btn-lg" data-testid="catalog-retry" onClick={retryCatalog}>
            Try again
          </button>
        </div>
      );
    }
    return (
      <div className="gate" data-testid="catalog-loading" role="status">
        <div className="spinner" />
        <p>Getting today’s titles for your services…</p>
      </div>
    );
  }
  return (
    <>
      {catalogState.status === 'error' && (
        <div className="notice error" data-testid="catalog-stale" role="alert">
          <p>Couldn’t refresh the titles, so you’re seeing the last ones we had.</p>
          <button type="button" className="btn btn-ghost" data-testid="catalog-retry" onClick={retryCatalog}>
            Try again
          </button>
        </div>
      )}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// Who's watching: member chips
// ---------------------------------------------------------------------------

export function WhoPicker({ who, onChange }: { who: Who; onChange: (w: Who) => void }) {
  const { members, me, isSolo } = useApp();
  if (isSolo) return null;
  const all = members.map((m) => m.id);
  const everyone = all.length >= 3 && all.every((id) => who.includes(id));
  return (
    <div className="chip-row wrap" data-testid="who-picker">
      {members.map((m) => (
        <Chip
          key={m.id}
          selected={who.includes(m.id)}
          testId={`who-${m.id}`}
          onClick={() => onChange(toggleWho(who, m.id, me))}
        >
          <span data-member-id={m.id}>{m.id === me ? `${m.name} (me)` : m.name}</span>
        </Chip>
      ))}
      {all.length >= 3 && (
        <Chip selected={everyone} testId="who-everyone" onClick={() => onChange([...all].sort())}>
          Everyone
        </Chip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Services & plans
// ---------------------------------------------------------------------------

const planBadgeText = (adFree: boolean) => (adFree ? 'Ad-free' : 'Ads');

export function ServicesPicker({ plans, onChange }: { plans: PlanSelection; onChange: (next: PlanSelection) => void }) {
  const [query, setQuery] = useState('');
  // Services switched on whose plan has not been chosen yet.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const list = useMemo(() => SERVICES.filter((s) => !q || s.name.toLowerCase().includes(q)), [q]);
  const validPlan = (s: ServiceDef) => {
    const p = plans[s.id];
    return p != null && s.plans.some((d) => d.id === p);
  };

  const toggle = (s: ServiceDef) => {
    if (validPlan(s)) {
      onChange({ ...plans, [s.id]: null });
      return;
    }
    if (pending.has(s.id)) {
      setPending((p) => {
        const n = new Set(p);
        n.delete(s.id);
        return n;
      });
      return;
    }
    if (s.plans.length === 1) onChange({ ...plans, [s.id]: s.plans[0].id });
    else setPending((p) => new Set(p).add(s.id));
  };
  const choose = (s: ServiceDef, planId: string) => {
    setPending((p) => {
      const n = new Set(p);
      n.delete(s.id);
      return n;
    });
    onChange({ ...plans, [s.id]: planId });
  };

  return (
    <div className="services-picker" data-testid="services-picker">
      <div className="search-box">
        {Icon.search}
        <input
          type="search"
          inputMode="search"
          placeholder="Search services"
          aria-label="Search services"
          data-testid="service-search"
          value={query}
          onFocus={keepVisible}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {list.length === 0 && (
        <p className="hint" data-testid="service-none">
          No service called “{query.trim()}”.
        </p>
      )}
      <ul className="svc-list">
        {list.map((s) => {
          const on = validPlan(s);
          const open = on || pending.has(s.id);
          return (
            <li key={s.id} className={`svc ${open ? 'open' : ''}`} data-testid={`service-${s.id}`} data-service-id={s.id} data-on={on}>
              <button
                type="button"
                className="svc-head"
                aria-pressed={open}
                data-testid={`service-toggle-${s.id}`}
                onClick={() => toggle(s)}
              >
                <span className="svc-name">{s.name}</span>
                <span className={`switch ${open ? 'on' : ''}`}>
                  <span />
                </span>
              </button>
              {open && s.plans.length > 1 && (
                <div className="svc-plans">
                  {!on && <p className="hint tight">Which plan do you have?</p>}
                  <div className="chip-row wrap">
                    {s.plans.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`chip chip-small plan-chip ${plans[s.id] === p.id ? 'chip-on' : ''}`}
                        aria-pressed={plans[s.id] === p.id}
                        data-selected={plans[s.id] === p.id}
                        data-testid={`plan-${s.id}-${p.id}`}
                        data-adfree={p.adFree}
                        onClick={() => choose(s, p.id)}
                      >
                        {p.label}
                        {p.label.toLowerCase().replace(/[^a-z-]/g, '') !== planBadgeText(p.adFree).toLowerCase() && (
                          <small className={`plan-badge ${p.adFree ? 'adfree' : 'ads'}`}>{planBadgeText(p.adFree)}</small>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Title search (shared by favourites)
// ---------------------------------------------------------------------------

export function useTitleIndex() {
  const { services } = useApp();
  const [index, setIndex] = useState<TitleIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const load = () => {
    setLoading(true);
    setError(null);
    services
      .loadTitleIndex()
      .then(setIndex)
      .catch((e: unknown) =>
        setError(e instanceof Error && e.message ? e.message : 'Couldn’t load the title list. Check your internet connection and try again.'),
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { index, loading, error, retry: load };
}

export function toFavorite(e: TitleIndexEntry): FavoriteTitle {
  return { id: e.id, kind: e.kind, title: e.title, year: e.year, genres: e.genres, keywords: e.keywords, poster: e.poster ?? null };
}

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

export function FavoritesEditor({ favorites, onChange }: { favorites: FavoriteTitle[]; onChange: (next: FavoriteTitle[]) => void }) {
  const { services } = useApp();
  const { engine } = services;
  const { index, loading, error, retry } = useTitleIndex();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), 220);
    return () => window.clearTimeout(t);
  }, [text]);

  const typed = query.trim().length >= 2;
  const results = useMemo(() => {
    if (!index || !typed) return [];
    try {
      return engine.searchTitles(query, index, 20);
    } catch {
      return [];
    }
  }, [engine, index, query, typed]);
  const have = new Set(favorites.map((f) => f.id));
  const full = favorites.length >= MAX_FAVORITES;

  return (
    <div className="fav-editor" data-testid="fav-editor">
      <p className="hint tight" data-testid="fav-count">
        {favorites.length === 0 ? 'None yet.' : `${favorites.length} picked`}
        {full ? ` — that’s the most you can keep (${MAX_FAVORITES}).` : ''}
      </p>
      {favorites.length > 0 && (
        <div className="fav-list" data-testid="profile-favorites">
          {favorites.map((f) => (
            <span key={f.id} className="fav fav-chip" data-item-id={f.id} data-testid="fav-chip">
              {f.title}
              <button
                type="button"
                className="fav-x"
                aria-label={`Remove ${f.title}`}
                data-testid="fav-remove"
                data-item-id={f.id}
                onClick={() => onChange(favorites.filter((x) => x.id !== f.id))}
              >
                {Icon.close}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="search-box">
        {Icon.search}
        <input
          type="search"
          inputMode="search"
          placeholder="Search for a movie or show you love"
          aria-label="Search for a favourite"
          data-testid="fav-search"
          value={text}
          onFocus={keepVisible}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {loading && (
        <div className="inline-status" data-testid="fav-loading" role="status">
          <div className="spinner" />
          <span>Loading the title list…</span>
        </div>
      )}
      {error && (
        <div className="notice error" data-testid="fav-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost" data-testid="fav-retry" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {index && !typed && <p className="hint">Type at least two letters. Anything counts, even if it isn’t on your services.</p>}
      {index && typed && results.length === 0 && (
        <p className="hint" data-testid="fav-none">
          Nothing found for “{query.trim()}”. Try a different spelling.
        </p>
      )}
      <ul className="rows add-results">
        {results.map((r) => {
          const done = have.has(r.id);
          return (
            <li key={r.id}>
              <button
                type="button"
                className="row"
                data-testid="fav-result"
                data-item-id={r.id}
                data-added={done}
                disabled={done || full}
                onClick={() => onChange([...favorites, toFavorite(r)])}
              >
                <Poster title={r.title} poster={r.poster ?? null} size="w185" compact className="row-poster small" />
                <span className="row-body">
                  <span className="row-title">{r.title}</span>
                  <span className="row-sub">
                    {r.year || ''}
                    {r.kind === 'tv' ? ' • Series' : ' • Movie'}
                  </span>
                </span>
                <span className={`add-state ${done ? 'done' : ''}`}>{done ? 'Added' : 'Add'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Never show me
// ---------------------------------------------------------------------------

const TOGGLES: { key: 'horror' | 'trueCrime' | 'scary' | 'subtitled'; label: string }[] = [
  { key: 'horror', label: 'Horror' },
  { key: 'trueCrime', label: 'True crime' },
  { key: 'scary', label: 'Anything scary' },
  { key: 'subtitled', label: 'Not in English (subtitled)' },
];

export function NeverEditor({ value, onChange }: { value: Dealbreakers; onChange: (next: Dealbreakers) => void }) {
  const genres = (Object.keys(GENRES) as GenreId[]).filter((g) => g !== 'horror');
  return (
    <div className="never-editor" data-testid="never-editor">
      {TOGGLES.map((d) => {
        const on = value[d.key];
        return (
          <button
            key={d.key}
            type="button"
            role="switch"
            aria-checked={on}
            className="switch-row"
            data-testid={`dealbreaker-${d.key}`}
            data-on={on}
            onClick={() => onChange({ ...value, [d.key]: !on })}
          >
            <span>{d.label}</span>
            <span className={`switch ${on ? 'on' : ''}`}>
              <span />
            </span>
          </button>
        );
      })}
      <h3 className="sub-h">Rule out whole genres</h3>
      <div className="chip-row wrap" data-testid="dealbreaker-genres">
        {genres.map((g) => {
          const on = value.genres.includes(g);
          return (
            <Chip
              key={g}
              small
              selected={on}
              testId={`dealbreaker-genre-${g}`}
              onClick={() => onChange({ ...value, genres: on ? value.genres.filter((x) => x !== g) : [...value.genres, g] })}
            >
              {GENRES[g]}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}

/** Names of members as a sentence helper for pages. */
export function memberNames(members: { id: MemberId; name: string }[], ids: MemberId[]): string[] {
  return namesOf(Object.fromEntries(members.map((m) => [m.id, m])), ids);
}
