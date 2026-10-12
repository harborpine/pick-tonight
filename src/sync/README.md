# Sync (Firebase layout)

`createSync({mode:'firebase'})` -> `firebase.ts`. `createSync({mode:'memory'})` -> `memory.ts` (one device, localStorage; never imports the Firebase SDK).
Shared pure logic: `match.ts` (N-person match decision), `assemble.ts` (documents -> `SharedState`), `pairing.ts` (invite codes, name rules), `seen.ts` (watched-list helpers), `errors.ts` (plain-language messages).
Project: `pick-tonight-5tkr8` (never the private app's project). Anonymous sign-in must be enabled in the Firebase console. **Auto clean-up of anonymous accounts is deliberately OFF** (it would delete users after 30 days and lock people out of their households): never rely on it or turn it on.

## Who is a member

There is no sign-in. Each phone has an anonymous Firebase identity (`uid`). `households/{hid}` holds:

```
nextId     next member number (m1, m2, ... never reused)
members    { m1: {name, joinedAt}, ... }            1..4
names      { "n:<lower-cased name>": "m1", ... }    makes names unique (case-insensitive) in a way rules can check
owners     { m1: <uid of the phone that IS m1> }    absent = nobody's phone (after "unpair")
uids       { <uid>: "m1" }                          reverse index used by the rules
inviteCode the most recent invite (maybe used/expired)
deleting   true while "Delete everything" runs
```

A phone counts as a member only while `owners[uids[uid]] == uid`. Taking a member over from a new phone sets `owners[m] = newUid`, so the old phone is locked out instantly (its entry in `uids` goes stale and any live member tidies it away).

## Documents

```
households/{hid}                 see above (listened to: this is how a phone learns it was removed / the household was deleted)
households/{hid}/data/shared     settings, ours.{itemId} = JSON WatchlistEntry
households/{hid}/data/{m1..}     one per member: profile, never.{id}=ms, notTonight.{id}=date, watch.{id}=JSON WatchlistEntry
households/{hid}/seenx/{m1_0..m1_7}   e.{itemId} = JSON SeenEntry   (8 shards per member; the only copy of a watched list)
households/{hid}/months/{YYYY-MM}     entries.{pickId} = JSON PickEntry  (the Matches tab, one doc per month)
households/{hid}/sessions/current     the one open Together session (deleted when it ends; `id` field tells sessions apart)
invites/{CODE}                   hid, createdBy, createdAt(server), used, usedBy, members[{id,name}], full, nextId
```

Titles, picks and watchlist entries are stored as one JSON string each: a string is one indexed value, whereas a nested map would use many of Firestore's 40,000 index entries per document, and the rules only need to count them.

A phone listens to 5 things: the household doc, the `data` collection, `seenx`, `months`, `sessions`. State is published once all five have answered once (cache or server) and updates are coalesced over 25 ms.
Every edit is field-level (`set` merge / `updateDoc` of one path / `arrayUnion` / `deleteField`) so two phones editing different things never overwrite each other. Match decisions and membership changes use transactions.

## Invites and joining

* `createInvite()` (transaction): deletes the previous invite doc, creates `invites/{CODE}` (6 chars, 24 h by server time) carrying a snapshot of member ids/names, `full` and `nextId`, and points `household.inviteCode` at it. One live invite per household; making a new one replaces it.
* `previewInvite(code)`: anyone signed in may `get` one invite by its exact code (no listing). The snapshot is refreshed by every rename/removal (same transaction). When the code is used the snapshot is cleared. An expired, unused invite keeps its snapshot until the household makes another invite or is deleted (a stranger would need the exact code AND for it to be more than a day old).
* `joinWithCode`: ONE batch = mark the invite used + update the household. The rules check (server side): the invite is this household's current one, unused, younger than 24 h; for a new member the id is exactly `m<nextId>`, there is room (<4), the name is 1..20 chars and not already taken, and only this uid is added; for a re-claim only `owners[m]`/`uids[uid]` change. A new member's profile is written right after (they are a member by then).
* Re-claim ("I'm already a member"): the old phone's `uids` entry goes stale; its listeners get "permission denied", it checks the household and goes to `unpaired` with "This phone is no longer part of the household..." (or "This household was deleted." when the household document is gone).

## Leaving and deleting

* `unpair()`: this phone forgets the household (and takes a new anonymous identity); the member and data stay and can be claimed again with an invite.
* `removeMember(m)`: deletes the member's `data/m`, their 8 `seenx` shards (and the session if they are in its audience), then removes them from the household in one transaction. 'ours' and matches stay. Removing yourself unpairs this phone; removing the last member runs `deleteHousehold()`.
* `deleteHousehold()` (needs a connection): sets `deleting:true` (rules then refuse every write except deletes, so nothing can sneak in), deletes the outstanding invite, deletes every doc of `data`, `seenx`, `months`, `sessions` in batches of 10 (re-listing from the server until a pass finds nothing), then deletes the household document and resolves only when the server confirms. Other phones go to `unpaired` with "This household was deleted.". (A non-existent household document can be `get`-ed, so a phone can tell "deleted" from "removed".)

## Security rules (`firestore.rules`)

* Only live member uids can read or write anything under a household. Nothing is listable (households, invites, ...). Any path not named below is denied.
* Outsiders: read one invite by exact code; perform the validated join batch. Nothing else.
* Caps enforced by rules: 4 members, names 1..20 chars (create/join/rename), member numbers <= 999, `uids` <= 16, watched shard <= 2,500 titles, month doc <= 1,500 picks, per-member never <= 3,000 / notTonight <= 1,500 / watchlist <= 1,000, `ours` <= 1,000, 40 favourites, 400 learned keywords, 400 deck cards, 4 session members; only these document ids are allowed (`shared`, `m<n>`, `m<n>_<0-7>`, `YYYY-MM`, `current`), so a household has a bounded number of documents. Every document is also bounded by Firestore's own 1 MiB limit.
* Renames are checked by the rules too: exactly one member changes, the new name is 1..20 chars, `lastRename` agrees, and the unique-name index matches.
* Known rule limits: name uniqueness uses the lower-cased name (a few non-English capital letters may lower-case differently in the rules and in JavaScript, which would refuse that join rather than allow a duplicate); string values inside maps are not individually size-checked.

## Residual abuse / cost risk (honest)

Firestore rules cannot rate-limit. Anyone with the public app can sign in anonymously and create many households, and fill each one up to the caps above. The worst case is exhausting the free daily quota (50k reads, 20k writes, 20k deletes) or the 1 GiB of storage: the app then becomes read-only/unavailable (the phone shows "very busy today ... try again tomorrow") until the quota resets (storage does not reset). Nobody's data is exposed by this. Cheap mitigations already in: bounded documents per household (about 280 at most), caps above, 10-document delete batches, 1000-title write chunks, and a 10,000 watched titles per person ceiling. Future options: Firebase App Check (not added now), a cleanup job for idle households, tightening per-collection caps.

## Quota handling

`resource-exhausted` from any call becomes `MSG.quota` ("<app name> is very busy today and has hit its free limit. Your lists are safe - please try again tomorrow."). Listener errors set `device.error` and keep the app running from the offline cache; actions that need the server (create, invite, join, rename, remove, delete, matches) reject with that message; queued background edits report it in `device.error`.

## Free-tier usage estimate (Spark: 50k reads / 20k writes / 20k deletes per day, 1 GiB)

Assumptions: a 2-person household, one evening: both phones open the app ~3 times (cold start with the offline cache = reads only for changed docs, about 4 + listener docs when nothing changed; worst case full re-read ~ 15 docs), 1 Together session of ~25 swipes each, 2 solo right-swipes, a couple of watchlist/seen edits.
* Reads: ~2 phones x 3 opens x ~15 docs = 90, plus every change reaches the other phone as one doc read (~60 swipes/edits) = ~150; add ~1 rule lookup read per write (~100) => about 250-300 reads / household / evening.
* Writes: ~25 passes + ~25 yes (transaction) + ~10 other edits, x1 per swipe = ~70, +1 match month write => about 70-100 writes.
* So the writes quota (20k) is the limit: ~200 households could each have a heavy evening on the same day; with typical use (a quarter of that) ~800 active households per day. Reads (50k) support ~170 heavy / ~600 typical evenings. Reasonable planning figure: 150-250 households active on the same day, many hundreds in total.
* Storage: a typical household (2 people, 300 watched titles each, a few picks) is ~150-250 KB => ~4,000+ households in 1 GiB; a heavy household (4 people, 5,000 titles each) is ~4 MB => ~250.
* One-time costs: creating a household = ~5 writes; an import of 3,000 titles = 3 batches / ~24 writes; "Delete everything" = one delete per document (~10-60) plus a small number of reads.

## Known limits

* A watched list holds at most 10,000 titles per person; a household can have members m1..m999 over its lifetime.
* One outstanding invite per household. A full household can still make an invite (for re-claiming a place).
* Sessions: one per household; starting a new one replaces it. Passed swipes are not transactional (a swipe racing a brand-new session may land in the new one and is ignored by the UI).
* If a phone's browser storage is wiped it gets a new identity and must re-claim its member with an invite. A person alone with no other member to invite them back loses their lists in that case (the app says so).
* Offline: edits are queued and shown at once; creating, inviting, joining, renaming, removing, deleting and Together matches need a connection and say so.

## Memory mode (development and tests)

Same API; one device, localStorage key `pick.memory-sync.v2`. A second phone is impossible, so `createSync({mode:'memory'})` returns a `MemorySyncApi` with two extra, debug-only helpers (the UI's debug hooks and e2e tests use them):

* `debugAddMember(name, profile)` -> new member id. Adds a member without an invite (same rules: max 4, unique name).
* `debugActAs(memberId)`: this device now acts as that member (`getDevice().memberId` changes), so a test can swipe as each person in turn.

`createInvite()` returns a real-looking code; `previewInvite`/`joinWithCode` work against codes made on the same device (joining switches this device to the new / re-claimed member). `unpair()` keeps the household in storage (as the server would); `deleteHousehold()` wipes it.

## Tests

* `npx vitest run src/sync`: unit tests (assembly for 1-4 members, N-person match logic, invites and names, error mapping, memory mode).
* `npm run test:sync`: integration against the real project (needs anonymous sign-in enabled). Fresh households each run, deleted at the end.
* Deploy rules: `npx firebase-tools deploy --only firestore:rules --project pick-tonight-5tkr8 --non-interactive`.
