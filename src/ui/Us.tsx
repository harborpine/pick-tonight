import { useMemo, useState } from 'react';
import { APP_NAME } from '../config';
import { MAX_MEMBERS, MAX_NAME_LENGTH, SERVICES, type MemberId, type Profile } from '../contracts';
import { Header, Icon, Segmented, Sheet } from './components';
import { EMPTY_CATALOG, plainError, useApp } from './context';
import { ImportSection } from './Import';
import { FavoritesEditor, NeverEditor, ServicesPicker, keepVisible } from './Pickers';
import { SOLO_LOSS_WARNING, buildInviteLink, formatCount, nameOf, spacedCode, validateName } from './helpers';

type UsTab = string; // a member id, or 'settings'

export function Us() {
  const { me, members, isSolo, state } = useApp();
  const [tab, setTab] = useState<UsTab>(me);
  const active = tab === 'settings' || state.members[tab] ? tab : me;
  return (
    <div className="screen with-tabs scroll" data-testid="us">
      <Header title={isSolo ? 'You' : 'Us'} />
      <Segmented
        testPrefix="us-seg"
        value={active}
        onChange={setTab}
        options={[
          ...members.map((m) => ({ value: m.id, label: m.id === me ? `${m.name} (me)` : m.name, memberId: m.id })),
          { value: 'settings', label: 'Settings' },
        ]}
      />
      {active === 'settings' ? <Settings /> : <ProfilePage key={active} memberId={active} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfilePage({ memberId }: { memberId: MemberId }) {
  const { services, state, catalog, titleOf, startOnboarding, toast, me } = useApp();
  const { engine, sync } = services;
  const profile = state.profiles[memberId];
  const name = nameOf(state.members, memberId);
  const [seenShown, setSeenShown] = useState(8);

  const insights = useMemo(() => engine.describeTaste(profile, catalog ?? EMPTY_CATALOG), [engine, profile, catalog]);

  const latest = (): Profile => sync.getState()?.profiles[memberId] ?? profile;
  const save = async (p: Profile) => {
    try {
      await sync.saveProfile(p);
    } catch {
      toast('Could not save that. Please try again.');
    }
  };

  const seenIds = Object.entries(state.seen[memberId] ?? {})
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => id);
  const neverIds = Object.entries(state.never[memberId] ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  return (
    <div data-testid={`profile-${memberId}`} data-member-id={memberId} className="profile">
      {!profile.onboarded && (
        <div className="notice" data-testid="profile-unfinished">
          {memberId === me ? 'You haven’t finished setting up yet.' : `${name} hasn’t finished setting up yet.`} Everything below can be filled in now.
        </div>
      )}
      <section className="block">
        <h2>Favourites</h2>
        <p className="muted small">{memberId === me ? 'Pick 5–10 you love — it’s how we learn your taste.' : `The shows and movies ${name} loves.`}</p>
        <FavoritesEditor favorites={profile.favorites} onChange={(favs) => void save({ ...latest(), favorites: favs })} />
      </section>

      <section className="block">
        <h2>Never show me…</h2>
        <NeverEditor value={profile.dealbreakers} onChange={(d) => void save({ ...latest(), dealbreakers: d })} />
      </section>

      <section className="block">
        <h2>What the app has learned</h2>
        {insights.length === 0 && (
          <p className="muted" data-testid="insights-empty">
            Nothing yet — add favourites, import your history, or just start swiping.
          </p>
        )}
        <ul className="insights">
          {insights.map((i) => (
            <li key={i.key} className="insight" data-testid="insight-line" data-key={i.key} data-correction={i.correction ?? ''}>
              <div className="insight-text">
                <span data-testid="insight-text">{i.text}</span>
                <small>
                  {i.source === 'favorites' ? (profile.favorites.length ? 'From favourites' : 'Starting point') : i.source === 'learned' ? 'Learned from swipes' : 'You set this'}
                  {i.correction ? ` • pinned: ${i.correction}` : ''}
                </small>
              </div>
              <div className="insight-btns">
                <button
                  type="button"
                  className={`mini-pill ${i.correction === 'more' ? 'on' : ''}`}
                  data-testid="insight-more"
                  data-key={i.key}
                  onClick={() => save(engine.correctTaste(latest(), i.key, 'more'))}
                >
                  More
                </button>
                <button
                  type="button"
                  className={`mini-pill ${i.correction === 'less' ? 'on' : ''}`}
                  data-testid="insight-less"
                  data-key={i.key}
                  onClick={() => save(engine.correctTaste(latest(), i.key, 'less'))}
                >
                  Less
                </button>
                {i.correction && (
                  <button type="button" className="mini-pill" data-testid="insight-clear" data-key={i.key} onClick={() => save(engine.correctTaste(latest(), i.key, null))}>
                    Clear
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h2>Seen</h2>
        <p className="muted small">
          Titles marked as watched ({formatCount(seenIds.length)}); favourites count too. The full list, with search, is on the History tab.
        </p>
        <ul className="plain-list" data-testid="seen-list">
          {seenIds.length === 0 && <li className="muted">Nothing marked yet.</li>}
          {seenIds.slice(0, seenShown).map((id) => (
            <li key={id} data-testid="seen-row" data-item-id={id}>
              <span>{titleOf(id)}</span>
              <button type="button" className="mini-pill" data-testid="unmark-seen" onClick={() => sync.unmarkWatched(memberId, [id]).catch(() => toast('Could not save that. Please try again.'))}>
                Not seen
              </button>
            </li>
          ))}
        </ul>
        {seenIds.length > seenShown && (
          <button type="button" className="btn-link" data-testid="seen-show-all" onClick={() => setSeenShown((n) => n + 50)}>
            {seenShown <= 8 ? `Show ${Math.min(50, seenIds.length - seenShown)} more` : `Show more (${formatCount(seenIds.length - seenShown)} left)`}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-block" data-testid="profile-redo-onboarding" onClick={() => startOnboarding(memberId)}>
          Tick what {memberId === me ? 'I’ve' : `${name} has`} seen
        </button>
      </section>

      <ImportSection memberId={memberId} />

      <section className="block">
        <h2>Never</h2>
        <p className="muted small">Titles hidden for {memberId === me ? 'you' : name}. Bring one back any time.</p>
        <ul className="plain-list" data-testid="never-list">
          {neverIds.length === 0 && <li className="muted">Nothing hidden.</li>}
          {neverIds.map((id) => (
            <li key={id} data-testid="never-row" data-item-id={id}>
              <span>{titleOf(id)}</span>
              <button type="button" className="mini-pill" data-testid="unmark-never" onClick={() => sync.setNever(memberId, id, false)}>
                Bring back
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type SettingsPage = 'main' | 'privacy' | 'about';

function Settings() {
  const [page, setPage] = useState<SettingsPage>('main');
  if (page === 'privacy') return <Privacy onBack={() => setPage('main')} />;
  if (page === 'about') return <About onBack={() => setPage('main')} />;
  return <SettingsMain open={setPage} />;
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="btn-link back-link" data-testid="settings-back" onClick={onBack}>
      {Icon.back}
      <span>Settings</span>
    </button>
  );
}

function SettingsMain({ open }: { open: (p: SettingsPage) => void }) {
  const { services, state, me, members, isSolo, toast } = useApp();
  const { sync } = services;
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [removing, setRemoving] = useState<MemberId | null>(null);
  const [deleting, setDeleting] = useState<'explain' | 'type' | null>(null);
  const [editServices, setEditServices] = useState(false);
  const chosen = SERVICES.flatMap((s) => {
    const p = s.plans.find((d) => d.id === state.settings.plans[s.id]);
    return p ? [{ s, p }] : [];
  });

  const setPlans = async (plans: typeof state.settings.plans) => {
    try {
      const current = sync.getState()?.settings ?? state.settings;
      await sync.saveSettings({ ...current, plans });
    } catch {
      toast('Could not save that. Please try again.');
    }
  };

  return (
    <div data-testid="settings" className="profile">
      <section className="block" data-testid="settings-services">
        <h2>Our services</h2>
        <p className="muted small">Choose what the household pays for. Only titles included in these plans are suggested. Anyone can change this.</p>
        {editServices ? (
          <>
            <ServicesPicker plans={state.settings.plans} onChange={(p) => void setPlans(p)} />
            <button type="button" className="btn btn-primary btn-block" data-testid="services-done" onClick={() => setEditServices(false)}>
              Done
            </button>
          </>
        ) : (
          <>
            <ul className="plain-list" data-testid="services-summary">
              {chosen.length === 0 && <li className="muted">No services chosen yet.</li>}
              {chosen.map(({ s, p }) => (
                <li key={s.id} data-service-id={s.id}>
                  <span>{s.name}</span>
                  <span className="muted small">{p.label}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-ghost btn-block" data-testid="services-edit" onClick={() => setEditServices(true)}>
              Change services
            </button>
          </>
        )}
      </section>

      <InviteBlock full={members.length >= MAX_MEMBERS} />

      <RenameBlock />

      {!isSolo && (
        <section className="block" data-testid="settings-members">
          <h2>People in this household</h2>
          <ul className="plain-list">
            {members.map((m) => (
              <li key={m.id} data-testid="member-row" data-member-id={m.id}>
                <span>
                  {m.name}
                  {m.id === me ? ' (me)' : ''}
                </span>
                <button type="button" className="mini-pill" data-testid={`remove-member-${m.id}`} data-member-id={m.id} onClick={() => setRemoving(m.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="block">
        <button type="button" className="settings-link" data-testid="open-privacy" onClick={() => open('privacy')}>
          <span>Privacy</span>
          {Icon.back}
        </button>
        <button type="button" className="settings-link" data-testid="open-about" onClick={() => open('about')}>
          <span>About</span>
          {Icon.back}
        </button>
      </section>

      <section className="block">
        <h2>This phone</h2>
        <button type="button" className="btn btn-ghost btn-block" data-testid="unpair" onClick={() => setConfirmUnpair(true)}>
          Unpair this phone
        </button>
        <button type="button" className="btn btn-danger btn-block" data-testid="delete-everything" onClick={() => setDeleting('explain')}>
          Delete everything
        </button>
      </section>

      {confirmUnpair && (
        <Sheet testId="unpair-sheet" title="Unpair this phone?" onClose={() => setConfirmUnpair(false)}>
          <p className="sheet-text">
            This phone forgets the household. Everyone’s lists stay safe, and you can come back later with an invite from someone in it
            (choose “I’m already a member”).
          </p>
          {isSolo && (
            <div className="notice error" data-testid="unpair-solo-warning">
              <strong>You’re the only person here.</strong> {SOLO_LOSS_WARNING}
            </div>
          )}
          <div className="sheet-options">
            <button
              type="button"
              className="sheet-option danger"
              data-testid="unpair-confirm"
              onClick={async () => {
                setConfirmUnpair(false);
                try {
                  await sync.unpair();
                } catch {
                  toast('Could not unpair. Please try again.');
                }
              }}
            >
              {isSolo ? 'Unpair and lose my lists' : 'Unpair'}
            </button>
            <button type="button" className="sheet-option" data-testid="unpair-cancel" onClick={() => setConfirmUnpair(false)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}

      {removing && state.members[removing] && (
        <Sheet testId="remove-sheet" title={`Remove ${state.members[removing].name}?`} onClose={() => setRemoving(null)}>
          <p className="sheet-text" data-testid="remove-text">
            This deletes {state.members[removing].name}’s favourites, taste, watched list, hidden titles and personal watchlist for good, and
            {removing === me ? ' signs this phone out' : ' signs their phone out'}. Shared things like the “Ours” watchlist and Matches stay.
          </p>
          <div className="sheet-options">
            <button
              type="button"
              className="sheet-option danger"
              data-testid="remove-confirm"
              onClick={async () => {
                const id = removing;
                setRemoving(null);
                try {
                  await sync.removeMember(id);
                } catch (e) {
                  toast(plainError(e, 'Could not remove them. Please try again.'));
                }
              }}
            >
              Yes, remove {state.members[removing].name}
            </button>
            <button type="button" className="sheet-option" data-testid="remove-cancel" onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}

      {deleting && <DeleteSheet step={deleting} setStep={setDeleting} />}
    </div>
  );
}

function InviteBlock({ full }: { full: boolean }) {
  const { services, toast } = useApp();
  const { sync, siteUrl } = services;
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = code ? buildInviteLink(siteUrl, code) : '';

  const make = async () => {
    setBusy(true);
    try {
      setCode(await sync.createInvite());
    } catch (e) {
      toast(plainError(e, 'Could not make an invite. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    try {
      if (nav.share) {
        await nav.share({ title: APP_NAME, text: `Join my household on ${APP_NAME}`, url: link });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied');
    } catch {
      toast('Couldn’t copy. Type the code instead.');
    }
  };

  return (
    <section className="block" data-testid={full ? 'invite-rejoin' : 'invite-block'}>
      <h2>{full ? 'Let a member back in' : 'Invite someone'}</h2>
      <p className="muted small">
        {full
          ? `This household is full (${MAX_MEMBERS} people), so this link can only be used by an existing member on a new or reset phone, who picks “I’m already a member”. It works once and lasts 24 hours.`
          : `Send them the link. It works once and lasts 24 hours. Up to ${MAX_MEMBERS} people can share a household.`}
      </p>
      {code ? (
        <>
          <div className="pair-code" data-testid="invite-code">{spacedCode(code)}</div>
          <p className="small center link-text" data-testid="invite-link">{link}</p>
          <button type="button" className="btn btn-primary btn-block" data-testid="invite-share" onClick={share}>
            Share the link
          </button>
          <button type="button" className="btn-link" data-testid="invite-hide" onClick={() => setCode(null)}>
            Hide
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost btn-block" data-testid="invite-make" disabled={busy} onClick={make}>
          {busy ? 'Making a link…' : full ? 'Make a link' : 'Make an invite'}
        </button>
      )}
    </section>
  );
}

function RenameBlock() {
  const { services, state, me, toast } = useApp();
  const current = nameOf(state.members, me);
  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const others = Object.values(state.members)
    .filter((m) => m.id !== me)
    .map((m) => m.name);
  const v = validateName(text, others);
  const changed = v.ok && v.name !== current;

  const save = async () => {
    if (!v.ok) return setError(v.message);
    try {
      await services.sync.renameMember(me, v.name);
      setError(null);
      toast('Name changed');
    } catch (e) {
      setError(plainError(e));
    }
  };
  return (
    <section className="block" data-testid="rename-block">
      <h2>Your name</h2>
      <input
        className="text-input"
        data-testid="rename-input"
        value={text}
        maxLength={MAX_NAME_LENGTH + 10}
        aria-label="Your name"
        autoComplete="off"
        onFocus={keepVisible}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      {(error || (text.trim() && !v.ok)) && (
        <p className="hint" data-testid="rename-error">
          {error ?? (v.ok ? '' : v.message)}
        </p>
      )}
      <button type="button" className="btn btn-ghost btn-block" data-testid="rename-save" disabled={!changed} onClick={save}>
        Save name
      </button>
    </section>
  );
}

function DeleteSheet({ step, setStep }: { step: 'explain' | 'type'; setStep: (s: 'explain' | 'type' | null) => void }) {
  const { services, toast, isSolo } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = text.trim().toUpperCase() === 'DELETE';
  const doIt = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await services.sync.deleteHousehold();
      setStep(null);
    } catch (e) {
      toast(plainError(e, 'Could not delete everything. Check your connection and try again.'));
      setBusy(false);
    }
  };
  return (
    <Sheet testId="delete-sheet" title="Delete everything?" onClose={() => setStep(null)}>
      {step === 'explain' ? (
        <>
          <p className="sheet-text" data-testid="delete-explain">
            This permanently deletes the whole household — {isSolo ? 'your' : 'everyone’s'} favourites, taste, watched lists, watchlists and matches — for
            {isSolo ? ' good' : ' everyone'}. It cannot be undone, and there is no copy anywhere.
          </p>
          <div className="sheet-options">
            <button type="button" className="sheet-option danger" data-testid="delete-continue" onClick={() => setStep('type')}>
              I understand, continue
            </button>
            <button type="button" className="sheet-option" data-testid="delete-cancel" onClick={() => setStep(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="sheet-text">To be sure, type <strong>DELETE</strong> below.</p>
          <input
            className="text-input"
            data-testid="delete-input"
            value={text}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            aria-label="Type DELETE to confirm"
            placeholder="DELETE"
            onFocus={keepVisible}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="sheet-options">
            <button type="button" className="sheet-option danger" data-testid="delete-confirm" disabled={!ready || busy} onClick={doIt}>
              {busy ? 'Deleting…' : 'Delete everything for good'}
            </button>
            <button type="button" className="sheet-option" data-testid="delete-cancel" onClick={() => setStep(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <div data-testid="privacy" className="profile">
      <BackLink onBack={onBack} />
      <section className="block prose">
        <h2>Privacy</h2>
        <h3>What is stored</h3>
        <p>For each household: the names people typed, the streaming services chosen, each person’s favourites, what they’ve watched, never want to see, saved to watchlists and liked (matches), and the taste the app has learned from swiping.</p>
        <h3>What is not stored</h3>
        <p>No email address, no location, no contacts. No analytics, no tracking and no ads.</p>
        <h3>Where it lives</h3>
        <p>On Google’s Firebase service, which this app uses to keep the phones in a household in sync. Only phones in your household can read it.</p>
        <h3>No sign-in</h3>
        <p>There are no accounts. A phone is part of a household because it holds the household’s saved pairing, so your lists live with the household’s phones. If you are the only person in a household and you lose your phone, there is nobody left to invite you back.</p>
        <h3>Deleting it</h3>
        <p>Anyone in a household can use Settings › Delete everything to permanently erase the whole household for everyone.</p>
      </section>
    </div>
  );
}

function About({ onBack }: { onBack: () => void }) {
  const { catalog, services } = useApp();
  const [logoOk, setLogoOk] = useState(true);
  const builtIso = catalog?.builtAt || services.newArrivals.builtAt;
  const built = builtIso ? new Date(builtIso) : null;
  const builtText = built && !isNaN(built.getTime()) ? built.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'not yet loaded';
  return (
    <div data-testid="about" className="profile">
      <BackLink onBack={onBack} />
      <section className="block">
        <h2>About {APP_NAME}</h2>
        <p className="small">{APP_NAME} helps a household choose what to watch from the streaming services they already pay for.</p>
        <p className="small" data-testid="about-free">A free, non-commercial passion project: no ads, no fees, no accounts.</p>
        {logoOk && (
          <img
            className="tmdb-logo"
            data-testid="about-tmdb-logo"
            src={`${import.meta.env.BASE_URL}tmdb-logo.svg`}
            alt="The Movie Database (TMDB)"
            onError={() => setLogoOk(false)}
          />
        )}
        <p className="small" data-testid="about-tmdb">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p className="small" data-testid="about-justwatch">Streaming availability data provided by JustWatch.</p>
        <p className="small muted" data-testid="about-built">Catalog last updated: {builtText}</p>
      </section>
    </div>
  );
}
