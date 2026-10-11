# What to Watch (working name)

A personal, free-to-run iPhone web app for two people (HG and BG) that suggests what to watch on the streaming plans they pay for.

- **Read [SPEC.md](SPEC.md) first.** It is the full, authoritative spec: features, the seven rules that must hold, technical decisions, agent-team ownership, and the definition of done.
- **Read PROGRESS.md** (once it exists) before resuming work; teammates are not restored after an interruption.
- The owner is not a developer. Follow his global instructions: plain English, never show code, verify everything yourself, report risks.

## Hard rules
- The TMDB token never goes in the repo or the app. It lives only as the GitHub Actions secret `TMDB_TOKEN`, and is never stored on this computer: anything that needs TMDB runs as a GitHub Actions workflow.
- Never commit `.env*` files. The Firebase web config is not a secret and may be committed.
- Don't commit or push unless the owner asks (the build's /goal counts as asking for the work it covers).
- The project lives at `C:\claudecodeprojects\what-to-watch`, deliberately outside OneDrive.
