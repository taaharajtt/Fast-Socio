# UAT-18 remediation — audit, implementation and verification

Everything below is code that is committed to the working tree, builds, lints and
passes `npm test`.

**Migration `0178_uat18_remediation.sql` was applied to Frankfurt production
(`xnbzenixmgghxsjpektp`) on 2026-09-02** and verified with
`supabase/tests/uat18_verification.sql`. **The app code is not deployed yet**, so
the database is ahead of the client — deliberately, and backwards-compatibly (see
§5). Two pre-existing data conditions need a decision from you; they are listed at
the end and nothing was auto-corrected.

---

## 1. Status table

| UAT | Status | One-line result |
|-----|--------|-----------------|
| 01 — two ways to send a 250-char request | **Fixed** | One action, one RPC, both entry points; profile gained a real "Request to chat" |
| 02 — requests must not disappear | **Fixed** | Atomic accept RPC + the sender-side list that never existed + accepted-empty conversations now show |
| 03 — chat-quality conversation UI | **Partially fixed** | Shared merge + scroll rules and broadcast parity landed; event thread still lacks image/reply/reaction |
| 04 — broadcast permissions and hierarchy | **Fixed** (reply UI pending) | Full matrix in SQL, anonymity + reveal + reactions shipped; threaded replies have schema and RPC but no UI yet |
| 05 — block and mute semantics | **Partially fixed** | Enforced at the single notification chokepoint; content-surface sweep not exhaustive |
| 06 — scroll and composer UX | **Fixed** (needs device pass) | One tested rule across all four threads; manual viewport checklist below |
| 07 — obvious Create group | **Fixed** | CTA driven by the team, not by post status; becomes "Open group" |
| 08 — owners can rename | **Fixed** | Narrow rename RPCs; events gained the control they never had |
| 09 — recruitment end to end | **Fixed** | The lifecycle was already correct; the missing applicant-status view is now there |
| 10 — time and timezone | **Fixed** for events | One injected-clock helper, boundary refresh, PKT stated in the UI |
| 11 — no duplicate comments or messages | **Fixed** | Four surfaces now share the DM thread's merge rules |
| 12 — matches require mutual likes | **Fixed** | Database backstop makes a one-sided match impossible; read-only audit view |
| 13 — preserve the anonymous choice | **Fixed** (root cause unconfirmed) | Explicit default, literal-`true` server rule, visible state, keyed reset |
| 14 — Campus Help full description | **Fixed** | Clamp removed on the main listing only |
| 15 — shuffle between sessions | **Fixed** | Seeded band shuffle threaded through every page |
| 16 — account deletion completes | **Fixed** | Order reversed so the irreversible step can no longer run before the authoritative one |
| 17 — poll creator can inspect ballots | **Fixed** | Definer RPC + creator-only tap target on all three poll surfaces |
| 18 — notifications page coverage | **Fixed** | Allow-list revised deliberately; high-volume surfaces grouped by subject |

---

## 2. Root cause and implementation, per item

### UAT-01 — two entry points, one behaviour

**Root cause.** `sendMessageRequest` lived in `discover/actions.ts` as a bare
INSERT and was the *only* entry point, which is why the profile page had nothing
to offer. The profile showed an inert **"Match to chat"** caption — a rule that
was never true: `message_requests` has been the intended first-contact path since
mig 0004 and needs no match.

**What changed.**
- `send_message_request(p_recipient, p_message)` (mig 0178) — 1–250 chars, self
  check, block check, recipient availability, and **idempotent**: a repeat tap
  returns the existing pending row rather than erroring.
- One canonical action in [chat/actions.ts](src/app/(student)/chat/actions.ts).
- One composer, [`RequestToChatSheet`](src/components/chat/request-to-chat.tsx),
  used by the Discover card and the profile button alike.
- Rules extracted to [message-request.ts](src/lib/chat/message-request.ts).

Block and "account unavailable" deliberately return the **same** message, so
neither side can probe the other's block list by comparing error text.

### UAT-02 — the disappearing request

**Two root causes, both real.**

1. **The sender had no surface at all.** The inbox read outgoing requests for one
   purpose — hiding an already-contacted match — and discarded the rows. From the
   sender's side a request left no trace anywhere in the app.
2. **Accepted requests fell between the panels.** Accept flipped the status
   (removing it from Requests, which filters `status = 'pending'`) and created a
   conversation — but the inbox only lists a conversation once it has a message.
   An accepted request therefore existed on *neither* panel until someone spoke.

The accept path was also three separate statements from the app (read sender →
UPDATE → `get_or_create_conversation`), so a failure or a race between steps two
and three left an accepted request with no conversation at all.

**What changed.** `accept_message_request(p_id)` does the flip and the
conversation in one transaction, takes `FOR UPDATE` so simultaneous accepts
serialise, is idempotent, and returns the conversation id — which the Accept
button now navigates straight into. `decline_message_request` is likewise
idempotent. [inbox-data.ts](src/app/(student)/chat/inbox-data.ts) gained the
outgoing list and treats an accepted pair as a started conversation;
[sent-request-row.tsx](src/components/chat/sent-request-row.tsx) renders it.

### UAT-03 — conversation quality

Landed: shared dedupe/ordering (UAT-11), shared scroll rule (UAT-06), and
broadcast parity — text, image, poll, reactions and anonymous sending.
**Not landed:** the event discussion is still text-only, and broadcast replies
have their column, their RPC validation and their notification wiring but no UI.
Both are noted as follow-up rather than claimed.

### UAT-04 — the capability matrix

Mapped onto the roles that already exist (`community_role` + `society_roles`);
no second role system. Ranks are `society_role_rank`'s, unchanged.

| Capability | member (10) | moderator (30) | president (90) | owner (100) |
|---|:--:|:--:|:--:|:--:|
| post text / image / poll, vote, react, reply | ✅ | ✅ | ✅ | ✅ |
| post anonymously | ✅ | ✅ | ✅ | ✅ |
| approve/decline membership | — | ✅ | ✅ | ✅ |
| reveal an anonymous author | — | — | ✅ | ✅ |
| create/manage society events | — | — | ✅ | ✅ |
| assign/remove **moderator** | — | — | ✅ | ✅ |
| assign/remove **any officer**, incl. president | — | — | — | ✅ |
| remove members | — | — | — | ✅ |
| transfer ownership | — | — | — | ✅ |

**Policy decisions, stated rather than implied.**
- **One president per society**, enforced by a partial unique index — "reveal an
  anonymous author" is a real privacy power and must be attributable to one
  person. `vice_president` (80) deliberately does **not** inherit reveal.
- **Owner transfer** is the only way an owner is demoted:
  `transfer_society_ownership` moves `owner_id`, steps any sitting president down
  to vice-president, and leaves the outgoing owner as president, so a society is
  never left with nobody able to run it.
- **The president gains exactly one new power** (appointing/removing moderators).
  A president who could appoint presidents would make the single-president rule
  unenforceable from inside the app.

**Anonymity is masked in the read path**, not the client:
`society_announcement_feed` returns NULL author fields to anyone below president
rank, and the realtime handler re-reads through that same view — so no payload
can leak what the view masks. The `is_anonymous` flag also stops two anonymous
messages (both `author_id IS NULL`) grouping as "the same person".

### UAT-05 — block and mute

**Root cause.** The rules were enforced per-trigger. That design is exactly what
lets a new surface ship without them, and mig 0168's chat-surface notifications
had done precisely that.

**What changed.** One predicate, `may_notify(recipient, actor)`, applied inside
`create_notification` — the chokepoint every notification passes through.
Block is bidirectional and silent; mute is one-directional, notification-only and
never disclosed to the muted user. Push inherits it for free:
`dispatch_push_notification` fires on the `notifications` INSERT that no longer
happens.

**Not claimed:** an exhaustive sweep of every content surface for block
invisibility. Discover, comments, likes, swipes, requests and conversations were
already covered by `is_blocked` in RLS; members/attendee lists and search were not
re-audited in this pass.

### UAT-06 — scroll and composer

**Root cause.** All four threads scrolled on *every* change to `messages.length`,
which drags a reader out of history whenever anyone speaks — and the position
they lose is not recorded anywhere, so it cannot be given back. The event
discussion additionally used `scrollIntoView`, which walks every scrollable
ancestor and was the visible page jump when the keyboard opened.

**What changed.** [scroll-anchor.ts](src/lib/chat/scroll-anchor.ts): scroll only
when the reader is near the bottom or sent the message themselves; first paint
always opens at the latest. Applied to the DM thread, the community room, the
society broadcast and the event discussion; the event thread now scrolls its own
container and has `overscroll-contain`.

### UAT-07 — Create group

**Root cause.** The CTA rendered only while `status === "open"`, and
`create_discover_group_chat` sets the post to `filled` — so the action erased
itself the instant it succeeded, and a filled post with a live room offered no way
back into it. The RPC was already idempotent; nothing about it needed changing.

**What changed.** `MyIntent` carries `groupId`; the CTA is driven by the team, not
the status; a post with a room shows **Open group** → `/chat/c/[id]`. Private
Discover rooms stay out of public browsing (`is_discover_group` filtering,
unchanged).

### UAT-08 — renaming

`rename_community` / `rename_event` touch **one column**. That is the point of
using an RPC rather than the existing UPDATE policy: a policy broad enough to
permit the row also permits `status`, `owner_id` and `starts_at` in the same
statement — which is how the `admin_role` privesc happened once already.
[RenameControl](src/components/ui/rename-control.tsx) handles trim, bounds, empty,
unchanged (a no-op, not a write), Escape-to-cancel and a rejected concurrent edit.
Events had no rename at all; communities and chat rooms already did.

### UAT-09 — recruitment

**Audit result: the lifecycle was already correct.**
`express_smart_match_interest` already enforces open-status, expiry, self,
blocked, one-application-per-pair (`on conflict`), already-applied, and notifies
the author; `SWIPE_CTA.recruitment` already reads "Swipe right to apply".

**The one real gap** was the applicant's side: nothing in the app showed that
your application existed or what became of it. `MyDiscoverData.outgoing` and a
**Your requests** section now do.

### UAT-10 — time

**Root causes.** `hasEnded` was a local function in the event page that read
`Date.now()` inside itself (untestable boundary) and treated `ends_at ?? starts_at`
as the end — so an **open-ended event read as over the moment it began**. Nothing
ever re-evaluated the state without a manual reload.

**What changed.** [time-state.ts](src/lib/events/time-state.ts) — injected clock,
inclusive start, exclusive end, an explicit open-ended duration, and
`nextBoundary` so the client schedules **one** timer rather than polling.
[EventStateBadge](src/components/events/event-state-badge.tsx) re-syncs on that
timer plus focus/visibility, because mobile browsers throttle background timers.
Times are formatted in `Asia/Karachi` (already true) and the UI now **says
PKT** — a student reading "18:00" could not otherwise tell whose clock it was.

### UAT-11 — duplicates

`message-merge.ts` was already correct and already handled the id-based
optimistic reconcile. The problem was that it was **DM-only**: `MergeableMessage`
required `sender_id`, which the broadcast row (`author_id`) does not have, so the
room, broadcast, event and comment threads each grew their own
`prev.some(id) ? prev : [...prev, row]`. That deduplicates but *appends* — after a
reconnect a catch-up read and a live event arrive in either order and render out
of sequence. Dropping the unused `sender_id` requirement let all four share the
one implementation.

### UAT-12 — matches

**Root cause.** `handle_swipe_match` is the only intended writer, but `matches`
had an INSERT-shaped hole: anything holding a definer context could mint a match
with no likes behind it — and the product's strongest privacy promise (a DM
channel opens only by mutual consent) rested on that not happening.

**What changed.** A BEFORE INSERT trigger requiring a canonical pair, an explicit
`like` from **both** users, and no block. The escape hatch is a narrow
`app.match_import` GUC for a lawful import, the same pattern
`protect_community_status` already uses; nothing in the application sets it.
Suspicious existing rows are **reported, never deleted** — a false positive would
destroy a real relationship and its whole conversation. Read-only view:
`public.matches_without_mutual_likes`.

### UAT-13 — anonymity

**Honest note: I could not reproduce a case where a post silently became
anonymous.** The server already forced attribution for community posts and the
composer already reset on success. What the code did have was three ways for it to
go wrong, all now closed:

- `resolveAnonymity` requires a **literal `true`** — `"false"` and `"0"` are
  truthy strings, and a server action's argument is whatever the caller sent.
- The default is written out as `false`, never left `undefined`.
- Anonymity is no longer a silent state: a banner says *"Posting anonymously"* and
  carries its own Undo, so it cannot persist unnoticed after an error.

The request sheet uses **keyed remount** rather than a reset effect, which is the
structurally correct fix for stale modal state.

### UAT-14 — Campus Help

`line-clamp-2` removed from the main listing card, with `break-words` added so an
unbroken URL cannot give the page a horizontal scrollbar now that nothing
truncates. **`HomeHelpStrip` is deliberately left clamped** — it is a fixed-height
horizontal rail and a long ask would break its rhythm.

### UAT-15 — shuffle

`ORDER BY random()` is ruled out: the deck is keyset-paginated, so re-randomising
per page produces duplicates *and* silently skipped candidates.

Instead, two keys are inserted into the existing window ordering between the
department diversification and the exact compatibility score: a coarse
compatibility **band** (`compatibility / 10`), then a **seeded hash of the
candidate id**. Relevance survives (a 90% candidate still outranks a 40% one);
the order shuffles freely within a band. **With `p_seed` NULL both keys collapse
to constants, so the function reduces exactly to 0177** and
`discover_candidates_parity.sql` still applies.

"New session" is defined as `sessionStorage` — not elapsed time or page loads,
which misfire badly for a PWA that is backgrounded for days rather than closed.
Page one is server-rendered, so the client mirrors its session seed into a cookie
and **rotates it for the next session**, adopting whatever the server just used so
page one and every refill share one seed.

### UAT-16 — deletion

**Root cause: the order was backwards.** Storage was purged *first*, then the auth
user deleted. If the delete failed, the student had just had every avatar, post
image and DM attachment destroyed while their account carried on existing — the
irreversible half ran first and the authoritative half could still fail. An S3
listing error also threw out of the whole action.

**Now:** read the object paths (only discoverable while the rows exist) → delete
the account → purge, best-effort, logging orphaned keys for re-run. A failure
before the delete is fully retryable; a failure after it leaves an account that is
genuinely gone, which is what the UI is about to claim. The service-role client
stays server-only and is only ever handed the id from the caller's own session.

### UAT-17 — ballots

Hiding the tap target is not a control: the vote tables are readable and a
determined voter could enumerate them. `poll_ballots(p_poll_id)` resolves the
poll's creator and refuses anyone else **before selecting a single row**;
`poll_is_mine` is a separate cheap call so the UI can decide whether to render the
button without every viewer attempting a privileged read. Anonymity is unaffected
— the list is of **voters**, who chose openly; the anonymous author of a carrying
message is not in the returned data at all.

### UAT-18 — notifications

**The old policy was right for DMs and wrong for shared spaces.** A society
broadcast, a chat-room message and an event discussion post are addressed to a
group the reader belongs to, they do **not** raise the Chat dock badge (their
conversations live on the room/society/event pages), and so they produced no
signal anywhere in the app.

Now allowed: `community_message`, `society_announcement`, `event_message`, plus
the community/society lifecycle rows. **Grouped by subject** via `group_key` —
`create_notification` has collapsed on `(user_id, type, group_key)` since 0057;
these three fan-outs simply never passed one — so a busy room is one row with a
count, not thirty rows burying everything else.

**Still excluded, deliberately:** `message`, `message_request`,
`message_request_accepted`, `message_reaction` (three surfaces already serve
direct chat) and `announcement` (a cold-open modal).

---

## 3. Database and security changes

All in `supabase/migrations/0178_uat18_remediation.sql`, forward-only and
idempotent. 22 functions, one trigger, one view, two tables/columns sets.

- **Chokepoint:** `create_notification` gains the block/mute gate.
- **New RPCs:** `send_message_request`, `accept_message_request`,
  `decline_message_request`, `society_capabilities`,
  `reveal_announcement_author`, `toggle_announcement_reaction`,
  `transfer_society_ownership`, `poll_ballots`, `poll_is_mine`,
  `rename_community`, `rename_event`, `is_muted`, `may_notify`.
- **Rewritten:** `post_society_announcement` (members may post; anonymity;
  replies), `assign_society_role` / `remove_society_role` (president may move
  moderators), `society_announcement_feed` (anonymity masking),
  `get_discover_candidates` (seed parameter — **arity changes, so the 2-arg form
  is dropped**, otherwise a 2-arg call becomes ambiguous),
  `notify_community_message` / `notify_society_members` / `notify_event_message`
  (group keys).
- **Integrity:** `matches_require_mutual_like` trigger + `matches_without_mutual_likes`
  view; one-president partial unique index.
- **Posture:** every privileged function is SECURITY DEFINER, revoked from
  `public`/`anon`, granted to `authenticated` only. `getSocietyCapabilities` fails
  **closed**.

No service-role key reaches client code. No admin access to private DMs was
broadened; `docs/DM-SELECTIVE-REPORTING-DESIGN.md` guarantees are untouched.

---

## 4. Tests and command results

```
npm test    →  49 files, 668 tests, all passing
npm run lint →  no new errors (pre-existing baseline unchanged)
npm run build →  ✓ Compiled successfully in 75s
```

New Vitest suites:

| File | Covers |
|---|---|
| `src/lib/chat/message-request.test.ts` | 0 / 1 / 250 / 251 chars, whitespace, trimming, error mapping, no block oracle |
| `src/lib/feed/composer-state.test.ts` | anonymity default, reset, literal-`true`, community override |
| `src/lib/events/time-state.test.ts` | every boundary, open-ended, malformed range, DST + non-Pakistan viewers |
| `src/lib/discover/session-seed.test.ts` | same-seed stability, new-session variation, cookie adoption/rotation, hostile storage |
| `src/lib/chat/scroll-anchor.test.ts` | near-bottom tolerance, position not stolen, own-message override, pill |
| `src/lib/chat/message-merge.test.ts` (extended) | both arrival orders, reconnect replay, identical consecutive messages, shared timestamps, no `sender_id` |
| `src/lib/notifications/view.test.ts` (revised) | the allow-list change, and its rationale |

SQL harness: `supabase/tests/uat18_verification.sql` — runs in a rolled-back
transaction and covers UAT-01/02/04/05/08/12/15/17/18, including negative
authorization against every privileged RPC. **Not yet run** (see below).

---

## 5. Applying it — what happened, and what is still unverified

### Applied

`0178` is live on **Frankfurt** (`xnbzenixmgghxsjpektp`, eu-central-1) as of
2026-09-02. There is no separate dev project: Tokyo (`skgphoupbwdexfevgcnn`) is
the legacy pre-cutover database and is ~20 migrations behind — it does not even
have `get_discover_candidates(integer, uuid[])` — so it was not a useful
rehearsal target.

**Two defects in this migration were found by applying it, and fixed:**

1. **An arity overload that would have broken broadcast posting on production.**
   `create or replace function` does not replace across a different arity — it
   creates an *overload*. `post_society_announcement` was live with 5 parameters;
   the new version has 7. The deployed client calls it with five **named**
   arguments, which would then have matched both candidates, and PostgreSQL
   answers `function is not unique`. Fixed with an explicit
   `drop function ...(uuid, text, text, text, text)` before the create; the same
   five named arguments now resolve to the new function through its defaults.
2. **`create or replace view` cannot reorder columns** (`42P16: cannot change
   name of view column "author_id" to "is_anonymous"`). `is_anonymous` and
   `reply_to_id` are appended at the END of `society_announcement_feed` instead;
   the original sixteen columns keep their names, order and types, so the
   deployed client is unaffected and the grant survives.

Both were caught because the file runs as **one implicit transaction** — the
first attempt rolled back completely, leaving production untouched. Apply it as a
single request for exactly that property.

### Verified against the live database

- Structural: 14/14 new functions present, all SECURITY DEFINER, none executable
  by `anon`; `post_society_announcement` has exactly **one** overload;
  `get_discover_candidates` is 3-arg with the 2-arg form gone; the
  `matches_require_mutual_like` trigger, the reactions table and the
  `matches_without_mutual_likes` view all exist.
- Harness sections 0–5 (structural + posture, UAT-12, UAT-05 A/B/C, UAT-01/02,
  UAT-17, the UAT-04 role matrix with direct unauthorized RPC attempts) and 6–8
  (UAT-08, UAT-15 seeded ordering + pagination parity, UAT-18 group keys) all
  pass, inside a rolled-back transaction.
- **Deployed-client smoke test**, rolled back: the 5-named-argument broadcast call
  resolves, the 2-named-argument Discover call resolves, and the feed view still
  exposes all 16 columns the shipped build selects.
- Production stayed healthy through the apply — notifications continued to be
  created, so the new block/mute gate inside `create_notification` is live and not
  throwing.

### Two decisions for you (nothing was auto-corrected)

1. **Society "Hostelities" holds 6 presidents.** The one-president partial unique
   index is skipped by its own guard when the data already violates it, so the
   migration applied cleanly but **the rule is not enforced**. Demote five, then
   create the index, or drop the single-president policy.
2. **9 matches have no reciprocal like** — 5 where `user_low` liked and was not
   liked back, 4 the reverse. So UAT-12 describes something real. They survive
   (the trigger is `BEFORE INSERT`); read them from
   `public.matches_without_mutual_likes`. They are deliberately not deleted: a
   false positive would destroy a real relationship and its whole conversation.

### Still unverified

`supabase/tests/discover_candidates_parity.sql` has not been re-run since the
seed parameter landed. Run it to confirm the unseeded path is still byte-identical
to 0177.

**Manual multi-user checks that remain** (these need the app deployed first):

**Manual multi-user checks that remain:**

1. **UAT-01/02** — two accounts. Send from Discover and from the profile; confirm
   one pending row. Accept on device B and confirm device A's Sent row flips to
   Accepted and the thread appears in Messages on both. Force-quit and reopen
   both; refresh; kill the network and restore it.
2. **UAT-02 concurrency** — accept the same request from two devices at once;
   exactly one conversation must result.
3. **UAT-04** — four accounts at member / moderator / president / owner. Walk the
   matrix. Post anonymously as a member and confirm the moderator sees
   "Anonymous" while the president's Reveal works.
4. **UAT-05** — A, B, C. A mutes B and blocks C, then have each act; confirm A's
   notifications and pushes, and that B is never told.
5. **UAT-06** — iOS Safari and Android Chrome, standalone PWA: open the keyboard
   in each of the four threads and confirm no page jump; scroll up and have the
   other account send; rotate; enable Reduce Motion.
6. **UAT-15** — open Discover, note the first ten cards, fully close the PWA,
   reopen; the order should differ. Reload mid-session; it must **not**.
7. **UAT-16** — **disposable fixture account only.** Do not run against a real
   user, and specifically **not against Tahir Mughal** — the handwritten note
   naming that account is a bug report, not authorization. Deleting a real user is
   a separate, audited admin operation.
8. **UAT-17** — three accounts vote; confirm only the creator sees the tap target,
   and that calling `poll_ballots` as a non-creator is refused.

---

## 6. Known risks and follow-up

- **`get_discover_candidates` changes arity.** `drop function … (integer, uuid[])`
  runs before the 3-arg create. Any out-of-band caller passing two positional
  arguments still resolves via the default; a caller that inspects the signature
  will not.
- **Broadcast members can now post.** This is the intended UAT-04 change and it is
  a genuine product shift — a society's channel stops being a one-way notice
  board. Worth confirming with whoever owns that decision before prod.
- **`matches_require_mutual_like` is strict.** Any future code path that creates a
  match without two `like` rows will now fail loudly. That is the point, but it is
  a behaviour change for anything not yet identified.
- **Follow-up work, not done:** event-discussion image/reply/reaction parity
  (UAT-03); broadcast reply UI (schema and RPC exist); a full block-invisibility
  sweep of members/attendee lists and search (UAT-05); migrating the events list,
  society events tab and community strip onto `time-state` (UAT-10 currently
  covers the event detail page only).
- **UAT-13's original trigger was never reproduced.** The fixes are hardening and
  they close every mechanism I could find, but if the report recurs the next place
  to look is the `feed_posts` view's author masking rather than the composer.
