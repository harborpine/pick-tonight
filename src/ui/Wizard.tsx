import { useState, type ReactNode } from 'react';
import { MAX_FAVORITES, type Dealbreakers, type FavoriteTitle, type Profile } from '../contracts';
import { Icon } from './components';
import { ImportSection } from './Import';
import { SeenGrid } from './Onboarding';
import { FavoritesEditor, NeverEditor } from './Pickers';
import { readLocal, useApp, writeLocal } from './context';
import { neighbourStep, resumeStep, SOLO_LOSS_WARNING, wizardProgress, type SavedStep, type WizardRole, type WizardStep } from './helpers';

export const WIZARD_KEY = 'pt.wizard.v1';

export interface WizardMarker {
  role: WizardRole;
  step: WizardStep | 'done';
}

export function readMarker(): WizardMarker | null {
  const m = readLocal<WizardMarker | null>(WIZARD_KEY, null);
  return m && (m.role === 'creator' || m.role === 'joiner') ? m : null;
}
export function writeMarker(m: WizardMarker | null) {
  if (m) writeLocal(WIZARD_KEY, m);
  else {
    try {
      localStorage.removeItem(WIZARD_KEY);
    } catch {
      /* private mode */
    }
  }
}

export function Dots({ role, step }: { role: WizardRole; step: WizardStep }) {
  const { index, total } = wizardProgress(role, step);
  return (
    <div className="dots" data-testid="wizard-dots" data-index={index} data-total={total} role="img" aria-label={`Step ${index + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i === index ? 'on' : i < index ? 'past' : ''} />
      ))}
    </div>
  );
}

export function WizardFrame({
  title,
  intro,
  role,
  step,
  onBack,
  children,
  footer,
  testId,
}: {
  title: string;
  intro?: ReactNode;
  role: WizardRole;
  step: WizardStep;
  onBack?: () => void;
  children: ReactNode;
  footer: ReactNode;
  testId: string;
}) {
  return (
    <div className="screen wizard" data-testid={testId} data-step={step}>
      <div className="wiz-top">
        <button type="button" className="icon-btn" aria-label="Back" data-testid="wizard-back" onClick={onBack} disabled={!onBack} style={{ visibility: onBack ? 'visible' : 'hidden' }}>
          {Icon.back}
        </button>
        <Dots role={role} step={step} />
        <span className="wiz-top-gap" />
      </div>
      <div className="wiz-body">
        <h1 className="wiz-title" data-testid="wizard-title">{title}</h1>
        {intro && <div className="wiz-intro">{intro}</div>}
        {children}
      </div>
      <footer className="wiz-foot">{footer}</footer>
    </div>
  );
}

/** The steps after the person exists: favourites, never-show-me, import, seen grid, all done. */
export function Wizard() {
  const { services, state, me, isSolo, toast } = useApp();
  const { sync } = services;
  const marker = readMarker();
  const role: WizardRole = marker?.role ?? 'joiner';
  const [step, setStepState] = useState<SavedStep | 'done'>(() => (marker?.step === 'done' ? 'done' : resumeStep(role, marker?.step)));
  const [busy, setBusy] = useState(false);

  const setStep = (s: SavedStep | 'done') => {
    setStepState(s);
    writeMarker({ role, step: s });
  };
  const profile = state.profiles[me];
  const latest = (): Profile => sync.getState()?.profiles[me] ?? profile;
  const save = async (p: Profile) => {
    try {
      await sync.saveProfile(p);
    } catch {
      toast('Could not save that. Please try again.');
    }
  };

  const next = (from: SavedStep) => setStep((neighbourStep(role, from, 1) as SavedStep | null) ?? 'done');
  const back = (from: SavedStep) => {
    const prev = neighbourStep(role, from, -1);
    return prev && prev !== 'name' && prev !== 'services' ? () => setStep(prev as SavedStep) : undefined;
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sync.saveProfile({ ...latest(), onboarded: true });
      writeMarker(null);
    } catch {
      toast('Could not save that. Please try again.');
      setBusy(false);
    }
  };

  const footer = (from: SavedStep, nextLabel = 'Next', canNext = true, onNext?: () => void | Promise<void>) => (
    <>
      <button type="button" className="btn btn-ghost" data-testid="wizard-skip" onClick={() => next(from)}>
        Skip
      </button>
      <button
        type="button"
        className="btn btn-primary"
        data-testid="wizard-next"
        disabled={!canNext}
        onClick={async () => {
          if (onNext) await onNext();
          else next(from);
        }}
      >
        {nextLabel}
      </button>
    </>
  );

  if (step === 'favorites') {
    return (
      <WizardFrame
        testId="wizard-favorites"
        role={role}
        step="favorites"
        title="What do you love watching?"
        intro={<p data-testid="wizard-fav-aim">Pick 5–10 you love — it’s how we learn your taste. Anything counts, even if it isn’t on your services.</p>}
        onBack={back('favorites')}
        footer={footer('favorites', profile.favorites.length ? `Next (${profile.favorites.length})` : 'Next')}
      >
        <FavoritesEditor
          favorites={profile.favorites}
          onChange={(favs: FavoriteTitle[]) => void save({ ...latest(), favorites: favs.slice(0, MAX_FAVORITES) })}
        />
      </WizardFrame>
    );
  }
  if (step === 'never') {
    return (
      <WizardFrame
        testId="wizard-never"
        role={role}
        step="never"
        title="Never show me…"
        intro={<p>Anything you switch on is left out of every suggestion for you, and for anyone watching with you. You can change this any time.</p>}
        onBack={back('never')}
        footer={footer('never')}
      >
        <NeverEditor value={profile.dealbreakers} onChange={(d: Dealbreakers) => void save({ ...latest(), dealbreakers: d })} />
      </WizardFrame>
    );
  }
  if (step === 'import') {
    return (
      <WizardFrame
        testId="wizard-import"
        role={role}
        step="import"
        title="Teach it faster"
        intro={<p>Importing what you’ve already watched is the fastest way to teach it your taste. Totally optional.</p>}
        onBack={back('import')}
        footer={footer('import')}
      >
        <ImportSection memberId={me} />
      </WizardFrame>
    );
  }
  if (step === 'seen') {
    return (
      <div className="screen wizard" data-testid="wizard-seen" data-step="seen">
        <div className="wiz-top">
          <button type="button" className="icon-btn" aria-label="Back" data-testid="wizard-back" onClick={back('seen')}>
            {Icon.back}
          </button>
          <Dots role={role} step="seen" />
          <span className="wiz-top-gap" />
        </div>
        <h1 className="wiz-title pad" data-testid="wizard-title">What have you seen?</h1>
        <p className="wiz-intro pad">Tap the ones you’ve already watched, so we don’t suggest them.</p>
        <SeenGrid
          memberId={me}
          footer={({ count, busy: b, save: saveSeen }) => (
            <footer className="wiz-foot">
              <button type="button" className="btn btn-ghost" data-testid="wizard-skip" disabled={b} onClick={() => next('seen')}>
                Skip
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="wizard-next"
                disabled={b}
                onClick={async () => {
                  if (await saveSeen()) next('seen');
                }}
              >
                Next{count ? ` (${count})` : ''}
              </button>
            </footer>
          )}
        />
      </div>
    );
  }

  // done
  return (
    <div className="screen wizard" data-testid="wizard-done" data-step="done">
      <div className="wiz-body center-body">
        <div className="empty-emoji">{'🎬'}</div>
        <h1 className="wiz-title">You’re all set</h1>
        <p className="wiz-intro">Your picks will get better the more you swipe, add favourites and import what you’ve watched.</p>
        {isSolo && (
          <div className="notice warn" data-testid="solo-warning">
            <strong>One thing to know</strong>
            <p>{SOLO_LOSS_WARNING}</p>
          </div>
        )}
      </div>
      <footer className="wiz-foot single">
        <button type="button" className="btn btn-primary btn-lg" data-testid="wizard-finish" disabled={busy} onClick={finish}>
          {busy ? 'Just a moment…' : 'Start picking'}
        </button>
      </footer>
    </div>
  );
}
