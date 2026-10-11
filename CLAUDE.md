# Pick Tonight (public version)

A free, public iPhone web app that helps a household of 1-4 people decide what to watch on the streaming plans they pay for. It is a separate copy of a private app; the private app (`C:\claudecodeprojects\what-to-watch`, repo `harborpine/what-to-watch`, Firebase `what-to-watch-90a38`) must never be modified from here.

- **Read [SPEC.md](SPEC.md) first**, then [TEAM.md](TEAM.md) (team rules, ownership, environment) and PROGRESS.md.
- The owner is not a developer. Follow his global instructions: plain English, never show code, verify everything yourself, report risks.

## Hard rules
- The TMDB token lives only as the GitHub Actions secret `TMDB_TOKEN` on `harborpine/pick-tonight`. Never on this computer, never in the repo.
- TMDB use is non-commercial only (terms checked 11 Oct 2026): keep the TMDB logo + notice and the JustWatch credit in About. If the app ever earns money, it needs TMDB's commercial licence first.
- Never commit `.env*` files. The Firebase web config is not a secret.
- Don't commit or push unless the owner asks (a /goal counts as asking for the work it covers).
- The repo must stay public or GitHub Pages turns off.
