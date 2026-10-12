import { useMemo, useState, type ReactNode } from 'react';
import type { MemberId } from '../contracts';
import { Poster } from './components';
import { CatalogGate } from './Pickers';
import { useApp } from './context';
import { nameOf, snapshotOf } from './helpers';

export interface SeenGridApi {
  count: number;
  busy: boolean;
  /** Save the ticks (adds and removals), then resolve. Rejects with nothing saved on failure. */
  save: () => Promise<boolean>;
}

/** "Tick what you've seen" poster grid. The caller supplies the footer buttons. */
export function SeenGrid({ memberId, footer }: { memberId: MemberId; footer: (api: SeenGridApi) => ReactNode }) {
  const { services, state, catalog, toast } = useApp();
  const { engine, sync } = services;
  const titles = useMemo(
    () => (catalog ? engine.onboardingTitles(catalog, state.settings.plans, 60) : []),
    // The list should not reshuffle while ticking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog === null],
  );
  const alreadySeen = useMemo(() => new Set(Object.keys(state.seen[memberId] ?? {})), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<Set<string>>(() => new Set(alreadySeen));
  const [busy, setBusy] = useState(false);
  const count = titles.reduce((n, t) => n + (picked.has(t.id) ? 1 : 0), 0);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const save = async (): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      const shown = new Set(titles.map((t) => t.id));
      const add = [...picked].filter((id) => !alreadySeen.has(id) && shown.has(id));
      const remove = [...alreadySeen].filter((id) => shown.has(id) && !picked.has(id));
      const byId = new Map(titles.map((t) => [t.id, t]));
      if (add.length) {
        await sync.markWatched(
          memberId,
          add.flatMap((id) => {
            const t = byId.get(id);
            return t ? [{ itemId: id, source: 'onboarding' as const, snapshot: snapshotOf(t) }] : [];
          }),
        );
      }
      if (remove.length) await sync.unmarkWatched(memberId, remove);
      return true;
    } catch {
      toast('Could not save that. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="wiz-body">
        <CatalogGate>
          {titles.length === 0 ? (
            <p className="empty-note" data-testid="onboard-empty">
              There are no popular titles to show for your services yet.
            </p>
          ) : (
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
          )}
        </CatalogGate>
      </div>
      {footer({ count, busy, save })}
    </>
  );
}

/** Full-screen version, opened from a profile page ("Tick what Sam has seen"). */
export function Onboarding({ memberId, onClose }: { memberId: MemberId; onClose: () => void }) {
  const { state } = useApp();
  const name = nameOf(state.members, memberId);
  return (
    <div className="screen onboarding" data-testid="onboarding">
      <header className="onboarding-head">
        <h1>What has {name} seen?</h1>
        <p>Tap the ones already watched. It helps us stop suggesting them.</p>
      </header>
      <SeenGrid
        memberId={memberId}
        footer={({ count, busy, save }) => (
          <footer className="onboarding-foot">
            <button type="button" className="btn btn-ghost" data-testid="onboard-skip" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="onboard-done"
              disabled={busy}
              onClick={async () => {
                if (await save()) onClose();
              }}
            >
              Done{count ? ` (${count})` : ''}
            </button>
          </footer>
        )}
      />
    </div>
  );
}
