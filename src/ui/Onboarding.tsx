import { useMemo, useState } from 'react';
import type { PersonId } from '../contracts';
import { Poster } from './components';
import { useApp } from './context';
import { snapshotOf } from './helpers';

/** "Tick what you've seen" poster grid. Skippable; reachable again from the profile page. */
export function Onboarding({ person, onClose }: { person: PersonId; onClose: () => void }) {
  const { services, state, toast } = useApp();
  const { engine, catalog, sync } = services;
  const titles = useMemo(
    () => engine.onboardingTitles(catalog, state.settings.plans, 60),
    // The list should not reshuffle while ticking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const alreadySeen = useMemo(() => new Set(Object.keys(state.seen[person] ?? {})), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<Set<string>>(() => new Set(alreadySeen));
  const [busy, setBusy] = useState(false);
  // Only count tiles on this grid (an imported history can hold thousands of other titles).
  const pickedShown = titles.reduce((n, t) => n + (picked.has(t.id) ? 1 : 0), 0);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const finish = async (save: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (save) {
        const shown = new Set(titles.map((t) => t.id));
        const add = [...picked].filter((id) => !alreadySeen.has(id));
        const remove = [...alreadySeen].filter((id) => shown.has(id) && !picked.has(id));
        const byId = new Map(titles.map((t) => [t.id, t]));
        if (add.length) {
          await sync.markWatched(
            person,
            add.flatMap((id) => {
              const t = byId.get(id);
              return t ? [{ itemId: id, source: 'onboarding' as const, snapshot: snapshotOf(t) }] : [];
            }),
          );
        }
        if (remove.length) await sync.unmarkWatched(person, remove);
      }
      const profile = sync.getState()?.profiles[person] ?? state.profiles[person];
      if (!profile.onboarded) await sync.saveProfile({ ...profile, onboarded: true });
      onClose();
    } catch {
      toast('Could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen onboarding" data-testid="onboarding">
      <header className="onboarding-head">
        <h1>What have you seen, {person}?</h1>
        <p>Tap the ones you&rsquo;ve already watched. It helps us stop suggesting them.</p>
      </header>
      <div className="onboard-grid">
        {titles.map((t) => {
          const on = picked.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={`onboard-item ${on ? 'on' : ''}`}
              data-testid={`onboard-item-${t.id}`}
              data-item-id={t.id}
              data-selected={on}
              aria-pressed={on}
              onClick={() => toggle(t.id)}
            >
              <Poster title={t.title} year={t.year} poster={t.poster} size="w185" compact />
              <span className="onboard-title">{t.title}</span>
              {on && <span className="onboard-check">{'✓'}</span>}
            </button>
          );
        })}
      </div>
      <footer className="onboarding-foot">
        <button type="button" className="btn btn-ghost" data-testid="onboard-skip" disabled={busy} onClick={() => finish(false)}>
          Skip
        </button>
        <button type="button" className="btn btn-primary" data-testid="onboard-done" disabled={busy} onClick={() => finish(true)}>
          Done{pickedShown ? ` (${pickedShown})` : ''}
        </button>
      </footer>
    </div>
  );
}
