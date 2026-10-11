# Progress — Pick Tonight (public version)

## Setup — done 11 Oct 2026
- Copied from the private app at its state after tag `private-v2` (commit 2a7f019). Folder `C:\claudecodeprojects\pick-tonight`.
- GitHub repo `harborpine/pick-tonight` (public), Pages on (source = Actions): https://harborpine.github.io/pick-tonight/
- Firebase project `pick-tonight-5tkr8` created by CLI; web app registered (`firebase.web-config.json`); Firestore `(default)` in nam5; rules deployed (still the private app's rules — sync teammate replaces them).
- OWNER STILL TO DO (asked 11 Oct): enable Anonymous sign-in in the Firebase console; add the `TMDB_TOKEN` secret to the new repo.
- TMDB terms checked: free non-commercial use with attribution is permitted (logo + notice + JustWatch credit; no caching beyond 6 months).
- Private-app baseline for the "unchanged" proof: repo HEAD 2a7f019d22bf4e0b7ac2d8da7c56bf1482c875f1, working tree clean; firestore.rules sha256 starts b6f2eaa839954112; live index.html sha256 starts 7b5ea25c7e10a928.

## Build — in progress
- Lead: contracts rewritten for the public version ("Contracts v3"), app wiring (per-service catalog store, invite link handling), SPEC.md, TEAM.md.
- Working name `Pick Tonight` in `src/config.ts`.
- Teammates (not restorable after an interruption; respawn from TEAM.md + SPEC.md): catalog, engine, sync, ui, then qa.
