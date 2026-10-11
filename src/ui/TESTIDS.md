# UI test ids

Every interactive element and key piece of text carries a `data-testid`. Playwright: `page.getByTestId('...')`.
Buttons all work by plain click (no gesture needed). `{x}` below means a variable part.

Badge text is stored as "Ad-free" / "Ads" (CSS draws it in capitals, so `innerText` returns "AD-FREE" / "ADS"; use
`textContent` or `data-adfree="true|false"` to be safe).

## Dev / QA hook
- Dev server, or any build opened with `?debug=1`: `window.__wtw` is the live `AppServices`
  (`{ catalog, newArrivals, engine, sync }`). Use it to play the "other phone" in memory mode, e.g.
  `await __wtw.sync.joinSession(__wtw.sync.getState().activeSession.id, 'BG')`,
  `await __wtw.sync.swipeInSession(sessionId, 'BG', itemId, true, snapshot)`,
  or `await __wtw.sync.startSession('BG', request, deck)` to make the join prompt appear.
- `?catalog=fixture&sync=memory` (lead's switches) for the sample catalog and single-device data.

## Boot / pairing (device not paired)
| testid | what |
|---|---|
| `splash` | calm loading screen (device `loading`) |
| `setup` | the pairing screen |
| `person-HG`, `person-BG` | "Who are you?" |
| `change-person` | "Not HG?" link |
| `start-household` | "Start - this is the first phone" |
| `have-code` | "I have a code" |
| `code-input`, `code-submit`, `code-back` | enter code (any case; spaces ignored), join, back |
| `pair-error` | plain-language error from `joinWithCode` / `createHousehold` |
| `device-error` | `device.error` message (also shown as a floating notice when paired) |

## First-run "what have you seen" grid
`onboarding` (screen), `onboard-item-{itemId}` (each tile; also `data-item-id`, `data-selected`),
`onboard-done`, `onboard-skip`. Shown automatically when this phone's profile has `onboarded: false`; skip and done both set
`onboarded: true`. Re-run from the profile page: `profile-redo-onboarding`.

## Tab bar
`tabbar`, `tab-tonight`, `tab-new`, `tab-watchlist`, `tab-history`, `tab-us`. Page headings: `page-title`.

## Ask (Tonight tab, no deck open)
`ask` (screen). Groups: `ask-group-who|viewing|mood|time|novelty|genre`.
Options (all have `data-selected="true|false"`):
- `ask-who-HG`, `ask-who-BG`, `ask-who-Together` (default: this phone's person, then the last choice on this phone)
- `ask-viewing-focused|background|eating`
- `ask-mood-{laugh|cozy|brainoff|gripped|feelgood|think|romantic|scared|cry|hyped}` (only moods from `engine.availableMoods`)
- `ask-time-20|45|60|120`
- `ask-novelty-new|rewatch|either`
- `ask-genre-any`, `ask-genre-{genreId}` (e.g. `ask-genre-comedy`)
- `ask-submit` ("Show me", or "Start together" when Who = Together)
- `resume-session` banner (open Together session this phone left), `join-prompt-inline` + `join-button-inline`
  (only after the banner's "Not now").

## Deck (solo): `solo-deck` (`data-mode="solo"`), `deck-back`, `deck-count`
## Deck (Together): `session-deck` (`data-mode="together"`, `data-session-id`), `session-back`, `session-end-top`,
`session-status` (`data-partner-joined`; text "Waiting for BG to join..." / "BG is in - swipe away")
- `deck` wraps the stack; `card` = the current top card (`data-item-id`).
- Inside `card`: `card-title`, `card-year`, `card-minutes` ("22 min", "2h 10m"), `card-service` (service name),
  `card-ad-badge` (`data-adfree`), `card-pick` (e.g. "Season 3, Episode 14 - "My Screw Up""), `card-reason` (first reason, if any),
  `card-info` (toggles the description), `card-overview` (shown while open).
- The card underneath has no test ids on purpose (so `card-title` is always unique).
- Buttons: `action-yes`, `action-not-tonight`, `action-seen`, `action-save`, `action-never`.
- Save sheet: `save-sheet`, `save-option-HG`, `save-option-BG`, `save-option-ours` (lists offered: Mine/Ours; Hers/His only when asking
  for the other person; default highlighted is Ours in Together).
- Never sheet: `never-sheet`, `never-text`, `never-confirm`, `never-cancel`.
- Swipe: drag `card` right (>~96 px or a quick flick) = yes, left = not tonight; releasing early springs back.
  Playwright: `mouse.down()` on the card centre, `mouse.move()` with `steps`, `mouse.up()`.
- Empty/finished: `empty-deck` (+ `empty-back`) in solo; `session-deck-done`, `session-matches`, `session-more`,
  `session-no-more`, `session-end` in Together. End confirm: `end-sheet`, `end-confirm`, `end-cancel`.

## Overlays (above every screen)
- Solo pick: `pick-screen` (`data-item-id`), `pick-title`, `pick-what`, `pick-service`, `pick-ad-badge`,
  `pick-seen` ("Mark as seen"), `pick-keep` ("Keep browsing"), `pick-done` ("Done").
- Join prompt (banner, any screen): `join-prompt` (`data-session-id`), `join-text`, `join-button`, `join-dismiss` ("Not now").
- Match: `match-screen` (`data-item-id`), `match-headline`, `match-title`, `match-what`, `match-service`, `match-ad-badge`,
  `match-keep` ("Keep swiping"), `match-watching` ("We're watching this" - ends the session).
- `toast` (short messages, e.g. "The Together session ended.").

## New on our services
`new-feed`, `new-who-me`, `new-who-Together`, rows `new-row` (`data-item-id`, `data-type="title|season"`) with
`new-title`, `new-label` ("New" / "New season 3"), `new-date`, `new-pick`, `new-service-name`, `new-service-ad-badge`,
actions `new-yes`, `new-not-tonight`, `new-seen`, `new-save` (opens the same `save-sheet`), `new-never` (same `never-sheet`).
`new-empty`, `new-show-more`. A row disappears after any action; "yes" opens the solo pick screen.

## Watchlist
`watchlist`, `watchlist-tab-mine|hers|ours` (the middle tab is labelled with the other person's initials),
rows `watchlist-row` (`data-item-id`, `data-list` = HG|BG|ours) with `watchlist-title`, `watchlist-where`, `watchlist-ad-badge`;
`watchlist-empty`. Detail sheet: `watchlist-detail`, `detail-title`, `detail-where`, `detail-service-name`,
`detail-service-ad-badge`, `detail-unavailable` ("No longer on your services"), `watchlist-seen`, `watchlist-remove`, `watchlist-close`.

## History
`history`, rows `history-row` (`data-kind="match|solo"`, `data-item-id`) with `history-title`, `history-date`,
`history-who` ("HG", "BG" or "HG & BG"), `history-pick`, `history-where`, `history-ad-badge`; `history-empty`.

## Us
`us`, segments `us-seg-HG`, `us-seg-BG`, `us-seg-settings`.
- Profile: `profile-HG` / `profile-BG`, `profile-favorites`, `dealbreaker-horror|trueCrime|scary` (`aria-checked`, `data-on`),
  `insight-line` (`data-key`, `data-correction`) containing `insight-text`, `insight-more`, `insight-less`, `insight-clear`
  (buttons carry `data-key`), `insights-empty`, `seen-list`, `seen-row` (`data-item-id`) + `unmark-seen`, `seen-show-all`,
  `never-list`, `never-row` (`data-item-id`) + `unmark-never`, `profile-redo-onboarding`.
- Settings: `settings`, `plan-{serviceId}` (row), `plan-{serviceId}-{planId}` and `plan-{serviceId}-none` (`data-selected`),
  `show-pairing-code`, `pairing-code` (the code, large), `hide-pairing-code`, `about`, `about-tmdb`, `about-justwatch`, `about-built`,
  `unpair`, `unpair-sheet`, `unpair-confirm`, `unpair-cancel`.
