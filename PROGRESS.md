# Progress

## Step 1: one-time setup — COMPLETE (10 Oct 2026)

Nothing has been built yet. The build starts when the owner issues a /goal.

### Tools on this PC
- Node.js 24 LTS at `C:\Program Files\nodejs` and GitHub CLI at `C:\Program Files\GitHub CLI`, both installed via winget. Shells started before the install may not have them on PATH; add those folders explicitly.
- `gh` is signed in as `harrisonglantz` (scopes: repo, workflow). Firebase CLI (`npx firebase-tools`) is signed in as the owner's Google account.
- firebase-tools switches to a non-interactive "paste a code" login when it sees agent environment variables (CLAUDE*, AI_AGENT). If login is ever needed again, open a normal console window with those cleared.

### GitHub — proven
- Repo: https://github.com/harrisonglantz/what-to-watch (public; required for free Pages). Branch `main`.
- Pages enabled with source = GitHub Actions. URL: https://harrisonglantz.github.io/what-to-watch/ (so the Vite base path is `/what-to-watch/`).
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

## Step 2: the build — IN PROGRESS (started 10 Oct 2026)

Goal (owner's /goal): app fully built by the agent team and deployed; see SPEC.md "Definition of done".

### Done by the lead
- Scaffold (Vite + React + TS, Vitest, Playwright installed with chromium + webkit), `src/contracts/` (catalog, state, engine, sync, app), fixture catalog (55 titles) at `src/contracts/fixtures/catalog.ts`, `TEAM.md`, placeholder engine / memory sync / UI so the app runs: `npm run dev` then http://localhost:5173/what-to-watch/?catalog=fixture&sync=memory
- Working name `Tonight` in `src/config.ts`. Time limits: 20→25 min, 45→50, 60→65, 2+ hrs→no limit (`TIME_LIMIT_MINUTES`).
- Decision: e2e tests use the fixture catalog + the REAL Firebase project (no Java, so no emulator), each run pairing a fresh household.

### Teammates (spawned in parallel; not restored after an interruption — respawn from TEAM.md + SPEC.md + the notes here)
| Name | Model | Owns | Status |
|---|---|---|---|
| catalog | Sonnet | scripts/catalog, .github/workflows, public/data | running |
| engine | Opus | src/engine | running |
| sync | Sonnet | src/sync, firebase files | running |
| ui | Sonnet | src/ui, public/ (not data) | running |
| qa | Sonnet | tests/e2e | not started (after integration) |

### Still to do after teammates report
1. Integrate: build + tests clean, run the app against real Firebase + real catalog, fix seams.
2. Engine tuning round on the real catalog (engine teammate).
3. Spawn qa: Playwright at iPhone size, two contexts (HG + BG), Together match lands in history.
4. Deploy: catalog workflow green on GitHub, Pages URL returns 200 and loads.
5. INSTALL.md; final evidence list for every Definition-of-done item.
