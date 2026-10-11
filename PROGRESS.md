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
