import { useMemo, useState } from 'react';
import type { NewCard, SwipeAction, Who, WatchlistOwner } from '../contracts';
import { Header, Icon, Poster, Segmented, ServiceLine, Sheet } from './components';
import { useApp } from './context';
import { formatDate, formatMinutes, pickText, saveOptions } from './helpers';

const PAGE = 40;

export function NewFeed() {
  const { services, state, me, engineCtx, itemById, perform } = useApp();
  const { engine, newArrivals } = services;
  const [whoSel, setWhoSel] = useState<'me' | 'Together'>('me');
  const who: Who = whoSel === 'me' ? me : 'Together';
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [saveFor, setSaveFor] = useState<NewCard | null>(null);
  const [neverFor, setNeverFor] = useState<NewCard | null>(null);

  const ranked = useMemo(
    () => engine.rankNewArrivals(newArrivals, who, engineCtx()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, newArrivals, who, state.seen, state.never, state.notTonight, state.profiles, state.settings],
  );
  const rows = ranked.filter((c) => !hidden.has(`${c.arrival.itemId}-${c.arrival.season ?? ''}`));
  const keyOf = (c: NewCard) => `${c.arrival.itemId}-${c.arrival.season ?? ''}`;

  const act = (c: NewCard, action: SwipeAction, list?: WatchlistOwner) => {
    const item = itemById(c.itemId);
    if (!item) return;
    setHidden((h) => new Set(h).add(keyOf(c)));
    void perform({ item, pick: c.pick, service: c.service, action, who, list });
  };

  const save = saveOptions(me, who);

  return (
    <div className="screen with-tabs scroll" data-testid="new-feed">
      <Header title="New on our services" subtitle="Ranked by what we like" />
      <Segmented
        testPrefix="new-who"
        value={whoSel}
        onChange={setWhoSel}
        options={[
          { value: 'me', label: `Me (${me})` },
          { value: 'Together', label: 'Together' },
        ]}
      />
      {rows.length === 0 ? (
        <p className="empty-note" data-testid="new-empty">
          Nothing new for {whoSel === 'me' ? 'you' : 'both of you'} right now. Check back after the next daily update.
        </p>
      ) : (
        <ul className="rows new-rows">
          {rows.slice(0, shown).map((c) => {
            const item = itemById(c.itemId);
            if (!item) return null;
            const label = c.arrival.type === 'season' ? `New season${c.arrival.season ? ` ${c.arrival.season}` : ''}` : 'New';
            return (
              <li key={keyOf(c)}>
                <div className="row static newrow" data-testid="new-row" data-item-id={c.itemId} data-type={c.arrival.type}>
                  <div className="newrow-top">
                    <Poster title={item.title} year={item.year} poster={item.poster} size="w185" compact className="row-poster" />
                    <span className="row-body">
                      <span className="row-title" data-testid="new-title">{item.title}</span>
                      <span className="row-sub">
                        <span className={`tag ${c.arrival.type === 'season' ? 'tag-season' : 'tag-new'}`} data-testid="new-label">{label}</span>{' '}
                        <span data-testid="new-date">{formatDate(c.arrival.date)}</span> {'•'} {item.year} {'•'} {formatMinutes(c.minutes)}
                      </span>
                      <span className="row-sub" data-testid="new-pick">{pickText(c.pick)}</span>
                      <span className="row-sub"><ServiceLine service={c.service} prefix="new-service" /></span>
                      {c.reasons[0] && <span className="row-reason">{c.reasons[0]}</span>}
                    </span>
                  </div>
                  <div className="mini-actions">
                    <button type="button" className="mini mini-yes" data-testid="new-yes" onClick={() => act(c, 'yes')}>
                      {Icon.heart}
                      <span>Yes</span>
                    </button>
                    <button type="button" className="mini" data-testid="new-not-tonight" onClick={() => act(c, 'not-tonight')}>
                      {Icon.close}
                      <span>Not tonight</span>
                    </button>
                    <button type="button" className="mini" data-testid="new-seen" onClick={() => act(c, 'seen')}>
                      {Icon.eye}
                      <span>Seen</span>
                    </button>
                    <button type="button" className="mini" data-testid="new-save" onClick={() => setSaveFor(c)}>
                      {Icon.bookmark}
                      <span>Save</span>
                    </button>
                    <button type="button" className="mini" data-testid="new-never" onClick={() => setNeverFor(c)}>
                      {Icon.ban}
                      <span>Never</span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > shown && (
        <button type="button" className="btn btn-ghost btn-block" data-testid="new-show-more" onClick={() => setShown((n) => n + PAGE)}>
          Show more
        </button>
      )}

      {saveFor && (
        <Sheet testId="save-sheet" title="Save to which list?" onClose={() => setSaveFor(null)}>
          <div className="sheet-options">
            {save.options.map((o) => (
              <button
                key={o.list}
                type="button"
                className={`sheet-option ${o.list === save.defaultList ? 'primary' : ''}`}
                data-testid={`save-option-${o.list}`}
                onClick={() => {
                  const c = saveFor;
                  setSaveFor(null);
                  act(c, 'save', o.list);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {neverFor && (
        <Sheet testId="never-sheet" title="Never show this again?" onClose={() => setNeverFor(null)}>
          <p className="sheet-text" data-testid="never-text">It will be hidden for you from now on. You can undo this later in Us.</p>
          <div className="sheet-options">
            <button
              type="button"
              className="sheet-option danger"
              data-testid="never-confirm"
              onClick={() => {
                const c = neverFor;
                setNeverFor(null);
                act(c, 'never');
              }}
            >
              Yes, never
            </button>
            <button type="button" className="sheet-option" data-testid="never-cancel" onClick={() => setNeverFor(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
