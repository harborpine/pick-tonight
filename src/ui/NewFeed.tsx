import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CatalogItem, DeckCard, Engine, EngineContext, FollowUp, NewCard, SwipeAction, Who, WatchlistOwner } from '../contracts';
import { Header, Icon, Poster, ServiceLine, Sheet } from './components';
import { CatalogGate, WhoPicker } from './Pickers';
import { useApp } from './context';
import { cleanWho, formatDate, formatMinutes, joinNames, namesOf, pickText, saveOptions } from './helpers';

const PAGE = 40;

type Acting = { card: DeckCard; key: string };

function safeFollowUps(engine: Engine, who: Who, ctx: EngineContext): FollowUp[] {
  try {
    return engine.followUps(who, ctx);
  } catch {
    return [];
  }
}

/** Poster, title lines and the five action buttons, shared by follow-ups and the New feed. */
function ActionRow({
  item,
  card,
  rowProps,
  meta,
  note,
  onAct,
  onSave,
  onNever,
  prefix,
}: {
  item: CatalogItem;
  card: DeckCard;
  rowProps: Record<string, string | undefined>;
  meta: ReactNode;
  note?: ReactNode;
  onAct: (action: SwipeAction) => void;
  onSave: () => void;
  onNever: () => void;
  prefix: 'new' | 'followup';
}) {
  return (
    <div className="row static newrow" data-testid={`${prefix}-row`} data-item-id={item.id} {...rowProps}>
      <div className="newrow-top">
        <Poster title={item.title} year={item.year} poster={item.poster} size="w185" compact className="row-poster" />
        <span className="row-body">
          <span className="row-title" data-testid={`${prefix}-title`}>{item.title}</span>
          <span className="row-sub">{meta}</span>
          <span className="row-sub" data-testid={`${prefix}-pick`}>{pickText(card.pick)}</span>
          <span className="row-sub"><ServiceLine service={card.service} prefix={`${prefix}-service`} /></span>
          {note}
        </span>
      </div>
      <div className="mini-actions">
        <button type="button" className="mini mini-yes" data-testid={`${prefix}-yes`} onClick={() => onAct('yes')}>
          {Icon.heart}
          <span>Yes</span>
        </button>
        <button type="button" className="mini" data-testid={`${prefix}-not-tonight`} onClick={() => onAct('not-tonight')}>
          {Icon.close}
          <span>Not tonight</span>
        </button>
        <button type="button" className="mini" data-testid={`${prefix}-seen`} onClick={() => onAct('seen')}>
          {Icon.eye}
          <span>Seen</span>
        </button>
        <button type="button" className="mini" data-testid={`${prefix}-save`} onClick={onSave}>
          {Icon.bookmark}
          <span>Save</span>
        </button>
        <button type="button" className="mini" data-testid={`${prefix}-never`} onClick={onNever}>
          {Icon.ban}
          <span>Never</span>
        </button>
      </div>
    </div>
  );
}

export function NewFeed() {
  return (
    <CatalogGate>
      <NewFeedInner />
    </CatalogGate>
  );
}

function NewFeedInner() {
  const { services, state, me, isSolo, engineCtx, itemById, perform, toast, followUpsShown } = useApp();
  const { engine, newArrivals } = services;

  // Starts on just me; switch on others to see what suits the group.
  const [whoSel, setWho] = useState<Who>([me]);
  const who: Who = cleanWho(whoSel, state.members, me);
  const everyone = who.length > 1;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [fShown, setFShown] = useState(6);
  const [saveFor, setSaveFor] = useState<Acting | null>(null);
  const [neverFor, setNeverFor] = useState<Acting | null>(null);

  // Everything the engine reads; the lists below rebuild when any of it changes.
  const deps = [engine, who.join(","), state.seen, state.never, state.notTonight, state.profiles, state.settings, state.picks];

  const ranked = useMemo(
    () => engine.rankNewArrivals(newArrivals, who, engineCtx()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, newArrivals],
  );
  const followUps = useMemo(
    () => safeFollowUps(engine, who, engineCtx()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  const keyOf = (c: NewCard) => `${c.arrival.itemId}-${c.arrival.season ?? ''}`;
  const fRows = followUps.filter((f) => !hidden.has(`fu:${f.key}`));
  const fIds = new Set(fRows.map((f) => f.itemId));
  // A title shown under "Because you watched" is not repeated in the general list.
  const rows = ranked.filter((c) => !hidden.has(`new:${keyOf(c)}`) && !fIds.has(c.itemId));

  // The follow-up section being on screen clears the dot on the New tab (for both "me" and "Together").
  useEffect(() => {
    if (fRows.length === 0) return;
    const ctx = engineCtx();
    const keys = new Set<string>([...fRows.map((f) => f.key), ...safeFollowUps(engine, [me], ctx).map((f) => f.key), ...safeFollowUps(engine, who, ctx).map((f) => f.key)]);
    followUpsShown([...keys]);
  }, [fRows.map((f) => f.key).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (hideKey: string, itemId: string, card: DeckCard, action: SwipeAction, list?: WatchlistOwner) => {
    const item = itemById(itemId);
    if (!item) return;
    setHidden((h) => new Set(h).add(hideKey));
    void perform({ item, pick: card.pick, service: card.service, action, who, list });
    if (action === 'yes') toast('Added to Matches');
  };

  const save = saveOptions(me, who, state.members);
  const requestSave = (card: DeckCard, key: string) => {
    if (save.options.length === 1) act(key, card.itemId, card, 'save', save.options[0].list);
    else setSaveFor({ card, key });
  };
  const neverText = 'It will be hidden for you from now on. You can undo this later in Us.';

  return (
    <div className="screen with-tabs scroll" data-testid="new-feed">
      <Header title="New on our services" subtitle="Ranked by what we like" />
      {!isSolo && <WhoPicker who={who} onChange={setWho} />}

      {fRows.length > 0 && (
        <section className="followups" data-testid="followups">
          <h2 className="section-title" data-testid="followups-title">Because you watched{'…'}</h2>
          <ul className="rows new-rows">
            {fRows.slice(0, fShown).map((f) => {
              const item = itemById(f.itemId);
              if (!item) return null;
              return (
                <li key={f.key}>
                  <ActionRow
                    prefix="followup"
                    item={item}
                    card={f}
                    rowProps={{ 'data-key': f.key, 'data-type': f.type }}
                    meta={
                      <>
                        <span className="followup-text" data-testid="followup-text">{f.text}</span>
                        <span className="followup-facts">
                          {f.date && <span data-testid="followup-date">{formatDate(f.date)} {'•'} </span>}
                          {item.year} {'•'} {formatMinutes(f.minutes)}
                        </span>
                      </>
                    }
                    onAct={(a) => act(`fu:${f.key}`, f.itemId, f, a)}
                    onSave={() => requestSave(f, `fu:${f.key}`)}
                    onNever={() => setNeverFor({ card: f, key: `fu:${f.key}` })}
                  />
                </li>
              );
            })}
          </ul>
          {fRows.length > fShown && (
            <button type="button" className="btn btn-ghost btn-block" data-testid="followups-more" onClick={() => setFShown((n) => n + 1000)}>
              Show more ({fRows.length - fShown} left)
            </button>
          )}
        </section>
      )}

      {fRows.length > 0 && rows.length > 0 && <h2 className="section-title" data-testid="new-section-title">New on your services</h2>}

      {rows.length === 0 ? (
        <p className="empty-note" data-testid="new-empty">
          Nothing new for {everyone ? joinNames(namesOf(state.members, who)) : 'you'} right now. New arrivals and new seasons on your services show up here after each daily update.
        </p>
      ) : (
        <ul className="rows new-rows">
          {rows.slice(0, shown).map((c) => {
            const item = itemById(c.itemId);
            if (!item) return null;
            const label = c.arrival.type === 'season' ? `New season${c.arrival.season ? ` ${c.arrival.season}` : ''}` : 'New';
            return (
              <li key={keyOf(c)}>
                <ActionRow
                  prefix="new"
                  item={item}
                  card={c}
                  rowProps={{ 'data-type': c.arrival.type }}
                  meta={
                    <>
                      <span className={`tag ${c.arrival.type === 'season' ? 'tag-season' : 'tag-new'}`} data-testid="new-label">{label}</span>{' '}
                      <span data-testid="new-date">{formatDate(c.arrival.date)}</span> {'•'} {item.year} {'•'} {formatMinutes(c.minutes)}
                    </>
                  }
                  note={c.reasons[0] ? <span className="row-reason">{c.reasons[0]}</span> : undefined}
                  onAct={(a) => act(`new:${keyOf(c)}`, c.itemId, c, a)}
                  onSave={() => requestSave(c, `new:${keyOf(c)}`)}
                  onNever={() => setNeverFor({ card: c, key: `new:${keyOf(c)}` })}
                />
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
                  const a = saveFor;
                  setSaveFor(null);
                  act(a.key, a.card.itemId, a.card, 'save', o.list);
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
          <p className="sheet-text" data-testid="never-text">{neverText}</p>
          <div className="sheet-options">
            <button
              type="button"
              className="sheet-option danger"
              data-testid="never-confirm"
              onClick={() => {
                const a = neverFor;
                setNeverFor(null);
                act(a.key, a.card.itemId, a.card, 'never');
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
