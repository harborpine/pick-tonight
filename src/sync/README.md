# Sync (Firebase layout)

`createSync({mode:'firebase'})` -> `firebase.ts`. `createSync({mode:'memory'})` -> `memory.ts` (one device, localStorage).
Shared pure logic: `match.ts` (match decision), `assemble.ts` (documents -> `SharedState`), `pairing.ts` (codes), `errors.ts` (plain-language messages).

## Firestore documents

```
households/{hid}                 members: { <uid>: {person, at} }, createdAt, lastJoinCode   (not listened to)
households/{hid}/data/shared     profiles.{HG,BG}, settings, never.{P}.{itemId}=ms, notTonight.{P}.{itemId}=date,
                                 watchlist.{list__itemId}=entry
households/{hid}/data/seen_HG    m.{itemId}=ms   THE LEGACY NUMBER MAP, unchanged since version 1 (still written by the new app)
households/{hid}/data/seen_BG
households/{hid}/seenx/{HG_0..HG_7, BG_0..BG_7}   e.{itemId}=JSON string of a SeenEntry (source, plays, snapshot); NEW in v2
households/{hid}/months/{YYYY-MM}  entries.{pickId}=PickEntry   (the pick log, one doc per month; called "history" in v1, same documents)
households/{hid}/sessions/{id}   the open Together session (deck, joined, yes, passed, matches); deleted when it ends
pairingCodes/{CODE}              hid, person (who made it), createdBy, createdAt (server time), used, usedBy
```

A phone listens to 6 things: `shared`, `seen_HG`, `seen_BG`, the whole `seenx` collection (up to 16 small docs), ALL `months` documents, and open `sessions`.
State is pushed to subscribers only after all six have answered once (cache or server), and updates are coalesced over 25 ms (one server change arrives as several listener callbacks).

All edits are field-level (`set` with merge / `updateDoc` with paths, `arrayUnion`, `deleteField`), so two phones editing different things never overwrite each other.

## Version 2 data shapes and compatibility (read this before changing storage)

**Watched titles (`SharedState.seen`).** A title is "watched" iff it is a key of `seen_{P}.m`; its value there is still a plain number (`at`), exactly as the first app version wrote it. The new details (source / plays / snapshot) are in `seenx`, sharded by a fixed hash of the title id (`shardOf`, never change it). Reading merges the two: `at` from `m`, the rest from `seenx`; a title with no details is `{at, source:'manual'}` (this is how every v1 entry is read, forever). Details whose title is no longer in `m` are ignored (that is what happens when the old app un-marks a title). Why details are one JSON string per title: a nested map would cost ~6 of Firestore's 40,000 index entries per document per title; a string costs 2. Why separate shard documents: 1 MiB per document.

**Picks (`SharedState.picks`).** Same `months/{YYYY-MM}` documents and the same entry fields as v1's history. Solo picks get the fixed id `solo-{who}-{itemId}` (two phones adding the same title at once make one entry); matches keep `match-{sessionId}-{itemId}`. `removePick` finds the month document that holds the entry (any month) and deletes the field. There is no cap and no time window any more: every month document is listened to (about one tiny document per month of use); the list stays small because people remove picks.

**What a phone still running the v1 app experiences once the new app has written data:** it reads `seen_*.m` (numbers, kept up to date by the new app) and `months` (same shape), and never looks at `seenx`. So: titles marked/imported on the new app appear as seen on the old one (without source/plays/snapshot, which v1 never had); titles un-marked on the new app disappear there; picks added on the new app show in the old History tab as before (solo/match lines) and picks removed on the new app disappear from it (v1 only showed the newest 300 of the last 12 months anyway). The old app's own writes (numbers, history lines) are understood by the new app. Things v1 cannot know: the new "any" time choice in a Together request (the old app's engine has no limit for it and may misbehave on a Together deck started from a new phone), and imported titles it never saw. Nothing is lost or corrupted in either direction. `firestore.rules` already allows members to read/write anything under their household, so no rules change was needed.

**Limits.** Per person: at most 19,500 watched titles (`SEEN_MAX`). Measured on the live project: the legacy number map holds 19,900 titles and fails at 20,100 ("too many index entries", Firestore's 40,000-per-document limit, 2 per title). Details: ~150 bytes per title spread over 8 shard documents (about 3 MB for 20,000 titles in total, ~370 KB per shard). A 12,000-title import took ~12 s end to end.

**`markWatched` / `unmarkWatched` writes.** Chunks of 1,000 titles, each chunk one atomic batch (details shards + the number map together; ~250 KB per request, far below the ~10 MiB request limit and the 500-operation batch limit). Up to 25 titles it behaves like every other edit (resolves at once; problems show in `device.error`). Bigger calls wait for the server: if a chunk is refused the promise rejects with a plain sentence saying how many titles were saved ("N of M titles were saved. Run it again to finish; nothing will be doubled."). Earlier chunks stay saved and are consistent; re-running writes the same values again. Offline: if the first chunk is not confirmed within 8 s, the rest is queued on the phone (the on-device cache applies it immediately) and the call resolves; it uploads by itself when the connection returns and any later refusal shows in `device.error` instead of rejecting.

## Pairing and security (`firestore.rules`)

- Members only for everything under `households/{hid}`; the household document itself cannot be listed.
- First phone creates the household (it is the only member). It makes a code (`pairingCodes/{CODE}`, 6 characters from a 31-letter alphabet, no 0/O/1/I/L).
- Second phone reads that one code document (get by exact name; codes cannot be listed) to learn the household id, then writes ONE batch: mark the code used + add its own uid to `members`. The rules allow the member-map change only if that same batch marks a valid (same household, unused, under 15 minutes old by SERVER time) code as used by this uid, and the joiner is not the same person as the code's maker.
- Up to 8 device slots. After joining, a phone removes older slots held by the same person (a phone iOS wiped).
- `unpair()` removes this phone's slot (best effort) and forgets the pairing locally.
- Anyone on the internet can sign in anonymously and create their own separate household; they cannot see ours.
- Brute-forcing a code: there are ~887 million codes, only one or two exist for 15 minutes at a time, and each guess is one request.

## Together sessions

- `startSession` writes the session (and deletes the one it replaces) in one batch; not blocked offline.
- A "pass" is an `arrayUnion` write (works offline). A "yes" runs a Firestore transaction on the session doc that applies `decideSwipe`, so even simultaneous yeses produce exactly one match and one pick entry (pick id is `match-{sessionId}-{itemId}`). Transactions need a connection; offline they fail after ~20 s with a plain message.
- Deck cap: 400 cards (a card is ~0.4 KB, so a full session is far below 1 MB).

## Free-tier estimate (Spark: 50k reads, 20k writes per day)

Opening the app: ~5 reads plus the seenx shards (up to 16) and one per month of picks (0-1 session) plus rule lookups of the household doc. With the offline cache, re-opening often costs only changed documents.
A typical Together evening (60 swipes by each phone): ~120 swipe writes plus ~60 rule reads, ~20 more writes for saves/watched/picks. Roughly 300 writes and 1,000 reads per evening, around 2% of the daily limits.

## Known limits

- If BOTH phones lose their anonymous identity (iOS storage wipe on both), nobody can open the household any more; the data is orphaned and a new household must be made.
- Code expiry is enforced by the server, so it cannot be unit-tested; `pairing.ts` has the same rule for display.
