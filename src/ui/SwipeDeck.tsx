import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { CatalogItem, DeckCard, SwipeAction, WatchlistOwner } from '../contracts';
import { AdBadge, Icon, Poster, Sheet } from './components';
import { formatMinutes, pickText, serviceName, type SaveOption } from './helpers';

export interface StackCardData {
  card: DeckCard;
  item: CatalogItem;
}

type Exit = 'right' | 'left' | 'up' | 'shrink';

const DECIDE_DISTANCE = 96; // px dragged to count as a decision
const FLING_VELOCITY = 0.55; // px/ms
const TAP_SLOP = 8;

/** The info under the poster; also used (bare) as the card peeking out underneath. */
function CardFace({
  sc,
  bare,
  overview,
  onToggleOverview,
}: {
  sc: StackCardData;
  bare?: boolean;
  overview?: boolean;
  onToggleOverview?: () => void;
}) {
  const { item, card } = sc;
  const id = (name: string) => (bare ? undefined : name);
  return (
    <>
      <div className="card-poster-wrap">
        <Poster title={item.title} year={item.year} poster={item.poster} size="w500" className="card-poster" quiet />
        <div className="card-grad" />
        <div className="card-titleblock">
          <h2 data-testid={id('card-title')}>{item.title}</h2>
          <div className="card-meta">
            <span data-testid={id('card-year')}>{item.year}</span>
            <span className="dot">{'•'}</span>
            <span data-testid={id('card-minutes')}>{formatMinutes(card.minutes)}</span>
            {item.certification && (
              <>
                <span className="dot">{'•'}</span>
                <span>{item.certification}</span>
              </>
            )}
          </div>
        </div>
        {!bare && (
          <>
            <button type="button" className="card-info-btn" aria-label="About this title" data-testid="card-info" onClick={onToggleOverview}>
              {Icon.info}
            </button>
            <div className="stamp stamp-yes" data-stamp="yes">
              YES
            </div>
            <div className="stamp stamp-no" data-stamp="no">
              NOT TONIGHT
            </div>
            {overview && (
              <div className="card-overview" data-testid="card-overview" onClick={onToggleOverview}>
                <p>{item.overview || 'No description available.'}</p>
                <small>Tap to close</small>
              </div>
            )}
          </>
        )}
      </div>
      <div className="card-info">
        <div className="card-service">
          <span className="service-name" data-testid={id('card-service')}>
            {serviceName(card.service.serviceId)}
          </span>
          <AdBadge service={card.service} testId={bare ? 'under-ad-badge' : 'card-ad-badge'} />
        </div>
        <div className="card-pick" data-testid={id('card-pick')}>
          {pickText(card.pick)}
        </div>
        {card.reasons[0] && (
          <div className="card-reason" data-testid={id('card-reason')}>
            {card.reasons[0]}
          </div>
        )}
      </div>
    </>
  );
}

interface Props {
  cards: StackCardData[];
  /** Changing this clears the "already actioned" memory (new deck). */
  resetKey: string;
  save: { options: SaveOption[]; defaultList: WatchlistOwner };
  neverText: string;
  onAction: (c: StackCardData, action: SwipeAction, list?: WatchlistOwner) => void;
  /** Shown instead of the stack when no cards are left. */
  empty: ReactNode;
  /** Shown above the stack. */
  top?: ReactNode;
}

export function SwipeDeck({ cards, resetKey, save, neverText, onAction, empty, top }: Props) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => setGone(new Set()), [resetKey]);
  const visible = cards.filter((c) => !gone.has(c.card.itemId));
  const current = visible[0];
  const next = visible[1];

  const topEl = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const drag = useRef<{ x: number; y: number; t: number; lx: number; lt: number; vx: number; moved: boolean; id: number } | null>(null);
  const [overview, setOverview] = useState(false);
  const [sheet, setSheet] = useState<'save' | 'never' | null>(null);
  const currentId = current?.card.itemId;
  useEffect(() => {
    setOverview(false);
    setSheet(null);
  }, [currentId]);

  const stamps = (el: HTMLElement, dx: number) => {
    const yes = el.querySelector<HTMLElement>('[data-stamp="yes"]');
    const no = el.querySelector<HTMLElement>('[data-stamp="no"]');
    if (yes) yes.style.opacity = String(Math.max(0, Math.min(1, dx / DECIDE_DISTANCE)));
    if (no) no.style.opacity = String(Math.max(0, Math.min(1, -dx / DECIDE_DISTANCE)));
  };

  const finish = (sc: StackCardData, action: SwipeAction, list?: WatchlistOwner) => {
    setGone((g) => new Set(g).add(sc.card.itemId));
    onAction(sc, action, list);
  };

  const exit = (kind: Exit, action: SwipeAction, list?: WatchlistOwner) => {
    const el = topEl.current;
    if (!el || !current || busy.current) return;
    busy.current = true;
    const sc = current;
    const w = window.innerWidth;
    const dy = 0;
    el.style.transition = 'transform 260ms cubic-bezier(.2,.7,.3,1), opacity 260ms ease-out';
    if (kind === 'right') {
      stamps(el, DECIDE_DISTANCE);
      el.style.transform = `translate(${w * 1.2}px, ${dy}px) rotate(22deg)`;
    } else if (kind === 'left') {
      stamps(el, -DECIDE_DISTANCE);
      el.style.transform = `translate(${-w * 1.2}px, ${dy}px) rotate(-22deg)`;
    } else if (kind === 'up') {
      el.style.transform = 'translate(0, -120px) scale(.94)';
    } else {
      el.style.transform = 'scale(.7)';
    }
    el.style.opacity = '0';
    window.setTimeout(() => {
      busy.current = false;
      finish(sc, action, list);
    }, 250);
  };

  const springBack = (el: HTMLElement) => {
    el.style.transition = 'transform 320ms cubic-bezier(.2,1.3,.4,1)';
    el.style.transform = 'translate(0,0) rotate(0)';
    stamps(el, 0);
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (busy.current || overview || sheet) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'none';
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, lx: e.clientX, lt: e.timeStamp, vx: 0, moved: false, id: e.pointerId };
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > TAP_SLOP) d.moved = true;
    const dt = e.timeStamp - d.lt;
    if (dt > 0) d.vx = 0.6 * d.vx + 0.4 * ((e.clientX - d.lx) / dt);
    d.lx = e.clientX;
    d.lt = e.timeStamp;
    const el = e.currentTarget;
    el.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 18}deg)`;
    stamps(el, dx);
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      springBack(el);
      setOverview((o) => !o);
      return;
    }
    if (dx > DECIDE_DISTANCE || (d.vx > FLING_VELOCITY && dx > 24)) exit('right', 'yes');
    else if (dx < -DECIDE_DISTANCE || (d.vx < -FLING_VELOCITY && dx < -24)) exit('left', 'not-tonight');
    else springBack(el);
  };
  const onCancel = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    springBack(e.currentTarget);
  };

  if (!current) return <div className="deck-wrap">{top}{empty}</div>;

  return (
    <div className="deck-wrap">
      {top}
      <div className="stack" data-testid="deck">
        {next && (
          <div className="card card-under" key={`u-${next.card.itemId}`} aria-hidden="true">
            <CardFace sc={next} bare />
          </div>
        )}
        <div
          className="card card-top"
          key={current.card.itemId}
          ref={topEl}
          data-testid="card"
          data-item-id={current.card.itemId}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
        >
          <CardFace sc={current} overview={overview} onToggleOverview={() => setOverview((o) => !o)} />
        </div>
      </div>

      <div className="actions" role="group" aria-label="Card actions">
        <button type="button" className="act act-big act-no" data-testid="action-not-tonight" aria-label="Not tonight" onClick={() => exit('left', 'not-tonight')}>
          {Icon.close}
          <span>Not tonight</span>
        </button>
        <button type="button" className="act" data-testid="action-seen" aria-label="Seen it" onClick={() => exit('up', 'seen')}>
          {Icon.eye}
          <span>Seen it</span>
        </button>
        <button type="button" className="act" data-testid="action-save" aria-label="Save to watchlist" onClick={() => setSheet('save')}>
          {Icon.bookmark}
          <span>Save</span>
        </button>
        <button type="button" className="act" data-testid="action-never" aria-label="Never" onClick={() => setSheet('never')}>
          {Icon.ban}
          <span>Never</span>
        </button>
        <button type="button" className="act act-big act-yes" data-testid="action-yes" aria-label="Yes" onClick={() => exit('right', 'yes')}>
          {Icon.heart}
          <span>Yes</span>
        </button>
      </div>

      {sheet === 'save' && (
        <Sheet testId="save-sheet" title="Save to which list?" onClose={() => setSheet(null)}>
          <div className="sheet-options">
            {save.options.map((o) => (
              <button
                key={o.list}
                type="button"
                className={`sheet-option ${o.list === save.defaultList ? 'primary' : ''}`}
                data-testid={`save-option-${o.list}`}
                onClick={() => {
                  setSheet(null);
                  exit('up', 'save', o.list);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'never' && (
        <Sheet testId="never-sheet" title="Never show this again?" onClose={() => setSheet(null)}>
          <p className="sheet-text" data-testid="never-text">{neverText}</p>
          <div className="sheet-options">
            <button
              type="button"
              className="sheet-option danger"
              data-testid="never-confirm"
              onClick={() => {
                setSheet(null);
                exit('shrink', 'never');
              }}
            >
              Yes, never
            </button>
            <button type="button" className="sheet-option" data-testid="never-cancel" onClick={() => setSheet(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
