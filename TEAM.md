# Team rules (read this first)

You are one teammate on a small agent team building the app described in [SPEC.md](SPEC.md). The lead coordinates. The owner is a non-developer; the app must keep working with no maintenance.

## Ownership — edit ONLY your own paths
| Who | Owns |
|---|---|
| lead | `src/contracts/`, `src/app/`, `src/config.ts`, root config (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`), docs (`*.md` at the root) |
| catalog | `scripts/catalog/`, `.github/workflows/`, `public/data/` |
| engine | `src/engine/` (including its tests) |
| sync | `src/sync/`, `firebase.json`, `firestore.rules`, `.firebaserc`, `firebase.web-config.json` |
| ui | `src/ui/`, everything in `public/` except `public/data/` |
| qa | `tests/e2e/` |

- **Never edit `src/contracts/`.** It is the agreed interface. If it is wrong or missing something, tell the lead exactly what to change and why (in your final report, or by message if you can), and keep working around it meanwhile.
- Need a new npm dependency or a root-config change? Ask the lead; do not edit `package.json`. Prefer no new dependencies.
- Other teammates are editing the same folder tree at the same time. Never revert, reformat or "fix" files outside your paths. If someone else's code breaks `npm run build`, report it; don't patch it.
- **Do not `git commit` or `git push`** (the lead does), with one exception: the catalog teammate may commit and push *only its own paths* to run workflows on GitHub.

## Environment (Windows 11)
- Project root: `C:\claudecodeprojects\what-to-watch`.
- Node and the GitHub CLI are installed but may not be on PATH in your shell. In Bash start commands with:
  `export PATH="/c/Program Files/nodejs:/c/Program Files/GitHub CLI:$PATH"`
- `npm run build` (typecheck + Vite build), `npm test` (Vitest, files matching `src/**/*.test.ts(x)` and `scripts/**/*.test.ts`), `npm run dev` (dev server at http://localhost:5173/what-to-watch/).
- Dev switches: `?catalog=fixture` uses the sample catalog in `src/contracts/fixtures/catalog.ts`; `?sync=memory` keeps data on the device only (no Firebase).
- TypeScript is strict. Code must typecheck under the root `tsconfig.json`.
- No secrets in files, ever. The TMDB token exists only as the GitHub Actions secret `TMDB_TOKEN`.

## Shape of the app
- `src/contracts/` — shared types: `catalog.ts` (services/plans, catalog item shape), `state.ts` (people, requests, shared data), `engine.ts` (Engine API), `sync.ts` (SyncApi), `app.ts` (what the UI receives).
- `src/app/main.tsx` loads the catalog, calls `createEngine()` and `createSync()`, and renders `<App services={...} />` from `src/ui`.
- The site is served from the base path `/what-to-watch/` (GitHub Pages: https://harborpine.github.io/what-to-watch/).
- The app name comes only from `src/config.ts` (`APP_NAME`). Never hard-code it.

## When you finish
End with a short report: what you built, what you verified and how (commands + results), anything not done or uncertain, and any contract changes you need. Be honest about failures.

## Version 2 (11 Oct 2026) — read before touching anything
The app is LIVE and the owners are using it with real data. Seven changes are being added; the lead has already updated `src/contracts/` (see the commit "Contracts v2"). Summary:
1. Time: `TimeBudget` gains `'any'` ("I don't care": no limit, no length preference).
2. A solo right-swipe no longer navigates away; it adds a `PickEntry` (`SharedState.picks`, formerly `history`) and the deck carries on.
3. New **Matches** tab = `picks` (solo right-swipes + Together matches). Picked titles are excluded from decks for the people concerned (`Engine.isPicked`).
4. **History** tab = what a person has watched = `SharedState.seen`, whose values are now `SeenEntry` objects (was a number). Only "I watched this", manual add, the first-run grid, or an import write to it (`SyncApi.markWatched` / `unmarkWatched`, replacing `setSeen`). Right-swipes and matches never do.
5. Watch-history import: `Engine.parseWatchHistory` / `matchWatchHistory` / `learnFromImport` / `searchTitles`, using the on-demand lookup `AppServices.loadTitleIndex()` (`public/data/titles.json`, type `TitleIndex`).
6. Novelty `'either'` leans new: about 1 card in 10 is a rewatch (`EITHER_REWATCH_SHARE`), soft.
7. Follow-ups: `Engine.followUps` from `CatalogItem.latestSeason` and `CatalogItem.spinoffOf`, shown at the top of the New tab with a dot.

Rules for v2:
- **Existing households must keep working with no data loss and no user action** (old `seen` numbers, old "history" log). The old app version stays live until the lead deploys, so anything deployed to Firebase meanwhile (rules) must work for BOTH the old and the new app.
- Do not `git push` (a push to main deploys). The catalog teammate may still push its own paths.
- Tests that asserted behaviour replaced by the seven changes must be rewritten to the new behaviour, and each one listed in your report with the reason. Nothing else may be weakened or removed.
- The fixture (`src/contracts/fixtures/catalog.ts`) now has follow-up data, `FIXTURE_TITLE_INDEX` and `FIXTURE_NETFLIX_CSV`.
