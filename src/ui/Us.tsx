import { useMemo, useState } from 'react';
import { APP_NAME } from '../config';
import { SERVICES, type PersonId, type Profile } from '../contracts';
import { Header, Segmented, Sheet } from './components';
import { useApp } from './context';

type UsTab = 'HG' | 'BG' | 'settings';

export function Us() {
  const { me } = useApp();
  const [tab, setTab] = useState<UsTab>(me);
  return (
    <div className="screen with-tabs scroll" data-testid="us">
      <Header title="Us" />
      <Segmented
        testPrefix="us-seg"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'HG', label: me === 'HG' ? 'HG (me)' : 'HG' },
          { value: 'BG', label: me === 'BG' ? 'BG (me)' : 'BG' },
          { value: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'settings' ? <Settings /> : <ProfilePage key={tab} person={tab} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const DEALBREAKERS: { key: keyof Profile['dealbreakers']; label: string }[] = [
  { key: 'horror', label: 'No horror' },
  { key: 'trueCrime', label: 'No true crime' },
  { key: 'scary', label: 'Nothing scary' },
];

function ProfilePage({ person }: { person: PersonId }) {
  const { services, state, titleOf, startOnboarding, toast } = useApp();
  const { engine, catalog, sync } = services;
  const profile = state.profiles[person];
  const [showAllSeen, setShowAllSeen] = useState(false);

  const insights = useMemo(() => engine.describeTaste(profile, catalog), [engine, profile, catalog]);

  const latest = (): Profile => sync.getState()?.profiles[person] ?? profile;
  const save = async (p: Profile) => {
    try {
      await sync.saveProfile(p);
    } catch {
      toast('Could not save that. Please try again.');
    }
  };

  const seenIds = Object.entries(state.seen[person] ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const neverIds = Object.entries(state.never[person] ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  return (
    <div data-testid={`profile-${person}`} className="profile">
      <section className="block">
        <h2>Favourites</h2>
        <div className="fav-list" data-testid="profile-favorites">
          {profile.favorites.length === 0 && <span className="muted">None yet.</span>}
          {profile.favorites.map((id) => (
            <span key={id} className="fav" data-item-id={id}>
              {titleOf(id)}
            </span>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Dealbreakers</h2>
        {DEALBREAKERS.map((d) => {
          const on = profile.dealbreakers[d.key];
          return (
            <button
              key={d.key}
              type="button"
              role="switch"
              aria-checked={on}
              className="switch-row"
              data-testid={`dealbreaker-${d.key}`}
              data-on={on}
              onClick={() => save({ ...latest(), dealbreakers: { ...latest().dealbreakers, [d.key]: !on } })}
            >
              <span>{d.label}</span>
              <span className={`switch ${on ? 'on' : ''}`}>
                <span />
              </span>
            </button>
          );
        })}
      </section>

      <section className="block">
        <h2>What the app has learned</h2>
        {insights.length === 0 && <p className="muted" data-testid="insights-empty">Nothing yet. Keep swiping and it will pick up your taste.</p>}
        <ul className="insights">
          {insights.map((i) => (
            <li key={i.key} className="insight" data-testid="insight-line" data-key={i.key} data-correction={i.correction ?? ''}>
              <div className="insight-text">
                <span data-testid="insight-text">{i.text}</span>
                <small>
                  {i.source === 'favorites' ? 'From favourites' : i.source === 'learned' ? 'Learned from swipes' : 'You set this'}
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
        <p className="muted small">Titles marked as seen (favourites count too).</p>
        <ul className="plain-list" data-testid="seen-list">
          {seenIds.length === 0 && <li className="muted">Nothing marked yet.</li>}
          {(showAllSeen ? seenIds : seenIds.slice(0, 8)).map((id) => (
            <li key={id} data-testid="seen-row" data-item-id={id}>
              <span>{titleOf(id)}</span>
              <button type="button" className="mini-pill" data-testid="unmark-seen" onClick={() => sync.setSeen(person, [id], false)}>
                Not seen
              </button>
            </li>
          ))}
        </ul>
        {seenIds.length > 8 && !showAllSeen && (
          <button type="button" className="btn-link" data-testid="seen-show-all" onClick={() => setShowAllSeen(true)}>
            Show all {seenIds.length}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-block" data-testid="profile-redo-onboarding" onClick={() => startOnboarding(person)}>
          Tick what {person} has seen
        </button>
      </section>

      <section className="block">
        <h2>Never</h2>
        <p className="muted small">Hidden for {person}. Un-mark to bring one back.</p>
        <ul className="plain-list" data-testid="never-list">
          {neverIds.length === 0 && <li className="muted">Nothing hidden.</li>}
          {neverIds.map((id) => (
            <li key={id} data-testid="never-row" data-item-id={id}>
              <span>{titleOf(id)}</span>
              <button type="button" className="mini-pill" data-testid="unmark-never" onClick={() => sync.setNever(person, id, false)}>
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

function Settings() {
  const { services, state, me, toast } = useApp();
  const { sync, catalog } = services;
  const [code, setCode] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);

  const setPlan = async (serviceId: (typeof SERVICES)[number]['id'], planId: string | null) => {
    try {
      const current = sync.getState()?.settings ?? state.settings;
      await sync.saveSettings({ ...current, plans: { ...current.plans, [serviceId]: planId } });
    } catch {
      toast('Could not save that. Please try again.');
    }
  };

  const showCode = async () => {
    setCodeBusy(true);
    try {
      setCode(await sync.createPairingCode());
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'Could not make a code. Please try again.');
    } finally {
      setCodeBusy(false);
    }
  };

  const builtAt = new Date(catalog.builtAt);
  const builtText = isNaN(builtAt.getTime())
    ? catalog.builtAt
    : builtAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div data-testid="settings" className="profile">
      <section className="block">
        <h2>Our services</h2>
        <p className="muted small">Pick the plan you pay for. Only titles included in these plans are suggested.</p>
        {SERVICES.map((s) => (
          <div className="plan-row" key={s.id} data-testid={`plan-${s.id}`}>
            <div className="plan-name">{s.name}</div>
            <div className="chip-row wrap">
              {s.plans.map((p) => {
                const on = state.settings.plans[s.id] === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`chip chip-small ${on ? 'chip-on' : ''}`}
                    aria-pressed={on}
                    data-selected={on}
                    data-testid={`plan-${s.id}-${p.id}`}
                    onClick={() => setPlan(s.id, p.id)}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                className={`chip chip-small ${state.settings.plans[s.id] === null ? 'chip-on' : ''}`}
                aria-pressed={state.settings.plans[s.id] === null}
                data-selected={state.settings.plans[s.id] === null}
                data-testid={`plan-${s.id}-none`}
                onClick={() => setPlan(s.id, null)}
              >
                Not subscribed
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="block">
        <h2>Pair the other phone</h2>
        <p className="muted small">This phone is {me}. The code works once and expires after 15 minutes.</p>
        {code ? (
          <div className="pair-code" data-testid="pairing-code">{code}</div>
        ) : (
          <button type="button" className="btn btn-ghost btn-block" data-testid="show-pairing-code" disabled={codeBusy} onClick={showCode}>
            {codeBusy ? 'Making a code…' : 'Show a pairing code'}
          </button>
        )}
        {code && (
          <button type="button" className="btn-link" data-testid="hide-pairing-code" onClick={() => setCode(null)}>
            Hide code
          </button>
        )}
      </section>

      <section className="block" data-testid="about">
        <h2>About</h2>
        <p className="small">{APP_NAME} helps two people choose what to watch from the services they already pay for.</p>
        <p className="small" data-testid="about-tmdb">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p className="small" data-testid="about-justwatch">Streaming availability data provided by JustWatch.</p>
        <p className="small muted" data-testid="about-built">Catalog last updated: {builtText}</p>
      </section>

      <section className="block">
        <button type="button" className="btn btn-danger btn-block" data-testid="unpair" onClick={() => setConfirmUnpair(true)}>
          Unpair this phone
        </button>
      </section>

      {confirmUnpair && (
        <Sheet testId="unpair-sheet" title="Unpair this phone?" onClose={() => setConfirmUnpair(false)}>
          <p className="sheet-text">This phone forgets the household. Your shared data stays safe, and you can pair again with a code.</p>
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
              Unpair
            </button>
            <button type="button" className="sheet-option" data-testid="unpair-cancel" onClick={() => setConfirmUnpair(false)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
