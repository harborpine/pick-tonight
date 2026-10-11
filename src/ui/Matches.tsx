import { useState } from 'react';
import type { PickEntry } from '../contracts';
import { AdBadge, Header, Poster, Segmented, ServiceLine, Sheet } from './components';
import { useApp } from './context';
import {
  filterPicks,
  formatDate,
  otherPerson,
  pickLabel,
  pickText,
  pickWatchers,
  serviceName,
  watchedButtonText,
  type MatchesFilter,
} from './helpers';

/** The Matches tab: every solo right-swipe and every Together match, newest first. */
export function Matches() {
  const { services, state, me, itemById } = useApp();
  const { engine } = services;
  const other = otherPerson(me);
  const [filter, setFilter] = useState<MatchesFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = filterPicks(state.picks, filter, me);
  const open = openId ? state.picks.find((p) => p.id === openId) ?? null : null;

  return (
    <div className="screen with-tabs scroll" data-testid="matches">
      <Header title="Matches" subtitle="Everything you liked, ready to watch" />
      <Segmented
        testPrefix="matches-filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'mine', label: 'Mine' },
          { value: other, label: other },
          { value: 'together', label: 'Together' },
        ]}
      />
      {rows.length === 0 ? (
        <p className="empty-note" data-testid="matches-empty">
          {state.picks.length === 0
            ? 'Nothing here yet. When you swipe right on something, or you and your partner both say yes in Together, it lands here with where to watch it.'
            : 'Nothing in this view yet.'}
        </p>
      ) : (
        <ul className="rows">
          {rows.map((p) => {
            const item = itemById(p.itemId);
            const svc = item ? engine.chooseService(item, state.settings.plans) : null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="row"
                  data-testid="match-row"
                  data-kind={p.kind}
                  data-item-id={p.itemId}
                  data-pick-id={p.id}
                  onClick={() => setOpenId(p.id)}
                >
                  <Poster title={p.snapshot.title} poster={item?.poster ?? p.snapshot.poster} size="w185" compact className="row-poster" />
                  <span className="row-body">
                    <span className="row-title" data-testid="match-title">{p.snapshot.title}</span>
                    <span className="row-sub">
                      <span data-testid="match-year">{p.snapshot.year}</span> {'•'}{' '}
                      <span className={`tag ${p.kind === 'match' ? 'tag-new' : 'tag-solo'}`} data-testid="match-label">{pickLabel(p)}</span>
                    </span>
                    <span className="row-sub" data-testid="match-pick">{pickText(p.pick)}</span>
                    <span className="row-sub" data-testid="match-where">
                      {svc ? (
                        <>
                          {serviceName(svc.serviceId)} <AdBadge service={svc} testId="match-ad-badge" />
                        </>
                      ) : (
                        'No longer on your services'
                      )}
                    </span>
                    <span className="row-sub faint" data-testid="match-date">{formatDate(p.at)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <MatchDetail pick={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** Where-to-watch details for one pick, with "I watched this" and "Remove". */
function MatchDetail({ pick, onClose }: { pick: PickEntry; onClose: () => void }) {
  const { services, state, me, itemById, toast } = useApp();
  const { engine, sync } = services;
  const [busy, setBusy] = useState(false);
  const item = itemById(pick.itemId);
  const svc = item ? engine.chooseService(item, state.settings.plans) : null;

  const watched = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const snapshot = { title: pick.snapshot.title, year: pick.snapshot.year, poster: item?.poster ?? pick.snapshot.poster };
      for (const person of pickWatchers(pick)) {
        await sync.markWatched(person, [{ itemId: pick.itemId, source: 'manual', snapshot }]);
      }
      await sync.removePick(pick.id);
      toast('Moved to History');
      onClose();
    } catch {
      toast('Could not save that. Please try again.');
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sync.removePick(pick.id);
      onClose();
    } catch {
      toast('Could not remove that. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Sheet testId="match-detail" onClose={onClose}>
      <div className="detail" data-item-id={pick.itemId} data-pick-id={pick.id}>
        <Poster title={pick.snapshot.title} year={pick.snapshot.year} poster={item?.poster ?? pick.snapshot.poster} size="w342" className="detail-poster" />
        <div className="detail-body">
          <h3 data-testid="detail-title">{pick.snapshot.title}</h3>
          <p className="row-sub">
            {pick.snapshot.year} {'•'} <span data-testid="detail-label">{pickLabel(pick)}</span>
          </p>
          <p className="detail-what" data-testid="detail-pick">{pickText(pick.pick)}</p>
          <p className="detail-where" data-testid="detail-where">
            {svc ? (
              <ServiceLine service={svc} prefix="detail-service" />
            ) : (
              <span className="muted" data-testid="detail-unavailable">No longer on your services</span>
            )}
          </p>
          <p className="row-sub faint" data-testid="detail-date">{formatDate(pick.at)}</p>
        </div>
      </div>
      {item && <p className="detail-overview">{item.overview}</p>}
      <div className="sheet-options">
        <button type="button" className="sheet-option primary" data-testid="match-watched" disabled={busy} onClick={watched}>
          {watchedButtonText(pick, me)}
        </button>
        <button type="button" className="sheet-option danger" data-testid="match-remove" disabled={busy} onClick={remove}>
          Remove
        </button>
        <button type="button" className="sheet-option" data-testid="match-close" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}
