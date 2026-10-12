import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { MemberId, SeenEntry, TitleIndex, TitleIndexEntry } from '../contracts';
import { Header, Icon, Poster, Segmented, Sheet } from './components';
import { useApp } from './context';
import { formatCount, formatDate, nameOf, seenSourceNote, sortSeen } from './helpers';

const PAGE = 50;

interface Row {
  id: string;
  at: number;
  title: string;
  year: number | null;
  poster: string | null;
  entry: SeenEntry;
}

/** The History tab: what a person has WATCHED (state.seen). Right-swipes and matches never appear here. */
export function History() {
  const { state, me, members, isSolo, itemById, titleOf, services, toast } = useApp();
  const { sync } = services;
  const [whoSel, setWhoSel] = useState<MemberId>(me);
  const person: MemberId = state.members[whoSel] ? whoSel : me;
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);

  const seen = state.seen[person] ?? {};
  const all = useMemo<Row[]>(
    () =>
      Object.entries(seen).map(([id, entry]) => {
        const item = itemById(id);
        return {
          id,
          at: entry.at,
          title: item?.title ?? entry.snapshot?.title ?? titleOf(id),
          year: item?.year ?? entry.snapshot?.year ?? null,
          poster: item?.poster ?? entry.snapshot?.poster ?? null,
          entry,
        };
      }),
    [seen, itemById, titleOf],
  );
  const rows = useMemo(() => sortSeen(all, deferred), [all, deferred]);

  // Back to the top of the list whenever the search or the person changes.
  useEffect(() => setShown(PAGE), [deferred, person]);

  const remove = async (r: Row) => {
    try {
      await sync.unmarkWatched(person, [r.id]);
      toast(`Removed “${r.title}”`, {
        label: 'Undo',
        onClick: () => {
          const snapshot = r.entry.snapshot ?? { title: r.title, year: r.year ?? 0, poster: r.poster };
          sync
            .markWatched(person, [{ itemId: r.id, at: r.entry.at, source: r.entry.source, plays: r.entry.plays, snapshot }])
            .catch(() => toast('Could not undo that. Please try again.'));
        },
      });
    } catch {
      toast('Could not remove that. Please try again.');
    }
  };

  return (
    <div className="screen with-tabs scroll" data-testid="history">
      <Header title="History" subtitle="What you have watched" />
      {!isSolo && (
        <Segmented
          testPrefix="history-person"
          value={person}
          onChange={setWhoSel}
          options={members.map((m) => ({ value: m.id, label: m.id === me ? `${m.name} (me)` : m.name, memberId: m.id }))}
        />
      )}
      <button type="button" className="btn btn-ghost btn-block add-watched" data-testid="history-add" onClick={() => setAdding(true)}>
        {Icon.plus}
        <span>Add something I&rsquo;ve watched</span>
      </button>
      <div className="search-box">
        {Icon.search}
        <input
          type="search"
          inputMode="search"
          placeholder={person === me ? 'Search your history' : `Search ${nameOf(state.members, person)}’s history`}
          aria-label="Search history"
          data-testid="history-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="hint tight" data-testid="history-favorites-note">
        Favourites on the profile page count as watched too. They are not listed here.
      </p>

      {all.length === 0 ? (
        <p className="empty-note" data-testid="history-empty">
          Nothing here yet. This fills up when you tap &ldquo;I watched this&rdquo; on a match, add a title with the button above, or import a watch history from your page in Us.
        </p>
      ) : rows.length === 0 ? (
        <p className="empty-note" data-testid="history-no-results">
          Nothing in this history matches &ldquo;{deferred.trim()}&rdquo;.
        </p>
      ) : (
        <>
          <p className="hint tight" data-testid="history-count">
            {formatCount(rows.length)} {rows.length === 1 ? 'title' : 'titles'}
            {deferred.trim() ? ' found' : ''}
          </p>
          <ul className="rows">
            {rows.slice(0, shown).map((r) => (
              <li key={r.id}>
                <div className="row static" data-testid="history-row" data-item-id={r.id} data-source={r.entry.source}>
                  <Poster title={r.title} poster={r.poster} size="w185" compact className="row-poster small" />
                  <span className="row-body">
                    <span className="row-title" data-testid="history-title">{r.title}</span>
                    <span className="row-sub">
                      {r.year ? <span data-testid="history-year">{r.year}</span> : null}
                      {r.year ? ' • ' : null}
                      <span data-testid="history-date">{formatDate(r.at)}</span>
                    </span>
                    <span className="row-sub" data-testid="history-source">{seenSourceNote(r.entry)}</span>
                  </span>
                  <button
                    type="button"
                    className="icon-btn row-remove"
                    aria-label={`Remove ${r.title} from History`}
                    data-testid="history-remove"
                    onClick={() => remove(r)}
                  >
                    {Icon.close}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {rows.length > shown && (
            <button type="button" className="btn btn-ghost btn-block" data-testid="history-show-more" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({formatCount(rows.length - shown)} left)
            </button>
          )}
        </>
      )}

      {adding && <AddSheet person={person} onClose={() => setAdding(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Add something I've watched"
// ---------------------------------------------------------------------------

function AddSheet({ person, onClose }: { person: MemberId; onClose: () => void }) {
  const { services, state, toast, me } = useApp();
  const { engine, sync } = services;
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<TitleIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const started = useRef(false);

  const loadIndex = () => {
    setLoading(true);
    setLoadError(null);
    services
      .loadTitleIndex()
      .then((ix) => setIndex(ix))
      .catch(() => setLoadError('Could not load the title list. Check your internet connection and try again.'))
      .finally(() => setLoading(false));
  };
  // Load the lookup the first time the sheet opens (it is a few MB, so never at startup).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadIndex();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce typing.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text), 220);
    return () => window.clearTimeout(t);
  }, [text]);

  const results = useMemo<TitleIndexEntry[]>(() => {
    if (!index || query.trim().length < 2) return [];
    try {
      return engine.searchTitles(query, index, 20);
    } catch {
      return [];
    }
  }, [engine, index, query]);

  const already = state.seen[person] ?? {};

  const add = async (e: TitleIndexEntry) => {
    try {
      await sync.markWatched(person, [{ itemId: e.id, source: 'manual', snapshot: { title: e.title, year: e.year, poster: e.poster ?? null } }]);
      setAdded((a) => new Set(a).add(e.id));
      toast(person === me ? 'Added to your History' : `Added to ${nameOf(state.members, person)}’s History`);
    } catch {
      toast('Could not save that. Please try again.');
    }
  };

  const typed = query.trim().length >= 2;
  return (
    <Sheet testId="history-add-sheet" title={person === me ? 'Add something I’ve watched' : `Add something ${nameOf(state.members, person)} has watched`} onClose={onClose}>
      <div className="search-box">
        {Icon.search}
        <input
          type="search"
          inputMode="search"
          autoFocus
          placeholder="Type a movie or show"
          aria-label="Search for a title"
          data-testid="history-add-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {loading && (
        <div className="inline-status" data-testid="history-add-loading">
          <div className="spinner" />
          <span>Loading the title list{'…'}</span>
        </div>
      )}
      {loadError && (
        <div className="notice error" data-testid="history-add-error">
          <p>{loadError}</p>
          <button type="button" className="btn btn-ghost" data-testid="history-add-retry" onClick={loadIndex}>
            Try again
          </button>
        </div>
      )}
      {index && !typed && <p className="hint">Type at least two letters to search.</p>}
      {index && typed && results.length === 0 && (
        <p className="hint" data-testid="history-add-none">
          Nothing found for &ldquo;{query.trim()}&rdquo;. Try a different spelling.
        </p>
      )}
      <ul className="rows add-results">
        {results.map((r) => {
          const done = added.has(r.id) || !!already[r.id];
          return (
            <li key={r.id}>
              <button
                type="button"
                className="row"
                data-testid="history-add-result"
                data-item-id={r.id}
                data-added={done}
                disabled={done}
                onClick={() => add(r)}
              >
                <Poster title={r.title} poster={r.poster ?? null} size="w185" compact className="row-poster small" />
                <span className="row-body">
                  <span className="row-title" data-testid="history-add-result-title">{r.title}</span>
                  <span className="row-sub">{r.year || ''}{r.kind === 'tv' ? ' • Series' : ' • Movie'}</span>
                </span>
                <span className={`add-state ${done ? 'done' : ''}`}>{done ? 'Added' : 'Add'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="sheet-option" data-testid="history-add-close" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
