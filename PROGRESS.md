# Progress

## Step 1: one-time setup — COMPLETE (10 Oct 2026)

Nothing has been built yet. The build starts when the owner issues a /goal.

### Tools on this PC
- Node.js 24 LTS at `C:\Program Files\nodejs` and GitHub CLI at `C:\Program Files\GitHub CLI`, both installed via winget. Shells started before the install may not have them on PATH; add those folders explicitly.
- `gh` is signed in as `harborpine` (renamed from `harrisonglantz` on 11 Oct 2026) (scopes: repo, workflow). Firebase CLI (`npx firebase-tools`) is signed in as the owner's Google account.
- firebase-tools switches to a non-interactive "paste a code" login when it sees agent environment variables (CLAUDE*, AI_AGENT). If login is ever needed again, open a normal console window with those cleared.

### GitHub — proven
- Repo: https://github.com/harborpine/what-to-watch (public; required for free Pages). Branch `main`.
- Pages enabled with source = GitHub Actions. URL: https://harborpine.github.io/what-to-watch/ (so the Vite base path is `/what-to-watch/`).
- Local git identity uses the GitHub noreply address so the owner's email is not in public commits.
- Secret `TMDB_TOKEN` (TMDB v4 read access token) is set. It is not on this PC; anything touching TMDB must run in Actions.

### TMDB — proven
`.github/workflows/tmdb-check.yml` (manual run) succeeded. US provider IDs for the owner's exact plans:

| Plan | TMDB provider | ID | Ads |
|---|---|---|---|
| Netflix (ad-free) | Netflix | 8 | no |
| Disney+ (ad-free) | Disney Plus | 337 | no |
| Hulu (with ads) | Hulu | 15 | yes |
| HBO Max (with ads) | HBO Max | 1899 | yes |
| Peacock Premium | Peacock Premium | 386 | yes |
| Paramount+ Essential | Paramount Plus Essential | 2616 | yes |

Must NOT be treated as ours: Netflix Standard with Ads (1796), Netflix Kids (175), Peacock Premium Plus (387), Paramount Plus Premium (2303), DisneyNOW (508), and every Amazon / Apple TV / Roku channel variant.

Known limitation: TMDB has a single entry each for Hulu and HBO Max (no ad vs ad-free split), so a title locked to a higher tier of those two cannot be detected from provider data alone.

### Firebase — proven
- Project `what-to-watch-90a38`, Spark (free) plan. Web config in `firebase.web-config.json` (not a secret).
- Firestore `(default)` database in `nam5`. Anonymous sign-in enabled.
- `firestore.rules` is a setup placeholder (any signed-in install can read/write). The sync teammate must replace it with pairing-code rules limited to the two phones, and deploy with `npx firebase-tools deploy --only firestore:rules`.
- Test passed: anonymous sign-in, write, read back, unauthenticated read refused; test document and test user deleted.
- Free limits checked 10 Oct 2026: 1 GiB stored, 50k reads/day, 20k writes/day, 20k deletes/day, one free database per project. Ample for two phones.

### Not yet committed
`.firebaserc`, `firebase.json`, `firestore.rules`, `firebase.web-config.json`, `PROGRESS.md` exist locally only. The first commit (spec, CLAUDE.md, .gitignore, tmdb-check workflow) is pushed.

## Step 2: the build — COMPLETE, see below (started 10 Oct 2026)

Goal (owner's /goal): app fully built by the agent team and deployed; see SPEC.md "Definition of done".

### Done by the lead
- Scaffold (Vite + React + TS, Vitest, Playwright installed with chromium + webkit), `src/contracts/` (catalog, state, engine, sync, app), fixture catalog (55 titles) at `src/contracts/fixtures/catalog.ts`, `TEAM.md`, placeholder engine / memory sync / UI so the app runs: `npm run dev` then http://localhost:5173/what-to-watch/?catalog=fixture&sync=memory
- Working name `Tonight` in `src/config.ts`. Time limits: 20→25 min, 45→50, 60→65, 2+ hrs→no limit (`TIME_LIMIT_MINUTES`).
- Decision: e2e tests use the fixture catalog + the REAL Firebase project (no Java, so no emulator), each run pairing a fresh household.

### Teammates — all finished (11 Oct 2026)
| Name | Model | Owns | Status |
|---|---|---|---|
| catalog | Sonnet | scripts/catalog, .github/workflows, public/data | done: daily workflow green, 2,662 titles, all six services |
| engine | Opus | src/engine | done: rules + ranking + learning, tuned twice on the real catalog |
| sync | Sonnet | src/sync, firebase files | done: secure rules deployed, 17 live integration checks (npm run test:sync) |
| ui | Sonnet | src/ui, public/ (not data) | done: all screens, icons, service worker |
| qa | Sonnet | tests/e2e | done: 49 Playwright tests at iPhone 14 / WebKit |

### State at hand-over
- Local: npm run build OK, npm test 228/228, npm run e2e 49/49 (run e2e alone: a concurrent build or second e2e run corrupts it).
- Known limits are listed in INSTALL.md (pairing loss on both phones) and in the lead's final report: Hulu/HBO Max tier blind spot, rule-based mood/attention tags, New feed seeded from release dates on day one, 60-day schedule keep-alive unproven, not tested on a physical iPhone.
- Tuning knobs: named constants at the top of src/engine/rank.ts, taste.ts, catalogIndex.ts; catalog overrides in scripts/catalog/overrides.ts.
