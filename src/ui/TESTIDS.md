# UI test ids

Every interactive element and key piece of text carries a `data-testid`. Playwright: `page.getByTestId('...')`.
Buttons all work by plain click (no gesture needed). `{x}` is a variable part. People are never identified by
initials: per-person controls use the member id in the test id and also carry `data-member-id`. Titles carry `data-item-id`.

Badge text is stored as "Ad-free" / "Ads" (CSS draws it in capitals, so `innerText` returns "AD-FREE"; use `textContent`
or `data-adfree="true|false"`).

## Dev / QA hook
- Dev server, or any build opened with `?debug=1`: `window.__wtw` is the live `AppServices`
  (`{ catalogs, newArrivals, engine, sync, loadTitleIndex, siteUrl, joinCode, standalone }`).
- `?catalog=fixture&sync=memory` for the sample catalog and single-device data.
- **Simulating other members (memory sync only)** — see `src/sync/README.md`:
  - `await __wtw.sync.debugAddMember('Sam', { ...__wtw.engine.emptyProfile(), onboarded: true })` adds a member and returns the id
    (use `onboarded: true` or that member will see the first-run setup when you act as them).
  - `__wtw.sync.debugActAs(memberId)` makes this device act as that member (the UI re-renders as them).
  - Typical 2-person match: as the first member start a session and swipe yes, wait ~700 ms (a swipe saves after its 250 ms
    exit animation), `debugActAs(second)`, click `join-button`, click `action-yes` on the first card -> `match-screen`.
  - Join by link: `createInvite()` -> `unpair()` -> open `?join=CODE` (clear `sessionStorage['pt.install.skipped']` to see the install screen again).
- A browser tab is "not installed" (`standalone` false), so a fresh visit starts on `welcome`. Tap `continue-in-browser`.
- `src/ui/dev/walk.mjs <outDir> solo|group|four|join|join-existing` is a Playwright walkthrough at 390x844 that takes screenshots.

## Boot / welcome / pairing (device not paired)
| testid | what |
|---|---|
| `splash` | calm loading screen (device `loading`) |
| `welcome` | install guidance (browser tab, not installed) |
| `install-title`, `install-steps`, `install-why` | the three steps and the reason |
| `install-invite`, `install-invite-code` | shown only when opened from an invite link: reassurance + the code large |
| `continue-in-browser` | quiet secondary "Continue in the browser anyway" |
| `setup` | create-or-join choice |
| `start-household` | "Start a new household" |
| `have-code` | "I have an invite code" |
| `invite-stale-note` | shown on the create-or-join screen when the address's `?join=` code turned out used / expired / wrong. That code is then remembered as dead (`localStorage['pt.spentInvites.v1']`) and ignored on every later launch; a code typed by hand still works. A code is also marked spent when this phone pairs while the address carries it. Connection-type failures do not mark it dead (the retry screen shows instead). |
| `setup-code`, `code-input`, `code-submit`, `code-back` | type a code (any case; punctuation ignored), continue, back |
| `invite-preview` | preview screen; `invite-loading`, `invite-title` ("Join Alex and Sam"), `invite-members` (li `data-member-id`), `invite-full` (household full) |
| `invite-error`, `invite-retry`, `invite-other-code`, `invite-start-own` | the code was wrong/used/expired |
| `join-new` | "I'm new" (hidden when the household is full) |
| `join-existing` | "I'm already a member" |
| `join-existing-screen`, `existing-{memberId}` (pick yourself), `existing-warning` (previous phone signed out), `existing-confirm`, `existing-back` | |
| `pair-error` | plain-language error from `joinWithCode` / `createHousehold` |
| `device-error`, `device-error-next`, `device-error-dismiss` | `device.error` banner (unpaired: top of setup, with a next-step line; paired: floating at the top) |

## Setup steps (shared frame)
`setup-name` (name step, pre-pairing), `setup-services` (services step, pre-pairing, creator only), then after the person exists:
`wizard-favorites`, `wizard-never`, `wizard-import`, `wizard-seen`, `wizard-done`.
Common: `wizard-dots` (`data-index`, `data-total`; 6 dots for the creator, 5 for a joiner), `wizard-title`, `wizard-back`,
`wizard-next` (Next / Join / Done depending on step), `wizard-skip` (every step after the name; not on services, which needs one service),
`wizard-finish` ("Start picking" on the final screen), `solo-warning` (shown on the final screen of a household of one).
- Name: `name-input`, `name-hint` (validation text; Next/Join disabled until valid; taken names are rejected case-insensitively).
- Services: see Services picker; `wizard-next` is disabled until one service has a plan.
- Favourites: `wizard-fav-aim` and the favourites editor. Never: the never-show-me editor. Import: `import-section` (below).
- Seen grid: `onboard-item-{itemId}` (also `data-item-id`, `data-selected`); `onboard-empty`; catalog loading/error states (below).
- Progress is remembered on the phone (`localStorage['pt.wizard.v1']`); a person who quit resumes at the step they reached (never earlier than favourites).
- The full-screen redo grid from a profile page is `onboarding` with `onboard-skip` (Cancel) and `onboard-done`.

## Shared editors
- **Services picker** (setup and Settings): `services-picker`, `service-search`, `service-none`, `service-{serviceId}` (`data-on`), `service-toggle-{serviceId}`,
  plan chips `plan-{serviceId}-{planId}` (`data-selected`, `data-adfree`; each carries an Ads / Ad-free badge). A service with several plans
  stays "pending" until a plan is chosen. Turning a service off clears its plan.
- **Favourites editor**: `fav-editor`, `fav-count`, `fav-chip` / `fav-remove` (`data-item-id`), `fav-search`, `fav-result` (`data-item-id`, `data-added`), `fav-loading`,
  `fav-error` + `fav-retry`, `fav-none`. Capped at `MAX_FAVORITES`. Also `profile-favorites` (the chip list).
- **Never-show-me editor**: `never-editor`, `dealbreaker-{horror|trueCrime|scary|subtitled}` (`data-on`), `dealbreaker-genres`, `dealbreaker-genre-{genreId}`.
- **Who picker** (Tonight and New): `who-picker`, `who-{memberId}` (`data-selected`; the inner span has `data-member-id`), `who-everyone` (3+ members). Hidden in a household of one.

## Catalog states (Tonight, New, seen grid)
`catalog-no-services` + `catalog-choose-services` (no service chosen yet), `catalog-loading`, `catalog-error` + `catalog-retry`,
`catalog-stale` (refresh failed but an older catalog is showing).

## Tab bar
`tabbar`, `tab-tonight`, `tab-new`, `tab-watchlist`, `tab-matches`, `tab-history`, `tab-us`. `new-dot` = follow-ups not yet displayed. Page headings: `page-title`.

## Ask (Tonight tab, no deck open)
`ask`. Groups: `ask-group-who` (absent for a household of one), `ask-group-viewing|mood|time|novelty|genre`.
- `ask-viewing-focused|background|eating`, `ask-mood-{moodId}` (only moods from `engine.availableMoods`), `ask-time-20|45|60|120|any`,
  `ask-novelty-new|rewatch|either` (+ `ask-novelty-either-hint`), `ask-genre-any|{genreId}`, `ask-submit` ("Show me", or "Start together" for 2+ people).
- `resume-session` (a session this phone left), `join-prompt-inline` + `join-button-inline`, `session-others` (quiet "Alex and Sam are picking together" for a session I'm not in).

## Decks
- Solo: `solo-deck`, `deck-back`, `deck-count`, `liked-chip` / `liked-count` (`data-count`), `empty-deck`, `empty-back`.
- Together: `session-deck` (`data-session-id`), `session-back`, `session-end-top`, `session-status` (`data-all-joined`, `data-waiting` = how many not yet joined; text lists names),
  `session-deck-done`, `session-matches`, `session-more`, `session-no-more`, `session-end`, sheet `end-sheet` / `end-confirm` / `end-cancel`.
- Card: `deck`, `card` (`data-item-id`), `card-title|year|minutes|service|pick|reason`, `card-ad-badge`, `card-info`, `card-overview`.
- Actions (plain click works): `action-yes`, `action-not-tonight`, `action-seen`, `action-save`, `action-never`.
  Save: sheet `save-sheet` with `save-option-{memberId|ours}` (no sheet in a household of one: it saves straight to your list). Never: `never-sheet`, `never-text`, `never-confirm`, `never-cancel`.
- Join prompt (banner): `join-prompt` (`data-session-id`), `join-text` ("Alex started a session with you and Sam: ..."), `join-button`, `join-dismiss`. Only shown to someone in the audience who has not joined.
- Match: `match-screen` (`data-item-id`), `match-headline` ("It's a match!", or "Everyone's in!" for 3+), `match-title`, `match-what`, `match-service`, `match-ad-badge`, `match-watching`, `match-keep`.

## New tab
`new-feed`; the who picker above; `followups`, `followups-title`, `followups-more`, `followup-row` (`data-key`, `data-type`), `followup-title|text|date|pick|yes|not-tonight|seen|save|never`;
`new-section-title`, `new-row` (`data-type`), `new-title|label|date|pick|yes|not-tonight|seen|save|never`, `new-empty`, `new-show-more`. Sheets as in Decks.

## Watchlist tab
`watchlist`; tabs `watchlist-tab-mine`, `watchlist-tab-member:{memberId}` (`data-member-id`), `watchlist-tab-ours` (no tabs in a household of one);
`watchlist-empty`, `watchlist-row` (`data-item-id`, `data-list`), `watchlist-title|where|ad-badge`; sheet `watchlist-detail`, `watchlist-seen`, `watchlist-remove`, `watchlist-close`.

## Matches tab
`matches`; filters `matches-filter-all|mine|member:{memberId}|together` (none in a household of one); `matches-empty`;
`match-row` (`data-kind`, `data-who` = comma-separated member ids, `data-item-id`, `data-pick-id`), `match-title|year|label|pick|where|ad-badge|date`
(label e.g. "Match — Alex & Sam", "Liked by Kit"); sheet `match-detail`, `detail-title|label|pick|where|date`, `match-watched` ("We watched this" marks everyone in the pick), `match-remove`, `match-close`.

## History tab
`history`; person switch `history-person-{memberId}` (none in a household of one); `history-add`, `history-search`, `history-favorites-note`, `history-count`, `history-empty`, `history-no-results`,
`history-row` (`data-item-id`, `data-source`), `history-title|year|date|source`, `history-remove`, `history-show-more`;
add sheet `history-add-sheet`, `history-add-input`, `history-add-result` (`data-item-id`, `data-added`), `history-add-loading|error|retry|none|close`. Removal toasts have `toast-action` (Undo).

## Us tab
`us`; segmented `us-seg-{memberId}` (one per member, `data-member-id`) and `us-seg-settings`.
- Profile page `profile-{memberId}`: `profile-unfinished`, favourites editor, never-show-me editor, `insights-empty`, `insight-line` (`data-key`), `insight-text|more|less|clear`,
  `seen-list`, `seen-row`, `unmark-seen`, `seen-show-all`, `profile-redo-onboarding`, `import-section` (`data-member-id`), `never-list`, `never-row`, `unmark-never`.
- Import: `import-instructions`, `import-file`, `import-paste`, `import-paste-go`, `import-reading`, `import-problem`, `import-retry`, `import-summary`, `import-found`, `import-counts`,
  `import-confirm`, `import-cancel`, `import-saving`, `import-progress`, `import-result`, `import-again`, `import-partner-sheet` / `-text` / `-confirm` / `-cancel` (importing for someone else).
- Settings `settings`: `settings-services` with `services-summary`, `services-edit`, the services picker, `services-done`;
  `invite-block` (`invite-rejoin` instead when the household is full: "Let a member back in", same link/code/share), `invite-make`, `invite-code` (spaced, e.g. "ABC 123"), `invite-link` (`<site>?join=CODE`), `invite-share` (Web Share, else copies the link and toasts), `invite-hide`;
  `rename-block`, `rename-input`, `rename-save`, `rename-error`; `settings-members` (not in a household of one), `member-row`, `remove-member-{memberId}`, sheet `remove-sheet`, `remove-text`, `remove-confirm`, `remove-cancel`;
  `open-privacy`, `open-about`, `settings-back`;
  `unpair`, sheet `unpair-sheet`, `unpair-solo-warning` (household of one), `unpair-confirm`, `unpair-cancel`;
  `delete-everything`, sheet `delete-sheet`, `delete-explain`, `delete-continue`, then `delete-input` (type DELETE) + `delete-confirm`, `delete-cancel`.
- `privacy` (the plain-language privacy page). `about`: `about-free`, `about-tmdb-logo` (`public/tmdb-logo.svg`, hidden only if the file is missing), `about-tmdb`, `about-justwatch`, `about-built`.

## Toasts
`toast`, `toast-text`, `toast-action`.
