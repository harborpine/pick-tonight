# SPEC

I want you to build a personal web app for me (HG) and my girlfriend (BG) that helps us decide what to watch. This message is the full spec. For now, do only "Step 1" at the bottom, then stop. I'll start the build with a /goal afterward.

## What it is
We each open the app on our own iPhone (installed to the home screen from Safari), say who's watching and what we're in the mood for, and swipe through suggestions that are actually on the streaming services we pay for. It's only for the two of us, it must cost nothing to run, and I'm not a developer, so it has to keep working without me maintaining it.

## Our services (US)
- Netflix: ad-free
- Disney+: ad-free
- Hulu: with ads
- HBO Max: with ads
- Peacock Premium (the ad tier, not Premium Plus)
- Paramount+ Essential (the ad tier, not the Showtime tier)
Only suggest titles included with these exact plans: no rentals, purchases, add-ons, or higher tiers. When a title is on more than one of our services, send us to an ad-free one. Services and tiers must be editable in settings in case we change plans.

## Asking for a suggestion
A quick tap-through with sensible defaults, so it takes a few seconds:
1. Who: HG, BG, or Together
2. Viewing type: Focused, Background, While eating
3. Mood: Want to laugh / Cozy, comfort / Tired, brain off / Want to be gripped / Feel-good, uplifting / Want to think or learn / Romantic / Scared, spooky / Sad, want a good cry / Hyped, action
4. Time available (about 20 min, 45 min, 1 hr, 2+ hrs)
5. New, rewatch, or either
6. Optional genre craving

Viewing type is about attention, not taste. Every title needs an attention level. Example: Game of Thrones is complicated, so it's Focused only. Family Guy is funny and easy to follow, so it's fine for any viewing type. Treat While eating like Background: easy to follow while looking away.

## Suggestions
One card at a time, swiped. Each card shows the poster, title, year, length, which service to use (marked ad-free or ads), and exactly what to watch, one of: the movie / start the series / put on any episode (drop-in shows like sitcoms, reality, baking) / a specific standout episode by season, number, and name when one stands out and works on its own.
Card actions: swipe right = yes, swipe left = not tonight (can come back another day), plus buttons for Seen it, Save to watchlist, and Never.

## Together mode
One of us starts a session and picks the inputs; the other phone shows a prompt to join when the app is open. We each swipe the same deck on our own phone. When we've both said yes to the same title, both phones show a match screen with where to watch it. We can keep swiping for more matches.

## Profiles
Two profiles, HG and BG, seeded with the lists below. Favorites count as seen and as strong taste signals even if they aren't on our services.
- HG favorites: Scrubs, How I Met Your Mother, The Hateful Eight, Forrest Gump, Family Guy, The Simpsons, Curb Your Enthusiasm, Grey's Anatomy, The Hunger Games, South Park, Disenchantment, The Devil's Plan, Summer House, Game of Thrones. No dealbreakers.
- BG favorites: Scandal, Grey's Anatomy, The Great British Baking Show, Survivor, The Traitors, Community, How to Get Away with Murder, Family Guy, Summer House, Love Island, The Devil's Plan, Squid Game, How I Met Your Mother, Friends, Crazy Ex-Girlfriend, Killing Eve, Why Women Kill, Paradise, Shameless, Gossip Girl, Gilmore Girls, You. She doesn't watch horror or true crime. Thrillers are fine as long as they aren't scary.
First-run setup for each of us: a poster grid of popular titles to tick off as seen.
The app learns from swipes, gradually shifting each person's taste weights, and has a page per profile showing what it has learned in plain language, where we can correct it.

## What it tracks
- Seen (per person), marked as we go
- Watchlist, saved as mine, hers, or ours
- Never: hides the title for the person who tapped it and from Together decks. Once we've both tapped Never, it's gone everywhere for good.
- History: a log of every match and every solo pick so we can find it again
No star ratings and no episode-progress tracking.

## New on our services
A feed of shows, seasons, and movies that recently arrived on our six services, ranked by our tastes, with the same card actions.

## Rules that must hold (write tests for each)
1. Nothing is ever suggested that isn't included in our plans.
2. BG alone or Together: no horror, no true crime, nothing scary. The Scared/spooky mood is only offered when HG is watching alone.
3. Background and While eating never return high-attention titles. Low-attention titles are eligible for every viewing type.
4. Nothing longer than the time available (episode length for shows, runtime for movies).
5. New excludes anything a watcher has seen (Together: either of us). Rewatch only includes seen titles (Together: at least one of us).
6. When a title is on several of our services, an ad-free one is shown.
7. Never behaves as described above.

## How picks are made
No paid AI or APIs. Rank a real catalog against the request using rule-based scoring: similarity to each person's favorites and learned weights (genres, keywords, related titles), mood-to-content mapping, attention level, length, and quality signals. Recommendation quality is the whole point of the app, so spend the effort here: after it works, review the top results for a spread of realistic requests from both profiles and tune until they look like things we'd say yes to.

## Technical decisions (defaults; change one only for a clear reason, and tell me)
- Installable web app (PWA) for iPhone Safari: portrait, touch swipes, safe areas. Vite + React + TypeScript, hosted free on GitHub Pages from my GitHub account.
- Catalog from the TMDB API, which is free for personal use; its where-to-watch data comes from JustWatch, so credit both on an About screen. The TMDB token must never be in the repo or on our phones: store it as a GitHub Actions secret, and have a daily workflow rebuild a static catalog of titles on our plans with every tag the scoring needs (attention level, mood tags, drop-in flag, standout episodes), then redeploy. The difference between builds powers the New feed. TMDB lists ad tiers and premium tiers as separate providers, so map our exact plans carefully. Keep the catalog big enough for variety and small enough to load fast on a phone.
- Shared live data (profiles, seen, watchlist, never, sessions, history) in Firebase on the free plan, Firestore with anonymous sign-in and a one-time pairing code so only our two phones can read or write. Check the current free limits first and choose another free realtime option if it no longer fits. Scoring runs on the phone, so there's no server.
- Dark cinema look: dark background, big poster art, one bold accent color, a satisfying match moment.
- Pick a short working name and keep it in one config value so I can rename it.

## Agent team
Use an agent team for the build. You are the lead. Before spawning anyone, scaffold the project and write src/contracts/ (shared types for catalog items, profiles, requests, the engine API, and the sync API) plus a small fixture catalog, so teammates can work in parallel without waiting on each other. Only you edit the contracts; teammates message you for changes. You own src/contracts/, src/app/ (wiring it together), root config, and docs. Give each teammate the relevant parts of SPEC.md in its spawn prompt, since they don't see this conversation.
- catalog (Sonnet): owns scripts/catalog/, .github/workflows/, public/data/. TMDB fetching, plan mapping, tagging, standout episodes, new-arrivals diff.
- engine (Opus): owns src/engine/ and its tests. Scoring, deck building, learning from swipes, the seven rules.
- sync (Sonnet): owns src/sync/ and the Firebase config and rules files. Pairing, live Together sessions, match detection, all shared data.
- ui (Sonnet): owns src/ui/ and the rest of public/. Screens, swipe deck, look and feel, PWA manifest and service worker.
After you integrate their work, spawn qa (Sonnet), owning tests/e2e/: it plays through the app at iPhone screen size using two browser contexts as HG and BG, and reports bugs to the owning teammate.
Keep PROGRESS.md current. Teammates aren't restored if the session is interrupted, so on resume, read it and respawn whoever is needed.

## Definition of done
- All seven rules have passing tests; build and tests are clean
- End-to-end tests pass at iPhone size, including a two-phone Together match that lands in history
- The daily catalog workflow has run on GitHub and the live catalog has titles from all six services
- The app is live on GitHub Pages
- INSTALL.md explains, in plain steps, how to add it to both iPhones and pair them

## Step 1 (do this now, then stop)
1. Create the project folder, save this spec as SPEC.md, and write a short CLAUDE.md pointing to it.
2. Walk me through the one-time setup one step at a time, in plain language with exact clicks: a free TMDB account and API read token, the Firebase project and its web config, and a GitHub repo with Pages enabled and the TMDB token added as a secret. Do everything you can yourself and only ask me for things that need my login.
3. Prove each one works: a test TMDB call that prints the US provider names matching our six plans, a test Firestore write and read, and a test push to GitHub.
4. Tell me setup is complete. Don't start building.
