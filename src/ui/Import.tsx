import { useRef, useState } from 'react';
import type { ImportResult, MemberId, ParsedHistory } from '../contracts';
import { Icon, Sheet } from './components';
import { useApp } from './context';
import { formatCount, nameOf } from './helpers';

type Stage =
  | { kind: 'idle' }
  | { kind: 'reading'; what: string }
  | { kind: 'unreadable'; reason: 'format' | 'empty' }
  | { kind: 'offline' }
  | { kind: 'broken' }
  | { kind: 'summary'; parsed: ParsedHistory; result: ImportResult; fileName: string }
  | { kind: 'saving'; done: number; total: number }
  | { kind: 'failed'; parsed: ParsedHistory; result: ImportResult; fileName: string }
  | { kind: 'done'; added: number };

const CHUNK = 500;
const UNMATCHED_PAGE = 100;

/** Resolves after the browser has painted (so a spinner shows before heavy work starts). */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => window.setTimeout(go, 0));
    window.setTimeout(go, 80); // background tabs do not run animation frames
  });
}

const plays = (n: number) => `${formatCount(n)} ${n === 1 ? 'play' : 'plays'}`;

/** "Import what you've watched": read a file or pasted list, show a summary, and only then save. */
export function ImportSection({ memberId }: { memberId: MemberId }) {
  const { services, state, me, toast, ensureCatalog } = useApp();
  const { engine, sync } = services;
  const person = nameOf(state.members, memberId);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [paste, setPaste] = useState('');
  const [confirmPartner, setConfirmPartner] = useState(false);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [unmatchedShown, setUnmatchedShown] = useState(UNMATCHED_PAGE);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const forMe = memberId === me;
  const owner = forMe ? 'my' : `${person}’s`;

  const run = async (read: () => Promise<string>, fileName: string, what: string) => {
    if (busy.current) return;
    busy.current = true;
    setUnmatchedOpen(false);
    setUnmatchedShown(UNMATCHED_PAGE);
    setStage({ kind: 'reading', what });
    try {
      await afterPaint();
      const text = await read();
      const parsed = engine.parseWatchHistory(text, fileName || undefined);
      if (parsed.format === 'unknown') {
        setStage({ kind: 'unreadable', reason: 'format' });
        return;
      }
      if (parsed.rows.length === 0) {
        setStage({ kind: 'unreadable', reason: 'empty' });
        return;
      }
      let index;
      try {
        index = await services.loadTitleIndex();
      } catch {
        setStage({ kind: 'offline' });
        return;
      }
      await afterPaint();
      const result = engine.matchWatchHistory(parsed, index);
      setStage({ kind: 'summary', parsed, result, fileName });
    } catch {
      setStage({ kind: 'broken' });
    } finally {
      busy.current = false;
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run(() => file.text(), file.name, `Reading ${file.name}…`);
    if (fileRef.current) fileRef.current.value = ''; // let the same file be picked again later
  };

  const save = async (parsed: ParsedHistory, result: ImportResult, fileName: string) => {
    if (busy.current) return;
    busy.current = true;
    const { matched } = result;
    try {
      setStage({ kind: 'saving', done: 0, total: matched.length });
      await afterPaint();
      for (let i = 0; i < matched.length; i += CHUNK) {
        const part = matched.slice(i, i + CHUNK);
        await sync.markWatched(
          memberId,
          part.map((m) => ({
            itemId: m.entry.id,
            at: m.lastWatched,
            source: 'import' as const,
            plays: m.plays,
            snapshot: { title: m.entry.title, year: m.entry.year, poster: m.entry.poster ?? null },
          })),
        );
        setStage({ kind: 'saving', done: Math.min(i + CHUNK, matched.length), total: matched.length });
        await afterPaint();
      }
      const catalog = await ensureCatalog();
      const profile = sync.getState()?.profiles[memberId] ?? state.profiles[memberId];
      await sync.saveProfile(engine.learnFromImport(profile, matched, catalog));
      setStage({ kind: 'done', added: matched.length });
      toast('Added to History');
    } catch {
      setStage({ kind: 'failed', parsed, result, fileName });
    } finally {
      busy.current = false;
    }
  };

  const reset = () => {
    setStage({ kind: 'idle' });
    setConfirmPartner(false);
  };

  return (
    <section className="block import" data-testid="import-section" data-member-id={memberId}>
      <h2>Import what you&rsquo;ve watched</h2>

      {stage.kind === 'idle' && (
        <>
          <div className="import-howto" data-testid="import-instructions">
            <p className="small">
              <strong>Netflix</strong>, in a web browser (not the app):
            </p>
            <ol className="steps">
              <li>Go to netflix.com and sign in.</li>
              <li>Account {'→'} Profiles {'→'} choose the profile.</li>
              <li>Viewing activity {'→'} scroll to the very bottom {'→'} &ldquo;Download all&rdquo;.</li>
              <li>You get a file called NetflixViewingHistory.csv. Pick it below.</li>
            </ol>
            <p className="small" data-testid="import-instructions-warning">
              Use the file for the one profile (Viewing activity {'→'} Download all), not Netflix&rsquo;s whole-account &ldquo;request my data&rdquo; export, because that one mixes everybody&rsquo;s viewing on the account.
            </p>
            <p className="muted small">
              Other services only hand over your history through a &ldquo;request my data&rdquo; form, which can take days. Any file
              they send, or a list of titles you paste, can be tried here too.
            </p>
          </div>

          <label className="btn btn-primary btn-block file-pick" data-testid="import-file-label">
            {Icon.upload}
            <span>Choose a file</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,.json,text/*,application/json"
              data-testid="import-file"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>

          <p className="muted small center">or paste a list instead</p>
          <textarea
            className="paste-box"
            rows={4}
            placeholder={'One title per line, for example\nThe Office\nInception'}
            aria-label="Paste a list of titles"
            data-testid="import-paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost btn-block"
            data-testid="import-paste-go"
            disabled={paste.trim().length === 0}
            onClick={() => void run(async () => paste, 'pasted.txt', 'Reading your list…')}
          >
            Read this list
          </button>
        </>
      )}

      {stage.kind === 'reading' && (
        <div className="inline-status" data-testid="import-reading" role="status">
          <div className="spinner" />
          <span>{stage.what}</span>
        </div>
      )}

      {(stage.kind === 'unreadable' || stage.kind === 'offline' || stage.kind === 'broken') && (
        <div className="notice error" data-testid="import-problem" data-reason={stage.kind === 'unreadable' ? stage.reason : stage.kind} role="alert">
          <p>
            {stage.kind === 'unreadable' &&
              (stage.reason === 'empty'
                ? 'That file did not have any titles in it. Nothing was changed.'
                : 'We couldn’t read that file. It should be a Netflix viewing-history download, a spreadsheet (.csv), or a plain list with one title per line. Nothing was changed.')}
            {stage.kind === 'offline' &&
              'We couldn’t load the title list to match against. Check your internet connection and try again. Nothing was changed.'}
            {stage.kind === 'broken' && 'Something went wrong while reading that. Nothing was changed. Please try again.'}
          </p>
          <button type="button" className="btn btn-ghost" data-testid="import-retry" onClick={reset}>
            Try again
          </button>
        </div>
      )}

      {(stage.kind === 'summary' || stage.kind === 'failed') && (
        <Summary
          person={person}
          owner={owner}
          stage={stage}
          knownIds={state.seen[memberId] ?? {}}
          unmatchedOpen={unmatchedOpen}
          unmatchedShown={unmatchedShown}
          onToggleUnmatched={() => setUnmatchedOpen((o) => !o)}
          onMoreUnmatched={() => setUnmatchedShown((n) => n + UNMATCHED_PAGE)}
          onCancel={reset}
          onAdd={() => (forMe ? void save(stage.parsed, stage.result, stage.fileName) : setConfirmPartner(true))}
        />
      )}

      {stage.kind === 'saving' && (
        <div className="inline-status" data-testid="import-saving" role="status">
          <div className="spinner" />
          <span data-testid="import-progress">
            Adding {formatCount(stage.done)} of {formatCount(stage.total)}{'…'}
          </span>
        </div>
      )}

      {stage.kind === 'done' && (
        <div className="notice ok" data-testid="import-result" role="status">
          <p>
            {forMe
              ? `Added ${formatCount(stage.added)} ${stage.added === 1 ? 'title' : 'titles'}. Your suggestions will now reflect them.`
              : `Added ${formatCount(stage.added)} ${stage.added === 1 ? 'title' : 'titles'} to ${person}’s History. ${person}’s suggestions will now reflect them.`}
          </p>
          <button type="button" className="btn btn-ghost" data-testid="import-again" onClick={reset}>
            Import another
          </button>
        </div>
      )}

      {confirmPartner && (stage.kind === 'summary' || stage.kind === 'failed') && (
        <Sheet testId="import-partner-sheet" title={`Add to ${person}’s History?`} onClose={() => setConfirmPartner(false)}>
          <p className="sheet-text" data-testid="import-partner-text">
            This phone is {nameOf(state.members, me)}&rsquo;s. These {formatCount(stage.result.matched.length)} titles will go into <strong>{person}&rsquo;s</strong> History and
            change {person}&rsquo;s suggestions, not yours. Only do this if the file is {person}&rsquo;s.
          </p>
          <div className="sheet-options">
            <button
              type="button"
              className="sheet-option primary"
              data-testid="import-partner-confirm"
              onClick={() => {
                setConfirmPartner(false);
                void save(stage.parsed, stage.result, stage.fileName);
              }}
            >
              Yes, add to {person}&rsquo;s History
            </button>
            <button type="button" className="sheet-option" data-testid="import-partner-cancel" onClick={() => setConfirmPartner(false)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

function Summary({
  person,
  owner,
  stage,
  knownIds,
  unmatchedOpen,
  unmatchedShown,
  onToggleUnmatched,
  onMoreUnmatched,
  onCancel,
  onAdd,
}: {
  person: string;
  owner: string;
  stage: { kind: 'summary' | 'failed'; parsed: ParsedHistory; result: ImportResult };
  knownIds: Record<string, unknown>;
  unmatchedOpen: boolean;
  unmatchedShown: number;
  onToggleUnmatched: () => void;
  onMoreUnmatched: () => void;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const { parsed, result } = stage;
  const titles = result.matched.length + result.unmatched.length;
  const totalPlays = parsed.rows.length;
  const already = result.matched.filter((m) => knownIds[m.entry.id]).length;
  const fresh = result.matched.length - already;
  const top = [...result.matched].sort((a, b) => b.plays - a.plays).slice(0, 8);
  const none = result.matched.length === 0;

  return (
    <div className="import-summary" data-testid="import-summary" data-matched={result.matched.length} data-unmatched={result.unmatched.length}>
      {stage.kind === 'failed' && (
        <div className="notice error" data-testid="import-error" role="alert">
          <p>
            Something went wrong while saving. Some titles may already have been added, and nothing was lost. You can try again.
          </p>
        </div>
      )}
      <p className="import-headline" data-testid="import-found">
        Found {formatCount(titles)} {titles === 1 ? 'title' : 'titles'} across {plays(totalPlays)}
      </p>
      {none ? (
        <p className="muted small" data-testid="import-none">
          None of them matched our title list, so there is nothing to add.
        </p>
      ) : (
        <>
          <p className="small" data-testid="import-counts">
            <strong data-testid="import-matched-count">{formatCount(result.matched.length)}</strong> matched:{' '}
            <strong data-testid="import-new-count">{formatCount(fresh)}</strong> new to {owner === 'my' ? 'your' : owner} History,{' '}
            <strong data-testid="import-already-count">{formatCount(already)}</strong> already there.
          </p>
          <ul className="top-list" data-testid="import-top">
            {top.map((m) => (
              <li key={m.entry.id} data-testid="import-top-row" data-item-id={m.entry.id}>
                <span>{m.entry.title}</span>
                <span className="muted">{plays(m.plays)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {result.unmatched.length > 0 && (
        <div className="unmatched">
          <button type="button" className="btn-link" aria-expanded={unmatchedOpen} data-testid="import-unmatched-toggle" onClick={onToggleUnmatched}>
            Couldn&rsquo;t match {formatCount(result.unmatched.length)} {unmatchedOpen ? '(hide)' : '(show them)'}
          </button>
          {unmatchedOpen && (
            <>
              <ul className="top-list" data-testid="import-unmatched-list">
                {result.unmatched.slice(0, unmatchedShown).map((u, i) => (
                  <li key={`${u.name}-${i}`} data-testid="import-unmatched-row">
                    <span>{u.name}</span>
                    <span className="muted">{plays(u.plays)}</span>
                  </li>
                ))}
              </ul>
              {result.unmatched.length > unmatchedShown && (
                <button type="button" className="btn-link" data-testid="import-unmatched-more" onClick={onMoreUnmatched}>
                  Show more ({formatCount(result.unmatched.length - unmatchedShown)} left)
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="import-actions">
        <button type="button" className="btn btn-primary btn-block" data-testid="import-confirm" disabled={none} onClick={onAdd}>
          {owner === 'my' ? 'Add to my History' : `Add to ${person}’s History`}
        </button>
        <button type="button" className="btn btn-ghost btn-block" data-testid="import-cancel" onClick={onCancel}>
          Start over
        </button>
      </div>
    </div>
  );
}
