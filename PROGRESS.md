# Progress — Pick Tonight (public version)

## Setup — done 11 Oct 2026
- Copied from the private app at its state after tag `private-v2` (commit 2a7f019). Folder `C:\claudecodeprojects\pick-tonight`.
- GitHub repo `harborpine/pick-tonight` (public), Pages on (source = Actions): https://harborpine.github.io/pick-tonight/
- Firebase project `pick-tonight-5tkr8` created by CLI; web app registered (`firebase.web-config.json`); Firestore `(default)` in nam5; rules deployed (still the private app's rules — sync teammate replaces them).
- Anonymous sign-in enabled 11 Oct by the lead via the console; "Auto clean-up" of anonymous accounts deliberately left OFF (it would delete members after 30 days). TMDB_TOKEN secret added by the owner.
- TMDB terms checked: free non-commercial use with attribution is permitted (logo + notice + JustWatch credit; no caching beyond 6 months).
- Private-app baseline for the "unchanged" proof: repo HEAD 2a7f019d22bf4e0b7ac2d8da7c56bf1482c875f1, working tree clean; firestore.rules sha256 starts b6f2eaa839954112; live index.html sha256 starts 7b5ea25c7e10a928.

## Build — first notes
- Lead: contracts rewritten for the public version ("Contracts v3"), app wiring (per-service catalog store, invite link handling), SPEC.md, TEAM.md.
- Working name `Pick Tonight` in `src/config.ts`.
- Teammates (not restorable after an interruption; respawn from TEAM.md + SPEC.md): catalog, engine, sync, ui, then qa.

## Build — COMPLETE and live (12 Oct 2026)
- Live: https://harborpine.github.io/pick-tonight/ (deploy run 38202009569). Catalog: 28 services, 7,802 distinct titles, one file per service + manifest; titles.json lookup 13,891.
- Verified by the lead before publishing: build OK; npm test 502/502; e2e 144/144 (132 single-phone in one run with E2E_WORKERS=2; the four firebase-* files one at a time with E2E_WORKERS=1, because Google rate-limits fresh anonymous sign-ins to about 20 an hour per address); pt-sync's npm run test:sync 13/13 against the real project with the deployed rules.
- Live walk-through as a brand-new visitor (setup from nothing, real catalog, real suggestions, Delete everything) passed with no page errors.
- Private app proven unchanged: repo HEAD, rules file hash and live page hash all equal the baseline recorded above.
- Teammates this round: pt-catalog, pt-engine, pt-sync, pt-ui, pt-qa (resumable by name within the session; otherwise respawn from TEAM.md + SPEC.md).
- Never run two e2e runs at once (shared port 4173): check for a running Playwright before starting one.

## Known limits (also in README.md for users)
- Not tested on a real iPhone. The invite hand-off through Add to Home Screen (src/app/main.tsx drops the manifest when ?join= is present so iOS keeps the code in the icon's address) cannot be automated: FIRST thing to try by hand.
- No sign-in: a solo user who loses their phone loses their lists.
- Rules cannot rate-limit; worst case is the free daily quota or the 1 GiB storage being exhausted (app unavailable, no data exposed). No automatic clean-up of abandoned households. App Check is the future option.
- Capacity on the free plan: roughly 800 typical households a day; storage about 4,000 typical households.
- Unproven on the real server: 24-hour invite expiry; the quota-exhausted message.
- TMDB: non-commercial only. Disney+ / Hulu / HBO Max tiers share one TMDB id. A title can linger up to 6 days after leaving a service.
- Cold-start pick quality was judged by eye on one catalog build.
- To check on the PRIVATE app's Firebase project (read-only): whether "Auto clean-up" of anonymous accounts is ticked there. Owner has not yet said whether to look.
