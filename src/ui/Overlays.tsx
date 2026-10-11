import { useMemo, useState } from 'react';
import type { CatalogItem, DeckCard, TogetherSession } from '../contracts';
import { AdBadge, Poster } from './components';
import { useApp } from './context';
import { moodLabel, pickText, serviceName, timeLabel } from './helpers';

// ---------------------------------------------------------------------------
// Join prompt (banner on any screen, or inline card on the Ask screen)
// ---------------------------------------------------------------------------

export function JoinCard({ session, inline, onDismiss }: { session: TogetherSession; inline?: boolean; onDismiss?: () => void }) {
  const { services, me, setSessionLeft, goTab, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const join = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await services.sync.joinSession(session.id, me);
      setSessionLeft(false);
      goTab('tonight');
    } catch {
      toast('That session is no longer open.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`join-card ${inline ? 'inline' : 'banner'}`} role="alert" data-testid={inline ? 'join-prompt-inline' : 'join-prompt'} data-session-id={session.id}>
      <div className="join-text">
        <strong data-testid="join-text">
          {session.startedBy} started a session: {moodLabel(session.request.mood)} {'·'} {timeLabel(session.request.time)}
        </strong>
        <span>Swipe the same deck and find what you both want.</span>
      </div>
      <div className="join-actions">
        <button type="button" className="btn btn-primary" data-testid={inline ? 'join-button-inline' : 'join-button'} disabled={busy} onClick={join}>
          Join
        </button>
        {onDismiss && (
          <button type="button" className="btn-link" data-testid="join-dismiss" onClick={onDismiss}>
            Not now
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The match moment
// ---------------------------------------------------------------------------

function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: ((i * 53) % 90) / 100,
        dur: 1.8 + ((i * 29) % 12) / 10,
        size: 6 + ((i * 7) % 8),
        rot: (i * 47) % 360,
        tone: i % 3,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          className={`bit tone${b.tone}`}
          style={{ left: `${b.left}%`, width: b.size, height: b.size * 1.6, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, transform: `rotate(${b.rot}deg)` }}
        />
      ))}
    </div>
  );
}

export function MatchScreen({
  item,
  card,
  onKeep,
  onWatching,
}: {
  item: CatalogItem | undefined;
  card: DeckCard | undefined;
  onKeep: () => void;
  onWatching: () => void;
}) {
  const title = item?.title ?? 'Your match';
  return (
    <div className="overlay match" data-testid="match-screen" data-item-id={item?.id ?? card?.itemId}>
      <Confetti />
      <div className="pick-inner">
        <p className="eyebrow match-eyebrow" data-testid="match-headline">It&rsquo;s a match!</p>
        <div className="match-poster-wrap">
          {item ? (
            <Poster title={item.title} year={item.year} poster={item.poster} size="w500" className="pick-poster match-poster" />
          ) : (
            <div className="pick-poster" />
          )}
        </div>
        <h1 className="pick-title" data-testid="match-title">{title}</h1>
        {card && (
          <>
            <p className="pick-what" data-testid="match-what">{pickText(card.pick)}</p>
            <p className="pick-where">
              <span>on </span>
              <strong data-testid="match-service">{serviceName(card.service.serviceId)}</strong>
              <AdBadge service={card.service} testId="match-ad-badge" />
            </p>
          </>
        )}
      </div>
      <div className="overlay-actions">
        <button type="button" className="btn btn-primary btn-lg" data-testid="match-watching" onClick={onWatching}>
          We&rsquo;re watching this
        </button>
        <button type="button" className="btn btn-ghost btn-lg" data-testid="match-keep" onClick={onKeep}>
          Keep swiping
        </button>
      </div>
    </div>
  );
}
