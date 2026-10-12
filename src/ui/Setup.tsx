import { useEffect, useState } from 'react';
import { MAX_NAME_LENGTH, subscribedServices, type AppServices, type DeviceState, type InvitePreview, type PlanSelection } from '../contracts';
import { APP_NAME, APP_TAGLINE } from '../config';
import { ServicesPicker, keepVisible } from './Pickers';
import { WizardFrame, writeMarker } from './Wizard';
import { plainError, readLocal, writeLocal } from './context';
import { SPENT_CODES_KEY, STALE_INVITE_NOTE, addSpentCode, looksOffline, normalizeCode, parseSpentCodes, spacedCode, validateName, type WizardRole } from './helpers';

export function Splash({ message }: { message: string }) {
  return (
    <div className="splash" data-testid="splash">
      <div className="splash-logo">{APP_NAME}</div>
      <div className="spinner" />
      <p>{message}</p>
    </div>
  );
}

const SKIP_INSTALL_KEY = 'pt.install.skipped';
const installSkipped = () => {
  try {
    return sessionStorage.getItem(SKIP_INSTALL_KEY) === '1';
  } catch {
    return false;
  }
};

type Stage = 'install' | 'choose' | 'code' | 'preview' | 'name' | 'services' | 'existing';
type Purpose = 'create' | 'join-new';
type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: InvitePreview };

export function DeviceErrorBanner({ device }: { device: DeviceState }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!device.error || dismissed === device.error) return null;
  return (
    <div className="notice error device-error" data-testid="device-error" role="alert">
      <p>{device.error}</p>
      {device.status === 'unpaired' && (
        <p className="small muted" data-testid="device-error-next">
          You can start a new household, or join one with an invite code, below.
        </p>
      )}
      <button type="button" className="btn-link" data-testid="device-error-dismiss" onClick={() => setDismissed(device.error)}>
        OK
      </button>
    </div>
  );
}

/** Before this phone is in a household: install guidance, create or join, name, (services). */
export function Setup({ services, device }: { services: AppServices; device: DeviceState }) {
  const { sync, engine, standalone } = services;
  const [stage, setStage] = useState<Stage>(() => {
    if (!standalone && !installSkipped()) return 'install';
    return services.joinCode ? 'preview' : 'choose';
  });
  const [typedCode, setTypedCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const code = typedCode || services.joinCode || '';
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [purpose, setPurpose] = useState<Purpose>('create');
  const [nameText, setNameText] = useState('');
  const [plans, setPlans] = useState<PlanSelection>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [staleNote, setStaleNote] = useState(false);

  // Look at the invite whenever we land on the preview step.
  const [previewTry, setPreviewTry] = useState(0);
  useEffect(() => {
    if (stage !== 'preview' || !code) return;
    let live = true;
    setPreview({ status: 'loading' });
    sync
      .previewInvite(code)
      .then((data) => live && setPreview({ status: 'ok', data }))
      .catch((e) => {
        if (!live) return;
        const message = plainError(e, 'That invite code didn’t work.');
        // The link in the address is dead (used / expired / wrong): remember that, and don't dead-end.
        if (!typedCode && code === services.joinCode && !looksOffline(message)) {
          writeLocal(SPENT_CODES_KEY, addSpentCode(parseSpentCodes(readLocal<unknown>(SPENT_CODES_KEY, [])), code));
          setStaleNote(true);
          setStage('choose');
          return;
        }
        setPreview({ status: 'error', message });
      });
    return () => {
      live = false;
    };
  }, [stage, code, previewTry, sync]);

  const role: WizardRole = purpose === 'create' ? 'creator' : 'joiner';
  const takenNames = preview.status === 'ok' && purpose === 'join-new' ? preview.data.members.map((m) => m.name) : [];
  const hasService = subscribedServices(plans).length > 0;

  const go = (s: Stage) => {
    setError(null);
    setStage(s);
  };

  const finishCreate = async () => {
    const v = validateName(nameText, []);
    if (!v.ok || !hasService || busy) return;
    setBusy(true);
    setError(null);
    try {
      writeMarker({ role: 'creator', step: 'favorites' });
      await sync.createHousehold(v.name, engine.emptyProfile(), { plans });
      void services.catalogs.load(subscribedServices(plans)).catch(() => {});
    } catch (e) {
      writeMarker(null);
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  const finishJoinNew = async () => {
    const v = validateName(nameText, takenNames);
    if (!v.ok) {
      setError(v.message);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      writeMarker({ role: 'joiner', step: 'favorites' });
      await sync.joinWithCode(code, { name: v.name, profile: engine.emptyProfile() });
    } catch (e) {
      writeMarker(null);
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  const joinExisting = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      writeMarker(null);
      await sync.joinWithCode(code, { memberId: chosen });
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  const errorBox = error && (
    <div className="notice error" data-testid="pair-error" role="alert">
      {error}
    </div>
  );
  const banner = <DeviceErrorBanner device={device} />;

  // ---- install guidance ----
  if (stage === 'install') {
    const invited = !!services.joinCode;
    return (
      <div className="screen setup scroll-center" data-testid="welcome">
        <div className="setup-hero">
          <div className="splash-logo">{APP_NAME}</div>
          <p className="tagline">{invited ? 'You’ve been invited' : APP_TAGLINE}</p>
        </div>
        {banner}
        <h2 className="setup-q" data-testid="install-title">
          First, add it to your Home Screen
        </h2>
        <ol className="install-steps" data-testid="install-steps">
          <li>
            <span className="num">1</span>
            <span>
              Tap the <strong>Share</strong> button in Safari (the square with an arrow, at the bottom of the screen).
            </span>
          </li>
          <li>
            <span className="num">2</span>
            <span>
              Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </span>
          </li>
          <li>
            <span className="num">3</span>
            <span>
              Close Safari and open {APP_NAME} <strong>from its icon</strong>.
            </span>
          </li>
        </ol>
        <p className="small muted center" data-testid="install-why">
          Why? The app keeps your lists on the Home Screen version. On iPhone, Safari and the Home Screen app don’t share anything, so what you set up in a
          browser tab would be left behind.
        </p>
        {invited && (
          <div className="invite-note" data-testid="install-invite">
            <p className="small">
              Your invite travels with the Home Screen icon automatically, so you shouldn’t need to do anything else. If it ever asks, here’s the code:
            </p>
            <div className="pair-code" data-testid="install-invite-code">{spacedCode(services.joinCode!)}</div>
          </div>
        )}
        <button
          type="button"
          className="btn-link"
          data-testid="continue-in-browser"
          onClick={() => {
            try {
              sessionStorage.setItem(SKIP_INSTALL_KEY, '1');
            } catch {
              /* private mode */
            }
            go(services.joinCode ? 'preview' : 'choose');
          }}
        >
          Continue in the browser anyway
        </button>
      </div>
    );
  }

  // ---- create or join ----
  if (stage === 'choose') {
    return (
      <div className="screen setup" data-testid="setup">
        <div className="setup-hero">
          <div className="splash-logo">{APP_NAME}</div>
          <p className="tagline">{APP_TAGLINE}</p>
        </div>
        {banner}
        <p className="center muted" data-testid="setup-blurb">
          Swipe through picks that are actually on the streaming services you pay for. Free, no ads, no sign-in.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          data-testid="start-household"
          onClick={() => {
            setPurpose('create');
            go('name');
          }}
        >
          Start a new household
        </button>
        <button type="button" className="btn btn-ghost btn-lg" data-testid="have-code" onClick={() => go('code')}>
          I have an invite code
        </button>
        {staleNote && (
          <div className="notice warn" data-testid="invite-stale-note" role="status">
            {STALE_INVITE_NOTE}
          </div>
        )}
        {errorBox}
      </div>
    );
  }

  if (stage === 'code') {
    return (
      <div className="screen setup" data-testid="setup-code">
        <h2 className="setup-q">
          Enter your invite code <span className="muted">from the person who invited you (Us › Settings › Invite someone)</span>
        </h2>
        {banner}
        <input
          className="code-input"
          data-testid="code-input"
          value={codeInput}
          onChange={(e) => setCodeInput(normalizeCode(e.target.value))}
          onFocus={keepVisible}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          placeholder="ABC123"
          aria-label="Invite code"
        />
        {errorBox}
        <button
          type="button"
          className="btn btn-primary btn-lg"
          data-testid="code-submit"
          onClick={() => {
            if (codeInput.length < 4) {
              setError('Type the code from your invite.');
              return;
            }
            setTypedCode(codeInput);
            go('preview');
          }}
        >
          Continue
        </button>
        <button type="button" className="btn-link" data-testid="code-back" onClick={() => go('choose')}>
          Back
        </button>
      </div>
    );
  }

  // ---- invite preview ----
  if (stage === 'preview') {
    const retype = () => {
      setTypedCode('');
      setCodeInput('');
      go('code');
    };
    return (
      <div className="screen setup" data-testid="invite-preview">
        <div className="setup-hero">
          <div className="splash-logo">{APP_NAME}</div>
          <p className="tagline">You’ve been invited</p>
        </div>
        {banner}
        {preview.status === 'loading' && (
          <div className="inline-status" data-testid="invite-loading" role="status">
            <div className="spinner" />
            <span>Checking your invite…</span>
          </div>
        )}
        {preview.status === 'error' && (
          <>
            <div className="notice error" data-testid="invite-error" role="alert">
              {preview.message}
            </div>
            <button type="button" className="btn btn-ghost btn-lg" data-testid="invite-retry" onClick={() => setPreviewTry((n) => n + 1)}>
              Try again
            </button>
            <button type="button" className="btn btn-primary btn-lg" data-testid="invite-other-code" onClick={retype}>
              Use a different code
            </button>
            <button type="button" className="btn-link" data-testid="invite-start-own" onClick={() => { setPurpose('create'); go('name'); }}>
              Or start your own household
            </button>
          </>
        )}
        {preview.status === 'ok' && (
          <>
            <h2 className="setup-q" data-testid="invite-title">
              Join{' '}
              {preview.data.members.length <= 1
                ? preview.data.members[0]?.name ?? 'this household'
                : preview.data.members
                    .map((m) => m.name)
                    .reduce((acc, n, i, arr) => (i === 0 ? n : i === arr.length - 1 ? `${acc} and ${n}` : `${acc}, ${n}`), '')}
            </h2>
            <ul className="who-list" data-testid="invite-members">
              {preview.data.members.map((m) => (
                <li key={m.id} data-member-id={m.id}>{m.name}</li>
              ))}
            </ul>
            {preview.data.full ? (
              <p className="small muted center" data-testid="invite-full">
                This household is full (4 people). If you’re already one of them, you can take your place back on this phone.
              </p>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                data-testid="join-new"
                onClick={() => {
                  setPurpose('join-new');
                  go('name');
                }}
              >
                I’m new
              </button>
            )}
            <button type="button" className={`btn btn-lg ${preview.data.full ? 'btn-primary' : 'btn-ghost'}`} data-testid="join-existing" onClick={() => go('existing')}>
              I’m already a member
            </button>
            {errorBox}
          </>
        )}
      </div>
    );
  }

  // ---- already a member ----
  if (stage === 'existing' && preview.status === 'ok') {
    return (
      <div className="screen setup" data-testid="join-existing-screen">
        <h2 className="setup-q">Which one are you?</h2>
        {banner}
        <div className="pick-list" data-testid="existing-members">
          {preview.data.members.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`pick-name ${chosen === m.id ? 'on' : ''}`}
              aria-pressed={chosen === m.id}
              data-testid={`existing-${m.id}`}
              data-member-id={m.id}
              onClick={() => setChosen(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
        {chosen && (
          <div className="notice warn" data-testid="existing-warning">
            If {preview.data.members.find((m) => m.id === chosen)?.name} is already using another phone, that phone will be signed out. Their lists and taste stay
            exactly as they are.
          </div>
        )}
        {errorBox}
        <button type="button" className="btn btn-primary btn-lg" data-testid="existing-confirm" disabled={!chosen || busy} onClick={joinExisting}>
          {busy ? 'Joining…' : 'That’s me'}
        </button>
        <button type="button" className="btn-link" data-testid="existing-back" onClick={() => go('preview')}>
          Back
        </button>
      </div>
    );
  }

  // ---- name ----
  if (stage === 'name') {
    const v = validateName(nameText, takenNames);
    const isCreate = purpose === 'create';
    return (
      <WizardFrame
        testId="setup-name"
        role={role}
        step="name"
        title="What should we call you?"
        intro={<p>{isCreate ? 'This is how you’ll show up to anyone you invite.' : 'This is how you’ll show up to the others in the household.'}</p>}
        onBack={() => go(isCreate ? 'choose' : 'preview')}
        footer={
          <button
            type="button"
            className="btn btn-primary btn-lg"
            data-testid="wizard-next"
            disabled={!v.ok || busy}
            onClick={() => {
              if (isCreate) go('services');
              else void finishJoinNew();
            }}
          >
            {isCreate ? 'Next' : busy ? 'Joining…' : 'Join'}
          </button>
        }
      >
        {banner}
        <input
          className="text-input"
          data-testid="name-input"
          value={nameText}
          maxLength={MAX_NAME_LENGTH + 10}
          autoFocus
          autoCapitalize="words"
          autoComplete="off"
          autoCorrect="off"
          placeholder="Your name"
          aria-label="Your name"
          onFocus={keepVisible}
          onChange={(e) => {
            setNameText(e.target.value);
            setError(null);
          }}
        />
        <p className="hint" data-testid="name-hint">
          {nameText.trim() && !v.ok ? v.message : `Up to ${MAX_NAME_LENGTH} characters.`}
        </p>
        {errorBox}
      </WizardFrame>
    );
  }

  // ---- services (creator) ----
  return (
    <WizardFrame
      testId="setup-services"
      role="creator"
      step="services"
      title="Which streaming services do you have?"
      intro={<p>We only suggest things you can watch right now, so we need at least one. Everyone in the household can change this later.</p>}
      onBack={() => go('name')}
      footer={
        <button type="button" className="btn btn-primary btn-lg" data-testid="wizard-next" disabled={!hasService || busy} onClick={finishCreate}>
          {busy ? 'Setting up…' : hasService ? 'Next' : 'Choose at least one'}
        </button>
      }
    >
      {banner}
      <ServicesPicker plans={plans} onChange={setPlans} />
      {errorBox}
    </WizardFrame>
  );
}

