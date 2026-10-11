# Pick Tonight — spec (public version)

A free, public web app that helps a household decide what to watch. It is a passion project: no ads, no fees, no revenue, no accounts. It grew out of a private app built for one couple; this version must work for **anyone**, with nothing about any particular person built in.

## What it is
Each person opens the app on their own iPhone (installed to the home screen from Safari), says who's watching and what they're in the mood for, and swipes through suggestions that are actually on the streaming services the household pays for. It costs nothing to run and must keep working with no maintenance.

## Households
- A household has **1 to 4 members**. Each member has their own phone, name, profile and taste.
- **No sign-in.** A phone is a member because it holds the household's saved pairing.
- The first person creates the household. Others join by **invite link** (`<site>?join=CODE`), with the bare 6-character code as a fallback. An invite works once and lasts 24 hours.
- Someone with a new phone (or whose phone forgot the pairing) rejoins with an invite and picks **"I'm already a member"** to take over their existing profile.
- The app must say plainly that, with no sign-in, a person using it **alone** who loses their phone loses their lists (nobody is left to invite them back).
- Households are completely isolated from each other.

## First-run setup (per person; every step after the name is skippable)
1. If opened in an ordinary browser tab rather than from the home screen: explain "Add to Home Screen" first (with "continue in the browser anyway"), because on iPhone a browser tab and the installed app do not share data.
2. Your name.
3. *(First person only)* The household's streaming services and plan for each (ad tier / ad-free), US. Editable later in settings by anyone.
4. A few favourites, found by search (any title, whether or not it's on the household's services).
5. "Never show me…": horror, true crime, anything scary, whole genres (e.g. reality, animation, documentary), anything not originally in English.
6. Optional: import a watch history (Netflix's per-profile file, other exports, or a pasted list). Offered as the fast way to teach the app.
7. A poster grid of popular titles on the household's services to tick off as seen.

## Asking for a suggestion
A quick tap-through with sensible defaults:
1. Who's watching: any non-empty set of household members (default: me). A solo household never sees this choice.
2. Viewing type: Focused, Background, While eating
3. Mood: Want to laugh / Cozy, comfort / Tired, brain off / Want to be gripped / Feel-good, uplifting / Want to think or learn / Romantic / Scared, spooky / Sad, want a good cry / Hyped, action
4. Time: about 20 min, 45 min, 1 hr, 2+ hrs, I don't care
5. New, rewatch, or either (either = mostly new, about 1 in 10 a rewatch)
6. Optional genre craving

Viewing type is about attention, not taste. Background and While eating mean "easy to follow while looking away".

## Suggestions
One card at a time, swiped. Each card shows poster, title, year, length, which service to use (marked ad-free or ads), and exactly what to watch: the movie / start the series / put on any episode / a specific standout episode / the new season.
Swipe right = yes, left = not tonight (can come back another day), plus Seen it, Save to a watchlist, and Never.
- **Alone:** a right-swipe never leaves the deck. It adds the title to the Matches tab and a "Liked" counter ticks up.
- **Together** (2+ watching): one person starts a session; the others who are watching get a prompt to join whenever the app is open. Everyone swipes the same deck on their own phone. When **everyone watching** has said yes to the same title, every phone shows a match screen with where to watch it. They can keep swiping for more.

## Tabs
- **Tonight** — ask and swipe.
- **New** — "Because you watched…" (new seasons and spinoffs of things the viewer has watched) on top, then recent arrivals on the household's services, ranked by taste. A dot shows when there's a follow-up not yet seen.
- **Watchlist** — each member's own list and a shared "Ours".
- **Matches** — every solo right-swipe and every Together match, with where to watch, "I watched this" / "We watched this", and Remove. Titles here are left out of new decks for the people concerned.
- **History** — only what a person has actually watched (marked by hand, ticked in the first-run grid, or imported). Add by search; remove with undo.
- **Us** — a page per member (favourites, never-show-me, what the app has learned in plain language with more/less corrections, import), and Settings.

## Settings
Services and plans; invite someone (link + code; hidden when the household is full); rename yourself; remove a member; unpair this phone; **Delete everything** (permanently deletes the whole household for everyone, after a clear confirmation); Privacy; About.

## Rules that must hold (tests for each, for households of 1, 2, 3 and 4 and any audience)
1. Nothing is ever suggested that isn't included in the household's selected plans.
2. Any watcher's "never show me" choices exclude a title for the whole audience. The Scared/spooky mood is offered only when no watcher has a horror or scary choice.
3. Background and While eating never return medium- or high-attention titles. Low-attention titles are eligible for every viewing type.
4. Nothing longer than the time available (episode length for shows, runtime for movies).
5. New excludes anything any watcher has seen. Rewatch only includes titles at least one watcher has seen. Either leans new.
6. When a title is on several of the household's services, an ad-free one is shown.
7. Never hides a title for any audience containing a person who tapped it; once every member of the household has tapped Never, it is gone everywhere.
8. A title sitting in Matches is left out of decks for any audience that overlaps the pick's people.
9. A Together match requires a yes from every member of the session's audience, and is recorded exactly once.

## How picks are made
No paid AI or APIs. Rule-based scoring of the catalog against the request: similarity to each watcher's favourites and learned weights, mood fit, attention, length, quality. For 2+ watchers the pick must suit everyone (least-misery blend). **Cold start matters:** a brand-new person with no favourites and no history must still get sensible, quality-led, varied picks that respect mood and viewing type, improving as they add favourites, import history and swipe.

## Privacy and fair use
- Stored per household: member names (whatever they typed), chosen services, favourites, watched/never/watchlist/matches lists, learned taste. No email, no location, no contacts, no analytics, no tracking, no ads.
- Anyone in a household can delete everything. A Privacy page says all this in plain language.
- Guard rails so strangers can't harm the service or each other: strict household isolation, at most 4 members, size limits on everything stored, and a plain message if the free database quota is exhausted ("busy right now, try again tomorrow") rather than a broken app.

## Technical decisions
- Installable web app (PWA) for iPhone Safari; Vite + React + TypeScript; hosted free on GitHub Pages at https://harborpine.github.io/pick-tonight/ (base path `/pick-tonight/`).
- Catalog from the TMDB API (free for non-commercial use with attribution). The TMDB token exists only as the GitHub Actions secret `TMDB_TOKEN`. A daily workflow rebuilds a static catalog — **one file per streaming service** so a phone downloads only its household's services — plus the New feed and a broad title lookup, then redeploys. Covers every major US subscription service with correct plan/tier mapping.
- TMDB terms (checked 11 Oct 2026): non-commercial use only; the TMDB logo and the notice "This product uses the TMDB API but is not endorsed or certified by TMDB." in About; JustWatch credited for where-to-watch data; nothing cached longer than 6 months (the daily rebuild satisfies this).
- Shared live data in Firebase (free Spark plan): Firestore + anonymous sign-in, project `pick-tonight-5tkr8`. No server code. Scoring runs on the phone.
- Dark cinema look, one bold accent colour, a satisfying match moment. The app name lives only in `src/config.ts`.

## Not in scope
Sign-in, App Store packaging, notifications, countries other than the US, households larger than four, monetisation.
