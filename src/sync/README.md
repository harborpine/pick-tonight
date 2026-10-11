# Sync (Firebase layout)

`createSync({mode:'firebase'})` -> `firebase.ts`. `createSync({mode:'memory'})` -> `memory.ts` (one device, localStorage).
Shared pure logic: `match.ts` (match decision), `assemble.ts` (documents -> `SharedState`), `pairing.ts` (codes), `errors.ts` (plain-language messages).

## Firestore documents

```
households/{hid}                 members: { <uid>: {person, at} }, createdAt, lastJoinCode   (not listened to)
households/{hid}/data/shared     profiles.{HG,BG}, settings, never.{P}.{itemId}=ms, notTonight.{P}.{itemId}=date,
                                 watchlist.{list__itemId}=entry
households/{hid}/data/seen_HG    m.{itemId}=ms        (one doc per person: thousands of ids fit well under 1 MB)
households/{hid}/data/seen_BG
households/{hid}/months/{YYYY-MM}  entries.{historyId}=HistoryEntry   (history, one doc per month)
households/{hid}/sessions/{id}   the open Together session (deck, joined, yes, passed, matches); deleted when it ends
pairingCodes/{CODE}              hid, person (who made it), createdBy, createdAt (server time), used, usedBy
```

A phone listens to 5 things: `shared`, `seen_HG`, `seen_BG`, the last 12 months of `months`, and open `sessions`.
State is pushed to subscribers only after all five have answered once (cache or server). History in state is capped at the newest 300.

All edits are field-level (`updateDoc` with paths like `seen.m.tv-1399`, `arrayUnion`, `deleteField`), so two phones editing different things never overwrite each other.

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
- A "pass" is an `arrayUnion` write (works offline). A "yes" runs a Firestore transaction on the session doc that applies `decideSwipe`, so even simultaneous yeses produce exactly one match and one history entry (history id is `match-{sessionId}-{itemId}`). Transactions need a connection; offline they fail after ~20 s with a plain message.
- Deck cap: 400 cards (a card is ~0.4 KB, so a full session is far below 1 MB).

## Free-tier estimate (Spark: 50k reads, 20k writes per day)

Opening the app: ~5 reads of documents (shared, 2 seen, current + recent month docs, 0-1 session) plus rule lookups of the household doc. With the offline cache, re-opening often costs only changed documents.
A typical Together evening (60 swipes by each phone): ~120 swipe writes plus ~60 rule reads, ~20 more writes for saves/seen/history. Roughly 300 writes and 1,000 reads per evening, around 2% of the daily limits.

## Known limits

- If BOTH phones lose their anonymous identity (iOS storage wipe on both), nobody can open the household any more; the data is orphaned and a new household must be made.
- Code expiry is enforced by the server, so it cannot be unit-tested; `pairing.ts` has the same rule for display.
