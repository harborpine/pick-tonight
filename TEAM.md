# Team rules (read this first)

You are one teammate on a small agent team building **Pick Tonight**, the public version of an app described in [SPEC.md](SPEC.md). The lead coordinates. The owner is a non-developer; the app must keep working with no maintenance.

## Where this code came from — important
This repository started as a copy of a **private app built for one couple** ("HG" and "BG"), which is live and must never be touched. The copy works and has ~370 passing tests, but it has that couple baked in: exactly two people with fixed ids, their favourites seeded from the catalog, their six streaming plans as defaults, pairing between exactly two phones. Your job is to generalise your area to SPEC.md, keeping what is good (the tuned ranking, the tested rules, the sync design, the look and feel) rather than rewriting from scratch.

The lead has already rewritten `src/contracts/` for the public version (commit "Contracts v3"). Start by reading `git show HEAD --stat` and the contracts themselves. Headline changes:
- `MemberId` (opaque string) replaces the fixed `'HG' | 'BG'`; `SharedState.members` holds 1–4 `Member`s with names. `Who` is now a **sorted array of member ids** (the audience), not `'Together'`.
- Profiles start empty (`Engine.emptyProfile()`); favourites are `FavoriteTitle[]` carrying their own genres/keywords (picked by search; may be off-catalog). `Catalog.tasteRefs`, `Catalog.seedFavorites`, `SEED_FAVORITE_TITLES`, `DEFAULT_PLANS` are gone.
- `Dealbreakers` gains `genres: GenreId[]` and `subtitled: boolean`; `CatalogItem` gains `lang`.
- Services are data: `ServiceId` is a string, `PlanSelection` is partial, `SERVICES` is being widened to every major US service. Never assume the original six.
- The catalog is published as one file per service (`CatalogManifest`); the UI gets a `CatalogStore` (`AppServices.catalogs`) instead of a fixed catalog.
- `SyncApi`: `createHousehold(name, profile, settings)`, `createInvite`, `previewInvite`, `joinWithCode(code, JoinAs)`, `renameMember`, `removeMember`, `unpair`, `deleteHousehold`; sessions have an audience and match when everyone in it says yes.
- The fixture now has a sample household (`FIXTURE_MEMBERS` alex / sam / kit, `FIXTURE_FAVORITES`, `FIXTURE_PLANS`) instead of built-in favourites.

**Never** reference the private app's Firebase project (`what-to-watch-90a38`), its site (`harborpine.github.io/what-to-watch`), or its repo from code or tests. Remove any names, initials or personal favourites lists you find in your area (use the fixture's sample people in tests).

## Ownership — edit ONLY your own paths
| Who | Owns |
|---|---|
| lead | `src/contracts/`, `src/app/`, `src/config.ts`, root config (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`), docs (`*.md` at the root) |
| catalog | `scripts/catalog/`, `.github/workflows/`, `public/data/` |
| engine | `src/engine/` (including its tests) |
| sync | `src/sync/`, `firebase.json`, `firestore.rules`, `.firebaserc`, `firebase.web-config.json` |
| ui | `src/ui/`, everything in `public/` except `public/data/` |
| qa | `tests/e2e/` |

- **Never edit `src/contracts/`.** If it is wrong or missing something, tell the lead exactly what to change and why, and keep working around it meanwhile.
- Need a new npm dependency or a root-config change? Ask the lead. Prefer none.
- Other teammates are editing the same folder tree at the same time. Never revert, reformat or "fix" files outside your paths. The whole-project build and test run will be red for a while for reasons that are not yours — run your own area's checks (`npx tsc --noEmit` filtered to your paths, `npx vitest run <your folder>`).
- **Do not `git commit` or `git push`** (the lead does), with one exception: the catalog teammate may commit and push *only its own paths* to run workflows on GitHub (`git add scripts/catalog .github/workflows public/data/.gitignore`, never `git add -A`; `git pull --rebase` if rejected).
- **Never weaken, skip or delete a test to make it pass.** Tests that assert behaviour SPEC.md deliberately changes (two fixed people, seeded favourites, …) must be rewritten to the new behaviour, and you must list each one with the reason in your report. Everything else stays.

## Environment (Windows 11)
- Project root: `C:\claudecodeprojects\pick-tonight`.
- In Bash start commands with: `export PATH="/c/Program Files/nodejs:/c/Program Files/GitHub CLI:$PATH"`
- `npm run build` (typecheck + Vite build), `npm test` (Vitest: `src/**/*.test.ts(x)`, `scripts/**/*.test.ts`), `npm run test:sync` (integration against the real Firebase project `pick-tonight-5tkr8`), `npm run e2e` (Playwright, iPhone 14 / WebKit; never run two e2e runs at once, and not while someone runs `npm run build`), `npm run dev` (http://localhost:5173/pick-tonight/).
- Dev switches: `?catalog=fixture` uses the sample catalog in `src/contracts/fixtures/catalog.ts`; `?sync=memory` keeps data on the device only; `?debug=1` exposes `window.__wtw` (the live services) for tests.
- TypeScript is strict. No secrets in files, ever: the TMDB token exists only as the GitHub Actions secret `TMDB_TOKEN` (repo `harborpine/pick-tonight`), so TMDB can only be called from a workflow run.
- GitHub: repo `harborpine/pick-tonight` (public), Pages source = GitHub Actions, site https://harborpine.github.io/pick-tonight/ . A push to `main` runs the deploy workflow.
- Firebase: project `pick-tonight-5tkr8`, Firestore `(default)` in nam5, free Spark plan, no emulator (Java isn't installed). CLI is signed in: `npx firebase-tools deploy --only firestore:rules --project pick-tonight-5tkr8 --non-interactive`.
- The app name comes only from `src/config.ts` (`APP_NAME`). Never hard-code it.

## When you finish
End with a short report: what you built, what you verified and how (commands + results), the list of tests whose expectations you changed and why, anything not done or uncertain, and any contract changes you need. Be honest about failures.
