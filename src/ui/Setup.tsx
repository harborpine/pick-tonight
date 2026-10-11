import { useState } from 'react';
import { DEFAULT_PLANS, type AppServices, type DeviceState, type PersonId } from '../contracts';
import { APP_NAME, APP_TAGLINE } from '../config';

export function Splash({ message }: { message: string }) {
  return (
    <div className="splash" data-testid="splash">
      <div className="splash-logo">{APP_NAME}</div>
      <div className="spinner" />
      <p>{message}</p>
    </div>
  );
}

function plainError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}

/** First run: who are you, then start the household or join with a code. */
export function Setup({ services, device }: { services: AppServices; device: DeviceState }) {
  const { sync, engine, catalog } = services;
  const [person, setPerson] = useState<PersonId | null>(null);
  const [mode, setMode] = useState<'choose' | 'code'>('choose');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!person || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sync.createHousehold(person, {
        profiles: { HG: engine.defaultProfile('HG', catalog), BG: engine.defaultProfile('BG', catalog) },
        settings: { plans: DEFAULT_PLANS },
      });
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!person || busy) return;
    const clean = code.replace(/\s+/g, '').toUpperCase();
    if (clean.length < 4) {
      setError('Type the code shown on the other phone.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sync.joinWithCode(clean, person);
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen setup" data-testid="setup">
      <div className="setup-hero">
        <div className="splash-logo">{APP_NAME}</div>
        <p className="tagline">{APP_TAGLINE}</p>
      </div>

      {device.error && (
        <div className="notice error" data-testid="device-error">
          {device.error}
        </div>
      )}

      {!person && (
        <>
          <h2 className="setup-q">Who are you?</h2>
          <div className="person-row">
            {(['HG', 'BG'] as PersonId[]).map((p) => (
              <button key={p} type="button" className="person-btn" data-testid={`person-${p}`} onClick={() => setPerson(p)}>
                {p}
              </button>
            ))}
          </div>
        </>
      )}

      {person && mode === 'choose' && (
        <>
          <h2 className="setup-q">
            Hi {person}. <span className="muted">Is this the first phone?</span>
          </h2>
          <button type="button" className="btn btn-primary btn-lg" data-testid="start-household" disabled={busy} onClick={start}>
            {busy ? 'Setting up…' : 'Start — this is the first phone'}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" data-testid="have-code" onClick={() => { setMode('code'); setError(null); }}>
            I have a code
          </button>
          <button type="button" className="btn-link" data-testid="change-person" onClick={() => setPerson(null)}>
            Not {person}?
          </button>
        </>
      )}

      {person && mode === 'code' && (
        <>
          <h2 className="setup-q">
            Enter the code <span className="muted">from the other phone (Us {'›'} Settings)</span>
          </h2>
          <input
            className="code-input"
            data-testid="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            placeholder="ABC123"
            aria-label="Pairing code"
          />
          <button type="button" className="btn btn-primary btn-lg" data-testid="code-submit" disabled={busy} onClick={join}>
            {busy ? 'Checking…' : 'Join'}
          </button>
          <button type="button" className="btn-link" data-testid="code-back" onClick={() => { setMode('choose'); setError(null); }}>
            Back
          </button>
        </>
      )}

      {error && (
        <div className="notice error" data-testid="pair-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
