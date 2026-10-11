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
- The site is served from the base path `/what-to-watch/` (GitHub Pages: https://harrisonglantz.github.io/what-to-watch/).
- The app name comes only from `src/config.ts` (`APP_NAME`). Never hard-code it.

## When you finish
End with a short report: what you built, what you verified and how (commands + results), anything not done or uncertain, and any contract changes you need. Be honest about failures.
