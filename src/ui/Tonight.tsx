import { useEffect, useMemo, useState } from 'react';
import { APP_NAME, APP_TAGLINE } from '../config';
import {
  DEFAULT_REQUEST,
  GENRES,
  MOODS,
  type GenreId,
  type MoodId,
  type Novelty,
  type MemberId,
  type SuggestRequest,
  type TogetherSession,
  type ViewingType,
  type Who,
} from '../contracts';
import { Chip, Header, Icon, Sheet } from './components';
import { CatalogGate, WhoPicker } from './Pickers';
import { readLocal, useApp, writeLocal } from './context';
import {
  TIME_OPTIONS,
  inSession,
  cleanWho,
  joinNames,
  looseningHints,
  moodLabel,
  nameOf,
  namesOf,
  needsToJoin,
  othersPickingText,
  remainingSessionCards,
  saveOptions,
  sessionWaitingFor,
  sessionWithoutMe,
  timeLabel,
  whoLabel,
} from './helpers';
import { SwipeDeck, type StackCardData } from './SwipeDeck';
import { JoinCard } from './Overlays';

const randomSeed = () => Math.floor(Math.random() * 2147483646) + 1;

const VIEWING: { value: ViewingType; label: string }[] = [
  { value: 'focused', label: 'Focused' },
  { value: 'background', label: 'Background' },
  { value: 'eating', label: 'While eating' },
];
const NOVELTY: { value: Novelty; label: string; hint?: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'rewatch', label: 'Rewatch' },
  { value: 'either', label: 'Either', hint: 'mostly new' },
];

function summary(r: SuggestRequest, members: Record<MemberId, { id: MemberId; name: string }>): string {
  return `${whoLabel(r.who, members)} · ${moodLabel(r.mood)} · ${timeLabel(r.time)}`;
}

// ---------------------------------------------------------------------------
// Router for the Tonight tab
// ---------------------------------------------------------------------------

export function Tonight() {
  return (
    <CatalogGate>
      <TonightInner />
    </CatalogGate>
  );
}

function TonightInner() {
  const { state, me, solo, sessionLeft } = useApp();
  const session = state.activeSession;
  if (inSession(session, me) && !sessionLeft) return <SessionView session={session} />;
  if (solo) return <SoloView />;
  return <Ask />;
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

function loadAsk(me: MemberId, members: Record<MemberId, { id: MemberId; name: string }>): SuggestRequest {
  const saved = readLocal<Partial<SuggestRequest> | null>(`pt.ui.ask.v2.${me}`, null);
  const base: SuggestRequest = { ...DEFAULT_REQUEST, who: [me] };
  if (!saved) return base;
  const ok = {
    who: cleanWho(saved.who, members, me),
    viewing: VIEWING.some((v) => v.value === saved.viewing) ? (saved.viewing as ViewingType) : base.viewing,
    mood: MOODS.some((m) => m.id === saved.mood) ? (saved.mood as MoodId) : base.mood,
    time: TIME_OPTIONS.some((t) => t.value === saved.time) ? (saved.time as SuggestRequest['time']) : base.time,
    novelty: NOVELTY.some((n) => n.value === saved.novelty) ? (saved.novelty as Novelty) : base.novelty,
    genre: saved.genre && saved.genre in GENRES ? (saved.genre as GenreId) : null,
  };
  return ok;
}

function Ask() {
  const { services, state, me, isSolo, engineCtx, setSolo, setSessionLeft, toast, joinDismissed } = useApp();
  const { engine, sync } = services;
  const [req, setReq] = useState<SuggestRequest>(() => loadAsk(me, state.members));
  const [busy, setBusy] = useState(false);

  const session = state.activeSession;
  const ctx = engineCtx();
  const moods = engine.availableMoods(req.who, ctx);

  // If the chosen mood stops being offered (Who changed), reset it.
  useEffect(() => {
    if (!moods.includes(req.mood)) {
      const fallback = moods.includes('laugh') ? 'laugh' : moods[0];
      if (fallback) setReq((r) => ({ ...r, mood: fallback }));
    }
  }, [moods.join(','), req.mood]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof SuggestRequest>(k: K, v: SuggestRequest[K]) => setReq((r) => ({ ...r, [k]: v }));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      writeLocal(`pt.ui.ask.v2.${me}`, req);
      const deck = engine.buildDeck(req, engineCtx(), { seed: randomSeed() });
      if (deck.length === 0) {
        setSolo({ request: req, cards: [], dealt: 0, liked: 0 });
        return;
      }
      if (req.who.length > 1) {
        await sync.startSession(me, req, deck);
        setSessionLeft(false);
        setSolo(null);
      } else {
        setSolo({ request: req, cards: deck, dealt: deck.length, liked: 0 });
        setSessionLeft(true);
      }
    } catch {
      toast('Could not start that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const resumable = inSession(session, me);
  const together = req.who.length > 1;
  const forOther = req.who.length === 1 && req.who[0] !== me ? nameOf(state.members, req.who[0]) : null;

  return (
    <div className="screen with-tabs scroll ask" data-testid="ask">
      <header className="ask-head">
        <h1 className="ask-title">{APP_NAME}</h1>
        <p>{APP_TAGLINE}</p>
      </header>

      {resumable && (
        <button type="button" className="resume-banner" data-testid="resume-session" onClick={() => setSessionLeft(false)}>
          <strong>Together session in progress</strong>
          <span>{summary(session.request, state.members)} {'—'} tap to go back to it</span>
        </button>
      )}
      {needsToJoin(session, me) && joinDismissed === session.id && <JoinCard session={session} inline />}
      {sessionWithoutMe(session, me) && (
        <p className="quiet-line" data-testid="session-others">
          {othersPickingText(session, state.members)}
        </p>
      )}

      {!isSolo && (
        <section className="ask-group" data-testid="ask-group-who">
          <h2>Who&rsquo;s watching?</h2>
          <WhoPicker who={req.who} onChange={(w) => set('who', w)} />
          {forOther && <p className="hint">Picking for {forOther}. What you do with the cards applies to {forOther}.</p>}
        </section>
      )}

      <section className="ask-group" data-testid="ask-group-viewing">
        <h2>How closely?</h2>
        <div className="chip-row">
          {VIEWING.map((v) => (
            <Chip key={v.value} selected={req.viewing === v.value} testId={`ask-viewing-${v.value}`} onClick={() => set('viewing', v.value)}>
              {v.label}
            </Chip>
          ))}
        </div>
      </section>

      <section className="ask-group" data-testid="ask-group-mood">
        <h2>Mood</h2>
        <div className="chip-row wrap">
          {MOODS.filter((m) => moods.includes(m.id)).map((m) => (
            <Chip key={m.id} selected={req.mood === m.id} testId={`ask-mood-${m.id}`} onClick={() => set('mood', m.id)}>
              {m.label}
            </Chip>
          ))}
        </div>
      </section>

      <section className="ask-group" data-testid="ask-group-time">
        <h2>Time</h2>
        <div className="chip-row wrap time-row">
          {TIME_OPTIONS.map((t) => (
            <Chip small key={t.value} selected={req.time === t.value} testId={`ask-time-${t.value}`} onClick={() => set('time', t.value)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </section>

      <section className="ask-group" data-testid="ask-group-novelty">
        <h2>New or rewatch?</h2>
        <div className="chip-row">
          {NOVELTY.map((n) => (
            <Chip key={n.value} selected={req.novelty === n.value} testId={`ask-novelty-${n.value}`} onClick={() => set('novelty', n.value)}>
              {n.label}
              {n.hint && (
                <small className="chip-hint" data-testid={`ask-novelty-${n.value}-hint`}>
                  {n.hint}
                </small>
              )}
            </Chip>
          ))}
        </div>
      </section>

      <section className="ask-group" data-testid="ask-group-genre">
        <h2>
          Craving a genre? <span className="muted">optional</span>
        </h2>
        <div className="chip-scroll">
          <Chip small selected={req.genre === null} testId="ask-genre-any" onClick={() => set('genre', null)}>
            Any
          </Chip>
          {(Object.keys(GENRES) as GenreId[]).map((g) => (
            <Chip key={g} small selected={req.genre === g} testId={`ask-genre-${g}`} onClick={() => set('genre', req.genre === g ? null : g)}>
              {GENRES[g]}
            </Chip>
          ))}
        </div>
      </section>

      <div className="ask-submit">
        <button type="button" className="btn btn-primary btn-xl" data-testid="ask-submit" disabled={busy} onClick={submit}>
          {busy ? 'Finding…' : together ? 'Start together' : 'Show me'}
        </button>
        {together && (
          <p className="hint center">
            {joinNames(namesOf(state.members, req.who.filter((id) => id !== me)))} will get a prompt to join{session ? ' (this replaces the session already open)' : ''}.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty deck
// ---------------------------------------------------------------------------

function EmptyDeck({ request, ranOut, onBack }: { request: SuggestRequest; ranOut: boolean; onBack: () => void }) {
  return (
    <div className="empty-deck" data-testid="empty-deck">
      <div className="empty-emoji">{'🍿'}</div>
      <h2>{ranOut ? "That's all of them" : 'Nothing fits that just now'}</h2>
      <p>{ranOut ? 'You have been through the whole deck. To see more, loosen something:' : 'Try loosening one of these:'}</p>
      <ul>
        {looseningHints(request).map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary btn-lg" data-testid="empty-back" onClick={onBack}>
        Back to the questions
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Solo deck
// ---------------------------------------------------------------------------

/** "Liked N": counts right-swipes in this deck; pulses and floats a heart each time it goes up. Tap = Matches tab. */
function LikedChip({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" className="liked-chip" data-testid="liked-chip" data-count={count} aria-label={`Liked ${count}. Open Matches`} onClick={onOpen}>
      <span key={`h${count}`} className="liked-heart">{Icon.heart}</span>
      <span key={`n${count}`} className="liked-text">
        Liked <strong data-testid="liked-count">{count}</strong>
      </span>
      <span key={`b${count}`} className="liked-burst" aria-hidden="true">{'♥'}</span>
    </button>
  );
}

function SoloView() {
  const { solo, setSolo, me, state, isSolo, perform, itemById, goTab } = useApp();
  const resetKey = useMemo(() => String(Math.random()), [solo?.request]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!solo) return null;
  const { request } = solo;
  const save = saveOptions(me, request.who, state.members);
  const cards: StackCardData[] = solo.cards.flatMap((card) => {
    const item = itemById(card.itemId);
    return item ? [{ card, item }] : [];
  });
  const who = request.who;
  const neverText =
    who.length === 1 && who[0] === me
      ? 'It will be hidden for you from now on. You can undo this later in Us.'
      : `It will be hidden for ${nameOf(state.members, who[0])} from now on. You can undo this later in Us.`;

  return (
    <div className="screen with-tabs deckscreen" data-testid="solo-deck" data-mode="solo">
      <Header
        title={isSolo ? 'Tonight' : whoLabel(request.who, state.members)}
        subtitle={summary(request, state.members).split(' · ').slice(1).join(' · ')}
        left={
          <button type="button" className="icon-btn" aria-label="Back to the questions" data-testid="deck-back" onClick={() => setSolo(null)}>
            {Icon.back}
          </button>
        }
        right={
          <>
            {solo.liked > 0 && <LikedChip count={solo.liked} onOpen={() => goTab('matches')} />}
            {cards.length > 0 && <span className="count" data-testid="deck-count">{cards.length} left</span>}
          </>
        }
      />
      <SwipeDeck
        cards={cards}
        resetKey={resetKey}
        save={save}
        neverText={neverText}
        empty={<EmptyDeck request={request} ranOut={solo.dealt > 0} onBack={() => setSolo(null)} />}
        onAction={(sc, action, list) => {
          void perform({ item: sc.item, pick: sc.card.pick, service: sc.card.service, action, who, list });
          setSolo((s) =>
            s ? { ...s, cards: s.cards.filter((c) => c.itemId !== sc.card.itemId), liked: s.liked + (action === 'yes' ? 1 : 0) } : s,
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Together session deck
// ---------------------------------------------------------------------------

function SessionView({ session }: { session: TogetherSession }) {
  const { services, me, state, perform, itemById, engineCtx, setSessionLeft, titleOf, toast } = useApp();
  const { engine, sync } = services;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const waitingNames = namesOf(state.members, sessionWaitingFor(session));
  const allIn = waitingNames.length === 0;
  const joinedNames = namesOf(state.members, session.joined.filter((id) => id !== me));
  const save = saveOptions(me, session.request.who, state.members);

  const cards: StackCardData[] = remainingSessionCards(session, me).flatMap((card) => {
    const item = itemById(card.itemId);
    return item ? [{ card, item }] : [];
  });

  const getMore = async () => {
    if (moreBusy) return;
    setMoreBusy(true);
    try {
      const fresh = engine.buildDeck(session.request, engineCtx(), { exclude: session.deck.map((c) => c.itemId), seed: randomSeed() });
      if (fresh.length === 0) setNoMore(true);
      else {
        setNoMore(false);
        await sync.appendSessionDeck(session.id, fresh);
      }
    } catch {
      toast('Could not fetch more cards. Please try again.');
    } finally {
      setMoreBusy(false);
    }
  };

  const end = async () => {
    setConfirmEnd(false);
    try {
      await sync.endSession(session.id);
    } catch {
      toast('Could not end the session. Please try again.');
    }
  };

  const status = (
    <div className={`session-status ${allIn ? 'in' : 'wait'}`} data-testid="session-status" data-all-joined={allIn} data-waiting={waitingNames.length}>
      {allIn ? `${joinNames(joinedNames)} ${joinedNames.length > 1 ? 'are' : 'is'} in — swipe away` : `Waiting for ${joinNames(waitingNames)} to join…`}
    </div>
  );

  const finished = (
    <div className="empty-deck" data-testid="session-deck-done">
      <div className="empty-emoji">{session.matches.length ? '🎉' : '🍿'}</div>
      <h2>{session.matches.length ? `${session.matches.length} match${session.matches.length === 1 ? '' : 'es'} so far` : 'No matches yet'}</h2>
      <p>{allIn ? 'You are through the deck. The others may still be swiping.' : `You are through the deck. ${joinNames(waitingNames)} ${waitingNames.length > 1 ? 'have' : 'has'} not joined yet.`}</p>
      {session.matches.length > 0 && (
        <ul className="match-list" data-testid="session-matches">
          {session.matches.map((m) => (
            <li key={m.itemId} data-item-id={m.itemId}>
              {titleOf(m.itemId)}
            </li>
          ))}
        </ul>
      )}
      {noMore && <p className="hint" data-testid="session-no-more">Nothing else fits this request right now.</p>}
      <button type="button" className="btn btn-primary btn-lg" data-testid="session-more" disabled={moreBusy} onClick={getMore}>
        {moreBusy ? 'Looking…' : 'More cards'}
      </button>
      <button type="button" className="btn btn-ghost btn-lg" data-testid="session-end" onClick={() => setConfirmEnd(true)}>
        End session
      </button>
    </div>
  );

  return (
    <div className="screen with-tabs deckscreen" data-testid="session-deck" data-mode="together" data-session-id={session.id}>
      <Header
        title={session.request.who.length > 2 ? `Together (${session.request.who.length})` : whoLabel(session.request.who, state.members)}
        subtitle={summary(session.request, state.members).split(' · ').slice(1).join(' · ')}
        left={
          <button type="button" className="icon-btn" aria-label="Back to the questions" data-testid="session-back" onClick={() => setSessionLeft(true)}>
            {Icon.back}
          </button>
        }
        right={
          <button type="button" className="btn-pill" data-testid="session-end-top" onClick={() => setConfirmEnd(true)}>
            End
          </button>
        }
      />
      <SwipeDeck
        top={status}
        cards={cards}
        resetKey={session.id}
        save={save}
        neverText="It will be hidden for you, and out of every Together deck. Once everyone in the household taps Never it is gone for good."
        empty={finished}
        onAction={(sc, action, list) => {
          void perform({ item: sc.item, pick: sc.card.pick, service: sc.card.service, action, who: session.request.who, list, sessionId: session.id });
        }}
      />
      {confirmEnd && (
        <Sheet testId="end-sheet" title="End the session?" onClose={() => setConfirmEnd(false)}>
          <p className="sheet-text">It ends for everyone in it.</p>
          <div className="sheet-options">
            <button type="button" className="sheet-option danger" data-testid="end-confirm" onClick={end}>
              End session
            </button>
            <button type="button" className="sheet-option" data-testid="end-cancel" onClick={() => setConfirmEnd(false)}>
              Keep going
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
