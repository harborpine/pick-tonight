import { useState } from 'react';
import type { WatchlistEntry, WatchlistOwner } from '../contracts';
import { AdBadge, Header, Poster, Segmented, ServiceLine, Sheet } from './components';
import { useApp } from './context';
import { otherPerson, serviceName } from './helpers';

type WTab = 'mine' | 'hers' | 'ours';

export function Watchlist() {
  const { services, state, me, itemById, toast } = useApp();
  const { engine, sync } = services;
  const other = otherPerson(me);
  const [tab, setTab] = useState<WTab>('mine');
  const [open, setOpen] = useState<WatchlistEntry | null>(null);

  const listFor = (t: WTab): WatchlistOwner => (t === 'mine' ? me : t === 'hers' ? other : 'ours');
  const entries = state.watchlist.filter((w) => w.list === listFor(tab));

  const remove = async (e: WatchlistEntry) => {
    try {
      await sync.removeFromWatchlist(e.list, e.itemId);
      setOpen(null);
    } catch {
      toast('Could not remove that. Please try again.');
    }
  };
  const seen = async (e: WatchlistEntry) => {
    try {
      const who = e.list === 'ours' ? me : e.list;
      await sync.markWatched(who, [{ itemId: e.itemId, source: 'manual', snapshot: e.snapshot }]);
      await sync.removeFromWatchlist(e.list, e.itemId);
      setOpen(null);
    } catch {
      toast('Could not save that. Please try again.');
    }
  };

  const detailItem = open ? itemById(open.itemId) : undefined;
  const detailService = detailItem ? engine.chooseService(detailItem, state.settings.plans) : null;

  return (
    <div className="screen with-tabs scroll" data-testid="watchlist">
      <Header title="Watchlist" />
      <Segmented
        testPrefix="watchlist-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'mine', label: 'Mine' },
          { value: 'hers', label: other },
          { value: 'ours', label: 'Ours' },
        ]}
      />
      {entries.length === 0 ? (
        <p className="empty-note" data-testid="watchlist-empty">
          Nothing saved here yet. Tap Save on a card to keep something for later.
        </p>
      ) : (
        <ul className="rows">
          {entries.map((e) => {
            const item = itemById(e.itemId);
            const svc = item ? engine.chooseService(item, state.settings.plans) : null;
            return (
              <li key={`${e.list}-${e.itemId}`}>
                <button type="button" className="row" data-testid="watchlist-row" data-item-id={e.itemId} data-list={e.list} onClick={() => setOpen(e)}>
                  <Poster title={e.snapshot.title} poster={item?.poster ?? e.snapshot.poster} size="w185" compact className="row-poster" />
                  <span className="row-body">
                    <span className="row-title" data-testid="watchlist-title">{e.snapshot.title}</span>
                    <span className="row-sub">{e.snapshot.year}</span>
                    <span className="row-sub" data-testid="watchlist-where">
                      {svc ? (
                        <>
                          {serviceName(svc.serviceId)} <AdBadge service={svc} testId="watchlist-ad-badge" />
                        </>
                      ) : (
                        'No longer on your services'
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <Sheet testId="watchlist-detail" onClose={() => setOpen(null)}>
          <div className="detail">
            <Poster title={open.snapshot.title} year={open.snapshot.year} poster={detailItem?.poster ?? open.snapshot.poster} size="w342" className="detail-poster" />
            <div className="detail-body">
              <h3 data-testid="detail-title">{open.snapshot.title}</h3>
              <p className="row-sub">{open.snapshot.year}</p>
              <p className="detail-where" data-testid="detail-where">
                {detailService ? (
                  <ServiceLine service={detailService} prefix="detail-service" />
                ) : (
                  <span className="muted" data-testid="detail-unavailable">No longer on your services</span>
                )}
              </p>
            </div>
          </div>
          {detailItem && <p className="detail-overview">{detailItem.overview}</p>}
          <div className="sheet-options">
            <button type="button" className="sheet-option" data-testid="watchlist-seen" onClick={() => seen(open)}>
              Mark as seen
            </button>
            <button type="button" className="sheet-option danger" data-testid="watchlist-remove" onClick={() => remove(open)}>
              Remove from list
            </button>
            <button type="button" className="sheet-option" data-testid="watchlist-close" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
