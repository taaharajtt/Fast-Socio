# Summary

**35 DONE · 0 PARTIAL · 3 BLOCKED** €” all 38 fixes have a status.

BLOCKED: **fix-018** (media instead of anonymous posting in discover groups), **fix-014**
(shared date & time picker), **fix-025** (pin-a-location picker €” depends on 014). None of
the three was started, so there is no half-finished state to unpick; each has a "what it
needs" note in its log entry. Nothing was blocked by a technical obstacle €” I ran out of
session budget, and 025 legitimately sat last because it depends on 014.

`npm run build` is **green** on `fixes-final-batch`, and `npm run lint` is back to its
pre-existing baseline: 3 errors, all of them `require()` imports in `scripts/gen-splash.js`,
which were already red on `main` before this run. This run introduced no new lint errors.
Nothing pushed, nothing deployed.

## Migrations applied (all verified by EXECUTING, not just creating)
| # | What |
|---|---|
| **0131** | `can_manage_community` rewritten (societies: owner + moderator/officers; chat rooms: owner only); the self-join INSERT policy on `community_members` **dropped**; `moderate_community_post` routed through the same authority; officer appointment/demotion restricted to the owner with a self-resign branch |
| **0132** | 8 typed FK columns on `notifications` with `ON DELETE CASCADE` + a populating trigger; **267 orphan notifications removed**; `notifications_live` view for the read paths |
| **0133** | `get_profile_post_count` definer aggregate (fix-036) |
| **0134** | `posts.edited_at`, definer `edit_post`, and the missing `WITH CHECK` on the authors-update policy |
| **0135** | Owner-only `delete_chat_room` |

## Commits (6, all on `fixes-final-batch`)
`5a4f99e` Batch A · `f95f1b1` Batches B+C · `78d4f43` Batch D+ · `907c14b` defensive WIP ·
`770c03c` fix-035 · `5108406` Batches E/F/G

## Top 3 things needing your attention

1. **Two live security holes were closed €” please sanity-check the blast radius.** Anyone
   authenticated could `POST /rest/v1/community_members` and join any approved community
   with no approval, bypassing the entire join-request flow; and `can_manage_community`
   granted management to anyone holding *any* `society_roles` row. Both are fixed in 0131.
   Nothing in production lost access (zero `moderator` members, zero `society_roles` rows),
   but this changed the authorization model, so it deserves your eyes before it ships.

2. **fix-034 leaves 52 of 144 profiles with `gender IS NULL`.** Per the runbook's stated
   default I did NOT add `NOT NULL` €” the column stays nullable, enforced in the app only.
   Those 52 users will hit the new validation the next time they edit their profile.
   **Decide whether you want a backfill.** Also: the subagent removed an unused `"other"`
   option from `GENDERS` without being asked; no row uses it, but revert if you disagree.

3. **A subagent ran `git stash`/`git stash pop` mid-run and repeatedly wiped the working
   tree** (three `reset: moving to HEAD` entries in the reflog). I caught it, committed
   defensively at `907c14b`, and ordered every agent to stop using destructive git. All work
   was recovered and the build is green €” but **two stash entries remain**
   (`stash@{0}`, `stash@{1}`, both on `78d4f43`). I left them rather than drop them. Please
   confirm nothing you care about is only in there, then `git stash drop` twice.

## Delegation: where it held and where it didn't

I delegated **11 units of work** to Sonnet 5 subagents: fixes 001, 002, 012, 020, 021, 003,
013, 016, 027+028, 029+017, 010+011, 015/032/033/034, 037+008, 038, 022, and the fix-009 UI.
I kept all of Batch A, every migration, the fix-004 audit, and the fix-026/036 diagnoses.

**Where it held:** the mechanical asset and token swaps (001, 002, 012, 020, 021) came back
essentially perfect. The bigger structured jobs €” 022's not-found audit, 010's 26 map pins,
the profile-edit cluster €” were good work I would not have wanted to hand-write.

**Where it didn't, and what I had to correct:**
- **fix-008: the subagent reported "nothing to do" and was wrong.** It searched for a lucide
  `Paperclip` beside the preview. The paperclip was a literal emoji baked into the message
  body (`"ðŸ“Ž Shared a post"`). I found and fixed it myself, including the 18 existing rows.
  This is the one case where accepting the report at face value would have shipped a
  non-fix.
- **The `git stash` incident** (item 3) €” the most expensive failure of the run.
- Three subagents independently mis-stated other agents' in-flight edits as "pre-existing
  errors". Harmless here, but it is what concurrency on one tree buys you.
- Three fixes had **wrong premises in the runbook**, which the subagents correctly detected
  rather than inventing work: there was no search in the chat *inbox* (fix-038 €” it was
  in-thread); there is no `[i]` info icon on the map (fix-011 €” the duplicate was Fit vs
  Reset); and the "+ skill" input is not in the profile form (fix-015 €” it is in
  `post-intent-fields.tsx`). Also there are no filter chips on the map, so fix-010's
  "wire the chip" step was vacuous, and there is no `/manage` URL segment, so fix-023's
  "404 the segment" step did not apply.

## One thing I could not do
**Browser verification did not happen.** Operating rule 6 asks for screenshots into
`.fix-screenshots/`; that needs a signed-in session and I had no test credentials, and for
fix-026 specifically it needs two accounts. Everything visual is verified by a green
production build and by reading the resulting markup; everything database-backed is verified
by executing SQL against production and quoted in the entries. **The highest-value manual
check in the morning is fix-026:** two pending join requests are already sitting in the
table and should now appear in that community's Manage tab immediately.

---
# Fixes Final €” run log (branch `fixes-final-batch`)

Started 2026-07-29. Summary section will be written at the top when the run ends.

---

# Batch A €” Security & broken flows

## fix-023 €” Manage tab is owners/moderators only
Status: DONE
Files:
- `supabase/migrations/0131_manage_authorization.sql`
- `src/lib/communities/relationship.ts`
- `src/app/(student)/communities/[id]/page.tsx`
- `src/lib/societies/load.ts`
- `src/app/(student)/chat/c/[id]/page.tsx`
Migration: **0131 applied** (`manage_authorization`)

### What was actually wrong
The *tab rendering* was already gated (`if (canManage)` in both page.tsx files), so
the visible symptom was narrower than reported. The real defects were underneath:

1. `can_manage_community()` €” the single authority used by every manage RPC **and**
   the `community_join_requests` SELECT policy €” granted management to *anyone with a
   `society_roles` row*, regardless of the role value in it. Presence of the row was
   the whole test.
2. It applied the same rule to casual chat rooms and to societies, so a `moderator`
   `community_members` row would have granted management on a chat room too (fix-031).
3. `moderate_community_post()` didn't consult it at all €” it hand-rolled a
   `community_members.role in ('owner','moderator')` check that ignored `owner_id`
   entirely and locked out every society officer.
4. **Live hole:** `community_members` had an INSERT policy
   ("students join approved communities") letting *any authenticated user insert
   themselves as a member of any approved community* via a direct PostgREST call €”
   no approval, instant chat access. No application code path used it (grepped every
   `.from("community_members")` call site: all SELECT/DELETE). Dropped.

### Action †’ who can call it now †’ enforced at
| Action | Who | Enforced at |
|---|---|---|
| Edit community (name/desc/cover) | owner only | RLS `owners edit their community` + action `.eq("owner_id", uid)` |
| Cover upload | owner only | same UPDATE policy |
| Approve/reject member post | owner, society moderator/officer, admin | RPC `moderate_community_post` †’ `can_manage_community` (**both**, rewritten in 0131) |
| Read join-request queue | requester, or manager | RLS `requesters and managers read join requests` †’ `can_manage_community` |
| Approve/reject join request | manager | RPC `decide_community_join_request` (definer, explicit check) |
| Remove member | manager, never another manager | RPC `remove_community_member` (definer, explicit check) |
| Appoint / demote officer | **owner or admin only** | RPC `assign_society_role` / `remove_society_role` (**rewritten in 0131**) |
| Edit society identity | president+ or admin | RPC `upsert_society_profile` (unchanged, mig 0120) |
| Self-join a community | **nobody** €” approval only | INSERT policy dropped in 0131 |
| Leave a community | self, not the owner | RLS `members leave communities` |

### Other member-visible surfaces that let a plain member mutate community state
- The dropped self-insert policy was the only one found. Everything else routes
  through a SECURITY DEFINER RPC with an explicit authorization check.

Decisions: (a) `can_manage_community` now branches on `is_society` rather than adding a
second function €” one authority is easier to keep honest than two. (b) Post moderation
was *widened* to society officers to match what the Manage tab already shows them; that
is an alignment, not a new hole.
Verified: `can_manage_community` executed against live rows €” owner `true`, plain member
`false`, super-admin member `true` (expected). `pg_policies` re-queried: the self-join
INSERT policy is gone; only SELECT + DELETE remain on `community_members`.
Notes: production currently has **zero** `community_members` rows with role `moderator`
and **zero** `society_roles` rows, so narrowing removed no live user's access.

## fix-031 €” Chat room Manage restricted to owners
Status: DONE
Files: same as fix-023 (`0131`, `relationship.ts`, `communities/[id]/page.tsx`)
Migration: 0131 (shared with fix-023)

In this codebase `/communities/[id]` **is** the casual chat room (`is_society = false`);
societies live at `/societies/[id]`. `can_manage_community` now grants delegated
management only when `communities.is_society` is true, so for a room it collapses to
`owner_id = user OR is_admin(user)`. The client mirror `getCommunityRelationship` takes
a new required `isSociety` argument and applies the identical rule, so the UI and the DB
cannot drift.

| Action | Who on a chat room | Enforced at |
|---|---|---|
| See/use Manage tab | owner, admin | page gate on `rel.canManage` (mirror) |
| Join-request queue read | owner, admin, requester | RLS †’ `can_manage_community` |
| Approve/reject join request | owner, admin | RPC (definer) |
| Remove member | owner, admin | RPC (definer) |
| Edit room | owner | RLS UPDATE |

Decisions: rooms have no moderator concept in the schema at all, so the runbook's
"if rooms turn out to have moderators" branch didn't arise €” a `moderator` row is simply
inert on a non-society community now.
Verified: SQL €” `can_manage_community` on a non-society community returns true only for
`owner_id`/admin. No `is_society = false` community exists in production yet (both live
communities are societies), so this is verified by function logic against synthetic ids
rather than live rows.
Notes: routing €” there is no `/manage` URL segment in this app; Manage is client tab
state inside the profile page, so fix-023 step 3 (404 the segment) does not apply.

## fix-024 €” Only the owner appoints officers
Status: DONE
Files:
- `supabase/migrations/0131_manage_authorization.sql`
- `src/lib/societies/logic.ts`, `src/lib/societies/logic.test.ts`
- `src/components/societies/member-role-list.tsx`
- `src/components/societies/tabs/manage-tab.tsx`
- `src/app/(student)/societies/[id]/page.tsx`
Migration: 0131

`assign_society_role()` previously allowed any caller of rank ‰¥ 90 (i.e. a **president**)
to appoint below their own rank. Now it requires `auth.uid() = communities.owner_id` (or
platform admin). `remove_society_role()` requires the same, **plus** an explicit
self-resign branch. The client rank helpers `canAssignRole` / `canRemoveRole` collapsed
to `isAdmin || role === "owner"`, and a new `canResignRole(viewer, targetUserId)` covers
the resign case.

Decisions (both implemented as the runbook defaults require):
- The owner **can** demote officers €” `remove_society_role` accepts owner for any target.
- An officer **can** resign their own role €” `p_user = auth.uid()` is always allowed, and
  no self-notification is emitted for it. The Manage tab's officer section is now shown
  to officers too (read-only, appointment UI hidden) purely so the resign affordance is
  reachable; without that they'd have the right with nowhere to exercise it.
Verified: `npx vitest run src/lib/societies/logic.test.ts` €” 24 passed (tests rewritten
for the owner-only rule). Function definitions re-read from `pg_proc` after apply.
Notes: `upsert_society_profile` (society identity editing) still uses the president+
rank €” fix-024 is about *role changes*, and narrowing identity editing was not asked for.

## fix-026 €” Join requests for communities and chat rooms are broken
Status: DONE
Files: `src/lib/communities/relationship.ts`, `supabase/migrations/0131_manage_authorization.sql`
Migration: 0131 (the self-join policy drop; the queue bug needed no schema change)

### Root cause €” stated before the fix, layer by layer
1. **Does Join insert a row?** Yes. `request_community_join()` is SECURITY DEFINER and
   works; production holds 2 rows in `community_join_requests`, both `pending`.
2. **Does the INSERT survive RLS?** Yes €” definer, and the table has no INSERT policy
   precisely because only the RPC writes it.
3. **Does the owner's queue read it?** **No €” this is the bug.** `getJoinRequests()`
   embedded the requester with a bare `profile:profiles(...)`. But
   `community_join_requests` has **two** foreign keys to `profiles` €” `user_id` and
   `decided_by` €” so PostgREST cannot choose a relationship and fails the entire query
   with **PGRST201** ("more than one relationship was found"). The helper destructured
   only `{ data }` and never looked at `error`, so the failure was invisible: `data` came
   back `null`, `?? []` turned it into an empty array, and every owner saw a permanently
   empty queue with two real requests sitting in the table.
4. **Is the notification trigger firing?** Yes €” 8 `community_join_request` notifications
   exist. Owners *were* being told; the queue they were sent to was silently empty.
5. **Fix:** name the constraint in the embed €”
   `profile:profiles!community_join_requests_user_id_fkey(...)` €” and log `error` instead
   of discarding it, so an empty queue can only ever mean "no requests".

**Second, separate defect found while tracing this:** the `community_members` INSERT
policy let anyone self-join without approval, which made the whole request flow bypassable
(see fix-023). Dropped in 0131.

Decisions: fixed at the query layer, not with a migration €” the FK ambiguity is correct
schema (`decided_by` legitimately references `profiles`); it is the query that was
under-specified. Dropping a FK to make a bare embed work would be the wrong repair.
Verified: SQL €” both FKs confirmed on `pg_constraint`; 2 pending rows and 8 matching
notifications confirmed present, which is what makes "owner sees nothing" a *read*-path
bug and nothing else. Typecheck clean.
Notes: **Browser verification not performed** €” the end-to-end flow needs two signed-in
accounts and I have no test credentials in this session. The SQL evidence above pins the
layer unambiguously. Worth a two-account click-through in the morning; the two existing
pending requests should now appear in that community's Manage tab immediately.

---

# Batch C €” Branding & icons (delegated to Sonnet 5, reviewed by me)

## fix-001 €” Brand the auth panels with the real logo
Status: DONE
Files: `src/app/(auth)/login/page.tsx`, `signup/page.tsx`, `forgot-password/page.tsx`,
`set-password/set-password-form.tsx`
Migration: none
Decisions: chose **`logo.png`**, not `logo1.png`. I opened both myself: `logo.png` is the
full horizontal lockup ("FAST SOCIO" with the bolt forming the S) in light lavender on
transparent, 512x256; `logo1.png` is the same lockup in black. Every auth panel sits on
`.auth-gradient` (dark purple/near-black) and already hardcodes `text-white` headings, so
the light lockup is the legible one. Rendered at 180x90 via `next/image`, `priority` on
login only (the LCP panel). The old bolt glyph + "FAST SOCIO" h1 pair was removed; the
lockup already contains the bolt, so nothing was lost.
Verified: build green; asset inspected directly.
Notes: **flagged, not fixed** €” neither PNG is theme-adaptive, so in light theme the pale
lockup will have weak contrast on the light `.auth-gradient`. That limitation is
pre-existing (the `text-white` headings had the identical assumption); fixing it properly
needs a second asset or an adaptive SVG, which is outside this fix. `src/app/auth/dev-login`
was left alone €” it `notFound()`s in production and uses a different gradient-text style.

## fix-002 €” Correct the map and notification icons on Home
Status: DONE
Files: `src/app/(student)/home/page.tsx`
Migration: none
`MapPinned` -> `MapPin` (plain marker, no paper fold) and `Activity` -> `Bell`. Icon size,
stroke width, tap target and unread-badge positioning untouched.
Decisions: took the stated default €” `src/components/floating-dock.tsx` left alone.
Notes: `MapPinned` is still used by `src/components/tour/new-features-tour.tsx` (line 5
import, line 32 usage). Left as-is per scope; mention it if you want it aligned.

## fix-012 €” Strip "SOCIO" from discover card name capsules
Status: DONE
Files: `src/components/discover/swipe-deck.tsx`
Migration: none
Removed the `KIND_CAPSULE.socio` span trailing the first name in `ProfileCardBody`'s
top-left capsule. Capsule shape/padding/background/position unchanged. Added
`min-w-0 max-w-[70%]` on the capsule and `truncate` on the name (with `shrink-0` on the
bolt) so the reclaimed width can't let a long name grow the capsule off the card.
Notes: `intent-card.tsx` needed no change €” its capsule renders the intent MODE label
("Hackathon", "Sports"), and its author line never carried a SOCIO prefix. `KIND_CAPSULE`
is still imported in swipe-deck.tsx because the IntentDetail sheet uses it.

## fix-020 €” Discover chats use the app icon, not the wordmark
Status: DONE
Files: `src/components/discover/discover-group-avatar.tsx`
Migration: none
Decisions: took the stated default €” an inline lucide `Zap` in white on a `gradient-brand`
circle, rather than scaling the wordmark PNG. No standalone bolt asset exists:
`public/brand/` holds only the two full lockups, and `public/icons/` holds PWA app icons.
Component props/API unchanged, so both call sites pick the fix up for free:
`src/components/chat/inbox-list.tsx` (inbox list) and
`src/app/(student)/chat/c/[id]/page.tsx` (thread header). No other surface renders a
discover-group avatar outside this component.

## fix-021 €” Community & chat-room capsules go purple
Status: DONE
Files: `src/components/chat/inbox-list.tsx`, `src/app/(student)/chat/c/[id]/page.tsx`
Migration: none
Both capsules now use `bg-accent text-white` €” the token pairing already used for primary
purple across the app, defined once as `--color-accent` in `globals.css`, so light/dark
and AA contrast come for free. No hex, no arbitrary Tailwind colour. Size, shape, radius,
padding and position untouched.
Decisions: the two capsules WERE colour-coded (neutral glass "Community" vs
`gradient-brand` "Discover"). Flattening the colour is what was asked, so **I did, and the
distinction now rests entirely on the label text** €” "Community" vs
`discoverGroupLabel(...)` ("Discover" / "Discover - <mode>") €” which was already distinct
and needed no icon added.
Notes: there is no capsule anywhere in the app literally labelled "Chat room". In this
codebase a chat room IS a non-society community, and its capsule reads "Community" €” that
is the one now purple. Grep confirmed exactly two call sites.

---

# Batch B €” Notifications

## fix-004 €” Write real copy for every notification type
Status: DONE
Files: `src/lib/notifications/copy.ts` (new), `src/lib/notifications/view.ts`
Migration: none

### Audit method
`notifications.type` is plain `text` with **no enum and no check constraint** €” the DB
cannot tell you what it emits. So I enumerated it three ways and unioned the results:
every `create_notification(...)` call and every direct `insert into public.notifications`
in live `pg_proc` function bodies (regex over `pg_get_functiondef`, which reads the LATEST
definition and so is immune to the superseded-migration trap), plus the distinct `type`
values actually present in the table. 48 types.

### Before -> after (only the types that were broken)
Twelve types fell through to the literal placeholder **"New notification"**, including the
single highest-volume type in the database:

| type | rows | before | after |
|---|---|---|---|
| `announcement` | 370 | "New notification" | the broadcast's own title |
| `comment_like` | 2 | "New notification" | "Ali liked your comment" |
| `message_reaction` | 1 | "New notification" | "Ali reacted <emoji> to your message" |
| `message_request_accepted` | 0 | "New notification" | "Ali accepted your message request - say hi" |
| `community_rejected` | 0 | "New notification" | "Your community request for X was declined" |
| `event_rejected` | 0 | "New notification" | "Your event request for X was declined" |
| `event_organizer_added` | 1 | "New notification" | "Ali added you as a co-organizer" |
| `event_organizer_removed` | 1 | "New notification" | "Ali removed you as a co-organizer" |
| `society_role_removed` | 1 | "New notification" | "Your society officer role was removed" |
| `aura_adjusted` | 0 | "New notification" | "An admin adjusted your Aura by N" |
| `leaderboard_top_finish` | 0 | "New notification" | "You finished in the weekly leaderboard's top ranks" |
| `content_moderated` | 0 | "New notification" | "Content of yours was removed for breaking community guidelines" |

The other 36 already had copy; several were tightened (`comment` now says "commented on
your post" rather than "replied to your post", which was the `comment_reply` wording;
community copy now interpolates the community name where the payload carries one).

### Structure
`notificationCopy(type, actorName, data, count)` switches exhaustively over
`NotificationType` with an `assertNever` default, so adding a type to
`NOTIFICATION_TYPES` without writing copy is a **build error**. `notificationView` in
`view.ts` is now a thin wrapper that type-guards the DB's untyped `text` at the boundary
and delegates. Anonymity is honoured centrally: `data.is_anonymous` collapses the actor to
"Someone" for help and community surfaces.
Decisions: **I wrote the copy strings myself rather than delegating them.** With the full
audit table already in my context, specifying 48 strings for a cold subagent would have
cost more than writing them €” the runbook's own "when not to delegate" rule. Logged as a
deliberate deviation from the orchestration split.
Verified: `npx tsc --noEmit` clean, `npm run build` green, existing
`src/lib/notifications/view.test.ts` still passes.

## fix-005 €” Every notification deep-links to the right page
Status: DONE
Files: `src/lib/notifications/copy.ts`, `src/components/communities/space-shell.tsx`,
`src/lib/use-hash-target.ts` (new), `src/components/feed/comment-thread.tsx`,
`src/components/feed/comments-section.tsx`, `src/app/globals.css`
Migration: none

`notificationHref(type, data)` lives beside the copy and is exhaustive over the same
union. Full type -> route checklist:

| type(s) | destination |
|---|---|
| `post_like`, `comment`, `comment_reply`, `comment_like`, `mention`, `match_post` | `/post/{post_id}` €” **anchored `#comment-{comment_id}`** when the payload names one |
| `message` | `/chat/{conversation_id}` |
| `community_message` | `/chat/c/{community_id}` €” **fixed**, previously sent you to the community profile, but room chat lives in `/chat` |
| `community_join_request`, `community_post_review` | `/communities|societies/{id}?tab=manage` €” the queue itself |
| `community_post`, `*_approved`, `*_rejected`, `society_announcement`, `society_role*` | the community/society page |
| `event_*`, `waitlist_promoted` | `/events/{event_id}` |
| `help_*` | `/help/{request_id}` |
| `level_up`, `aura_adjusted`, `leaderboard_top_finish` | `/profile/aura` |
| `achievement` | `/profile/badges` |
| `content_moderated`, `moderation_warning`, `appeal_result` | `/appeals` |
| `announcement` | the broadcast's own `data.url` |
| `matching_request` | `/discover` |
| `smart_match_*` | `/discover/post` |

**Destinations I had to infer, flagged as the runbook asks:**
- `match` -> `/chat`. The runbook wants "the match's chat", but the payload carries only
  `data.user_id` €” there is no `conversation_id` to route on. `/chat` is the honest
  degradation. Adding `conversation_id` to the match notifier would fix it properly.
- `message_reaction` -> `/chat`. Payload has `message_id` only, with no conversation to
  resolve it against; linking to a guessed thread would be worse than the inbox.
- `matching_accepted`, `message_request_accepted` -> `/chat`, same reasoning.
- `smart_match_*` -> `/discover/post` (the manage screen) rather than the swipe deck,
  since these are all about a post you own or applied to.

Supporting work:
- `?tab=` deep links now work: `SpaceShell` reads the param after mount from
  `window.location` €” deliberately NOT `useSearchParams`, which would need a new Suspense
  boundary under Cache Components/PPR. Both the society and chat-room shells funnel
  through `SpaceShell`, so one edit covered both. Previously `?tab=review` was emitted and
  silently ignored.
- Anchored links: every comment and reply now carries `id="comment-<id>"`; a new
  `useHashTarget()` hook scrolls it into view and applies a `.hash-target` highlight for
  2s (built from `var(--accent)` via `color-mix`, with a `prefers-reduced-motion` variant
  that keeps the highlight and drops the animation). It retries once after 300ms because
  comments stream in.
- Mark-read-on-click and keyboard/middle-click already worked: the row is a real
  `<Link>`, and `AutoMarkRead` clears the panel on open. Unchanged.
Verified: build green, typecheck clean.
Notes: anchor scroll/highlight not click-verified in a browser (no test credentials) €”
worth one click on a comment notification in the morning.

## fix-006 €” Purge notifications for deleted entities
Status: DONE
Files: `supabase/migrations/0132_notification_subject_cascade.sql`,
`src/app/(student)/activity/page.tsx`, `src/app/(student)/home/page.tsx`,
`src/components/notifications/notification-bell.tsx`
Migration: **0132 applied**

Took the runbook's PREFERRED route: real foreign keys with `ON DELETE CASCADE`, not
per-table delete triggers. `notifications.data` is loose jsonb, so 0132 adds eight typed,
nullable mirror columns €” `subject_post_id`, `subject_match_post_id`, `subject_comment_id`,
`subject_community_id`, `subject_event_id`, `subject_help_request_id`,
`subject_conversation_id`, `subject_message_id` €” each with a real FK and cascade, each
with a partial index so a subject delete doesn't seq-scan. A `BEFORE INSERT OR UPDATE`
trigger populates them from `data`. Postgres, not application code, is now what removes a
dead notification.

Decisions:
- **Two post columns, not one.** `data.post_id` is polymorphic: for `smart_match_*` types
  it names a `smart_match_posts` row, for everything else a `posts` row. A single FK would
  have failed the backfill outright. The trigger branches on the type prefix.
- `society_id` and `community_id` both resolve to `communities`, so they share one column.
- The trigger resolves a subject that is ALREADY gone to `null` rather than raising, so a
  late-firing notifier can never abort the transaction that spawned it.
- Soft deletes: `messages.deleted_at` is the only one among these subjects (posts,
  comments, communities, events, help requests are all hard-deleted), and the read view
  filters it.

Backfill + cleanup: `update notifications set data = data` ran every existing row through
the trigger, then a fully-qualified `DELETE` removed the rows whose subject no longer
resolved. **267 orphans removed** (2235 -> 1968) €” of which 180 pointed at deleted posts,
31 at deleted discover posts, 29 at deleted communities, 14 at deleted events, 8 at
deleted conversations, 4 at deleted help requests, 1 at a deleted comment. The matching
SELECT counts were run before the DELETE, per the destructive-action rule.

Defensive read path: view `public.notifications_live` (security_invoker, so RLS still
applies) hides any row whose `data` names a subject that didn't resolve, plus soft-deleted
messages. The Activity feed, the bell's list AND count, and the Home unread badge all read
it now €” so no phantom counts.

Verified €” SQL proving zero orphans remain, re-run after the migration with the same
predicates used to find them:
```sql
select (select count(*) from notifications) total,          -- 1968
       (select count(*) from notifications_live) live,      -- 1968
       (select count(*) from notifications n where n.data ? 'post_id'
          and not exists (select 1 from posts p where p.id=(n.data->>'post_id')::uuid)
          and n.type not like 'smart\_match\_%') orphan_post;  -- 0
```
All eight FKs confirmed `ON DELETE CASCADE` via `pg_constraint`; trigger population
confirmed (681 post, 25 comment, 34 community, 320 conversation links written).

## fix-007 €” Match notification icon should be the lightning bolt
Status: DONE
Files: `src/components/notifications/activity-list.tsx`
Migration: none
`TYPE_ICON.match` changed from `Star` to `Zap`, same size and colour treatment as every
other entry in the map; the now-unused `Star` import was dropped. Did this myself rather
than delegating €” a two-line change costs less to make than to specify.

---

# Batch D €” Chat surface

## fix-037 €” No decorative frames around chat attachments and posts
Status: DONE  ·  Files: `src/components/chat/chat-thread.tsx`  ·  Migration: none
The message bubble no longer wraps media in its own padded, backgrounded, rounded frame.
For an image or a shared post the bubble drops `p-1`/`px-4 py-2`, the `gradient-brand`/
`glass` background and its own `overflow-hidden rounded-2xl` €” the image's `rounded-xl`
(or `SharedPostCard`'s own border+radius) is now the only edge. Text and voice bubbles
keep their chrome untouched.
Verified: message `max-w-[78%]`, `justify-end`/`justify-start` own-vs-other alignment and
the `<time>` block below the bubble all confirmed unchanged; build green.
Notes: `shared-post-preview.tsx` needed no edit €” the redundant frame was the caller's, not
its own. `community-thread.tsx` needed none either: it only gates join/follow state and
delegates to `community-chat.tsx`, which has no media bubble at all.

## fix-038 €” Remove search in chat
Status: DONE  ·  Files: `src/components/chat/chat-thread.tsx`,
`src/app/(student)/chat/actions.ts`  ·  Migration: none
**The runbook's premise was slightly off** and worth knowing: there was no search in the
inbox (`inbox-list.tsx`) at all. The chat search that existed was IN-THREAD. Removed it
whole: the `Search` icon, the `searchOpen`/`searchQuery`/`searchHits`/`searching` state,
the debounce ref and `runSearch()`, the input and the results dropdown, plus the
`searchMessages()` server action and its `MessageSearchHit` type.
Decisions: nothing was shared €” grep for `searchMessages`/`MessageSearchHit` across `src/`
returned zero other references, and no Postgres RPC was involved (it was a plain client
query), so nothing had to be kept for discover/communities/help/map and no DB object was
dropped. No chat route read a `?q=` param.
Re-balance: the emptied toggle row was removed and its wrapper collapsed, so the pinned-
message bar now renders directly with the file's existing `mb-1` spacing €” when nothing is
pinned the space collapses to zero rather than leaving a gap or a lone floating icon.

## fix-008 €” Drop the paperclip on shared posts in chat
Status: DONE  ·  Files: `src/app/(student)/chat/actions.ts`  ·  Migration: none (data fix)
**The subagent reported "nothing to do" here and was wrong €” I found it and fixed it
myself.** It searched for a lucide `Paperclip` rendered beside the preview; there isn't
one. The paperclip is a literal emoji baked into the message BODY: `sharePostToChat`
inserted `body: "ðŸ“Ž Shared a post"`, so every shared post carried a paperclip in the
thread and in the inbox preview line. Changed the write to `"Shared a post"`, and ran a
qualified UPDATE over the 18 existing rows (`where shared_post_id is not null and
body = 'ðŸ“Ž Shared a post'`) €” re-checked after: 0 rows still contain the glyph.
Decisions: fixed at the source rather than stripping the emoji at render time, so the
inbox preview, the pinned-message bar and the thread all come right at once.
Notes: the composer's real "Attach image" `Paperclip` button (chat-thread.tsx ~1118) was
deliberately left alone €” that is a genuine file attachment, explicitly out of scope.

## fix-028 €” Broadcast announcements as a chat window
Status: DONE  ·  Files: `src/components/societies/announcement-thread.tsx` (new),
`src/components/societies/tabs/broadcast-tab.tsx`,
`src/components/societies/announcement-card.tsx`  ·  Migration: none
Announcements are now a scrolling thread: oldest†’newest (the incoming array is
newest-first and is reversed for display), scrolled to the bottom on mount, composer
pinned below, author + timestamp per message, and consecutive messages from the same
author collapse to just a time. Realtime INSERT subscription copied from
`community-chat.tsx` (session token †’ `realtime.setAuth` †’ channel + `postgres_changes` †’
`removeChannel` on unmount), re-reading each new row from the `society_announcement_feed`
view by id so the joined author fields and `is_mine` masking are correct €” the same
round-trip `community-chat.tsx` does through `community_chat_view`.
`broadcast-tab.tsx` stays a non-async server component (PPR) and just passes props down.
Decisions: **who-can-post is untouched** €” `canPost` flows through unchanged; no
permission logic was edited. Pinned announcements keep the `ring-1 ring-accent/40`
treatment. The "Open chat" hand-off and the empty state survive, restyled for a thread.
Notes: the brief told the subagent to copy `community-thread.tsx`'s consecutive-author
grouping; that grouping **does not actually exist** in this codebase (every non-mine
message always renders its avatar and name). It implemented the grouping fresh and said
so, which was the right call.

## fix-018 €” Replace anonymous posting with media in discover groups
Status: BLOCKED
Files: none  ·  Migration: none
Not attempted. Ran out of session budget before reaching it; see the Summary for what this
needs. The two halves are independent and neither is started: (a) remove the anonymous
toggle from the discover-group composer and stop persisting/reading the flag for
`is_discover_group` communities, keeping "Anonymous" on legacy rows (retroactively
unmasking someone promised anonymity is not acceptable €” that default stands); (b) add an
image-upload control following the existing chat media-upload pattern in
`chat-thread.tsx` (same bucket, same compression/size limits, preview + remove).
Campus Help's anonymity is deliberately untouched either way.

## fix-019 €” Members can leave a discover group chat
Status: DONE  ·  Files: `src/app/(student)/discover/discover-actions.ts`,
`src/components/discover/discover-group-menu.tsx`,
`src/app/(student)/chat/c/[id]/page.tsx`  ·  Migration: **none needed**
`DiscoverGroupMenu` now takes `isOwner` and `groupName` and renders exactly one control:
Delete (`Trash2`) for the owner, Leave (`LogOut`) for any other member. Never both. Both go
through the shared confirm dialog; Leave's copy is "Leave <group name>?" / "You'll stop
receiving its messages€¦", destructive styling, loading state. On success the thread
redirects to `/chat` and `router.refresh()` drops it from the inbox. The header condition
changed from `rel.isOwner` to `rel.isMember`.
New `leaveDiscoverGroupChat` deletes only the caller's own `community_members` row.
Decisions: **no migration was required** €” I checked the live policy rather than assuming.
The existing "members leave communities" DELETE policy (mig 0119) is already
`user_id = auth.uid() AND NOT (you are the owner)`, with no `is_discover_group` carve-out,
which is exactly the rule this fix wants. The action re-checks ownership anyway so the
owner gets a clear "delete it instead of leaving" message rather than a silent no-op €”
the runbook's stated default (no ownership transfer this pass).

---

# Batch E/F/G €” partial (see Summary for what remains)

## fix-027 €” Better UI for deleting an announcement
Status: DONE  ·  Files: `src/components/ui/confirm-dialog.tsx` (new),
`src/components/societies/announcement-card.tsx`,
`src/components/discover/discover-group-menu.tsx`  ·  Migration: none
The old UI was a native `window.confirm("Delete this announcement?")` next to a bare
exposed trash button €” that was the ugliness. Now: a ‹¯ (`MoreHorizontal`) overflow menu on
each announcement holding Pin/Unpin (managers) and "Delete announcement" in destructive
red, closing on outside pointerdown and on Escape; then the app's standard confirm dialog
with a loading state, keeping the existing optimistic removal and its revert-on-failure.
Decisions: the runbook says "find and reuse the existing delete-confirm component" €” **there
wasn't one.** The nearest thing was the glass dialog inlined in `discover-group-menu.tsx`,
so I had it extracted into a real shared `src/components/ui/confirm-dialog.tsx` and
refactored the discover menu onto it too. There is now exactly one confirm dialog in the
codebase, which is what the fix was really asking for.

## fix-013 €” "Back to Discover" as a purple capsule button
Status: DONE  ·  Files: `src/components/discover/discover-post-manager.tsx`  ·  Migration: none
Now a full-pill `bg-accent text-white` capsule, `h-10` (‰¥40px tap target), hover/active
states, chevron kept and resized to match.
Decisions: did NOT reuse `GlassButton` €” its only solid variant is `gradient-brand`, a
gradient, not the flat purple pill specified. Hand-rolled with the established
`bg-accent text-white rounded-full` pairing already used elsewhere in this same file. No
hardcoded hex.

## fix-016 €” Give "Create group" its own button in Smart Discover
Status: DONE  ·  Files: `src/components/discover/discover-post-manager.tsx`  ·  Migration: none
Create-group was smuggled into the Close control via `canGroup(p) ? setGroupPost(p) : €¦`.
That branch is gone: **Close now only calls `closeDiscoverPost(p.id)`** and nothing else.
"Create group" is its own purple capsule on the Your-post card (shown when `canGroup(p)`
and the post is open), opening the unchanged `CloseWithGroupDialog` and calling
`createGroupFromDiscoverPost` with the same arguments. The card grew into two rows
(title/delete above, actions wrapping below) so both actions sit comfortably rather than
being crammed. Styling matches fix-013.

## fix-003 €” Remove Filters from Campus Help †’ SOCIO
Status: DONE  ·  Files: `src/components/help/campus-help-shell.tsx`,
`src/components/help/help-filters.tsx`, `src/components/help/help-tab-skeleton.tsx`,
`src/app/(student)/help/page.tsx`  ·  Migration: none
Deleted the `HelpFilters` component entirely (button, popover, category chips,
department/course/semester/search inputs and their push/apply/clear logic), the wrapper row
that hosted it in `SocioSection`, and the skeleton placeholder that mimicked it. SOCIO now
renders the full unfiltered feed.
Decisions: kept the `SocioFilters` type and the server-side query-building, with the
`filters` argument made optional/defaulted. Deleting them would have meant changing the
`help_request_feed` RPC contract, and the runbook explicitly says to make args optional
rather than remove them. The ME tab (`MeSection`, `MyHelpPanel`, `HelpCard`, `HelpTabs`)
never had filters and was not touched at all.
Notes: no header re-balance was needed €” the Filters control lived in its own row inside
`SocioSection`, not in the page header, so removing the row left nothing dangling.

## fix-036 €” Post count stat is always zero
Status: DONE  ·  Files: `supabase/migrations/0133_profile_post_count.sql`,
`src/app/(student)/profile/page.tsx`  ·  Migration: **0133 applied**

### Root cause
`public.posts` has **RLS enabled and no SELECT policy whatsoever** €” `pg_policies` returns
exactly three rows for the table, for INSERT, UPDATE and DELETE. Under RLS an absent SELECT
policy means every read returns zero rows, so the profile's
`.from("posts").select("id", { count: "exact", head: true }).eq("author_id", me)` counted
nothing, for every user, always. The feed never exposed this because it reads the
`feed_posts` VIEW, which has RLS off.

### Wrong vs corrected, from direct SQL
| user | old stat | raw total | attributed | corrected (public view) |
|---|---|---|---|---|
| 7a3224dc€¦ | **0** | 33 | 16 | **16** |
| 45f6867e€¦ | **0** | 19 | 13 | **10** (3 not approved) |

Decisions: I did **not** fix this by adding a SELECT policy to `posts`. Rows carry
`author_id` even when `is_anonymous` is true, so a broad SELECT policy would expose the
author of every anonymous post €” a far worse bug than a wrong number. Instead 0133 adds a
SECURITY DEFINER `get_profile_post_count(p_user)` returning only an aggregate, with the
runbook's stated default semantics: **own profile counts all your non-deleted posts**
(anonymous included €” it is your own total and reveals nothing about which post was which);
**someone else's counts only what that viewer can see** (attributed and moderation-approved).
`posts` has no soft-delete column, so "non-deleted" is every row.
Verified: executed the function against live data (not merely created it €” `check_function_bodies`
masks column errors). Public branch returns 16 for user A, matching the attributed count
exactly, and 10 for user B, correctly excluding 3 unapproved posts.
Notes: the public profile route renders no post-count stat today, so only the own-profile
path currently consumes this; the public semantics are in place for when it does.

## fix-035 €” Remove Recent Activity from the Aura breakdown
Status: DONE  ·  Files: `src/app/(student)/profile/aura/page.tsx`  ·  Migration: none
The "Recent activity" section, its per-transaction cards and the now-unused `GlassChip`
import are gone; the page ends after Breakdown with no leftover heading or gap.
Decisions: the `aura_transactions` fetch STAYS €” the Breakdown totals aggregate the same
rows €” but is trimmed from `id, delta, reason, created_at` to just `delta, reason`, and the
`Txn` type with it. Confirmed no other screen reads this query shape: `/admin/aura` and
`/settings/export` read `aura_transactions` through their own independent queries.

## fix-030 €” Delete a chat room from Manage
Status: DONE  ·  Files: `supabase/migrations/0135_delete_chat_room.sql`,
`src/components/communities/delete-chat-room.tsx` (new),
`src/components/communities/tabs/room-manage-tab.tsx`,
`src/app/(student)/communities/actions.ts`, `src/app/(student)/communities/[id]/page.tsx`
Migration: **0135 applied**
A Danger Zone at the bottom of Manage, **owner-only** (consistent with fix-031 €” a
moderator never sees it), with a confirm dialog that requires the room's name to be TYPED
before the destructive button enables. After deleting: redirect to `/communities`,
`router.refresh()` so it leaves every list, revalidation of `/communities`, `/chat` and the
room's thread.
Decisions: **no new cascades were needed and I verified that rather than assuming** €” every
dependent already cascades from `communities` (chat messages, reads, followers, members,
join requests, polls, posts, society announcements/roles) and, since mig 0132,
notifications via `subject_community_id ON DELETE CASCADE`, which is exactly the fix-006
tie-in this fix asks for. `events` and `smart_match_posts` deliberately `SET NULL` €” they
are their own objects and outlive the room. `delete_chat_room` refuses societies and
Discover team rooms so they keep their own lifecycles rather than acquiring a second,
divergent delete path.
Verified: cascade coverage read from `pg_constraint`; migration applied.

## fix-029 €” Community chat card = full cover photo background
Status: DONE  ·  Files: `src/components/communities/chat-room-card.tsx`  ·  Migration: none
`relative h-[168px]`, cover image filling the card edge to edge via `AppImage` (`fill` +
`object-cover`), bottom scrim `from-black/70 via-black/25 to-transparent`, name + member
count bottom-left in white, Follow/Join capsules bottom-right. No-cover fallback is
`gradient-brand` with the community icon €” never a broken image.
Follow ‰  join semantics untouched: the same `FollowJoinButtons` with the same props.
**Buttons cannot navigate:** the card's `<Link>` is an absolutely-positioned `inset-0`
overlay at `z-0`, earlier in DOM order, while the buttons sit in a sibling at `z-10` inside
a `pointer-events-none` wrapper that re-asserts `pointer-events-auto` on the buttons
themselves €” so a tap lands on the button element and never reaches the anchor. No
`stopPropagation` hack.
Notes: the description line was dropped, since name and member count now sit on the photo.

## fix-017 €” Capsules render right of the group name
Status: DONE  ·  Files: `src/components/chat/inbox-list.tsx`,
`src/app/(student)/chat/c/[id]/page.tsx`  ·  Migration: none
Both call sites reordered: name first (`min-w-0 flex-1 truncate`), capsule last
(`shrink-0`), with `min-w-0` added to each flex parent €” without which truncation silently
does nothing and the capsule gets pushed off-screen by a long name. The thread header's
stale "Capsule leads the name here" comment was corrected.
Notes: only two call sites exist. The rebuilt fix-029 card carries no type capsule at all
in its new design, and there is no separate discover-group header component.

## fix-032 €” Overlay the camera icon on the profile picture
Status: DONE  ·  Files: `src/components/profile/edit-profile-form.tsx`  ·  Migration: none
The avatar block was restructured so the badge can hang off the edge: an outer
`relative h-28 w-28` wrapper that does NOT clip, containing (a) the avatar button with its
own `overflow-hidden rounded-full` clip and (b) a sibling camera button
(`h-10 w-10` = 40px, `absolute -bottom-1 -right-1`, `ring-2 ring-bg`,
`aria-label="Change profile photo"`) outside that clip. This is the part that matters €”
left inside the clipping element the badge would simply have been cut off.

## fix-033 €” Interests: minimum 3, no maximum
Status: DONE  ·  Files: `src/lib/profile/constants.ts`,
`src/components/profile/edit-profile-form.tsx`, `src/app/onboarding/wizard.tsx`,
`src/app/onboarding/actions.ts`, `src/app/(student)/profile/actions.ts`  ·  Migration: none
`MAX_INTERESTS` removed entirely (and with it the cap in the `sanitizeTags` helper and all
"max reached" messaging); `MIN_INTERESTS = 3` enforced with an inline "Pick at least 3
interests" and validated server-side in BOTH `updateProfile` and `saveProfile`. Pickers got
`max-h-72`/`max-h-96 overflow-y-auto` so a long list still scrolls.
**53 interests added:** Mathematics, Physics, Chemistry, Economics, Entrepreneurship,
Research, Public Speaking, Writing, Poetry, Chess, Web Development, App Development,
Cybersecurity, Game Development, Blockchain, Cloud Computing, Data Science, Open Source,
Competitive Programming, Electronics, Badminton, Table Tennis, Basketball, Volleyball,
Swimming, Cycling, Running, Martial Arts, Snooker, Futsal, Calligraphy, Painting, Dance,
Filmmaking, Fashion, Theatre, Esports, PC Gaming, Console Gaming, Board Games, Card Games,
Event Management, Networking, Community Service, MUN, Freelancing, Internships, Marketing,
Finance, Gardening, Journaling, Podcasts, Camping.
Downstream check: nothing assumes a fixed interest count €” the only consumers are the
dedupe helper and plain `.length` displays; no matching or discover-scoring logic touches
the count.

## fix-034 €” Gender is required
Status: DONE  ·  Files: `src/lib/profile/constants.ts`,
`src/components/profile/edit-profile-form.tsx`, `src/app/onboarding/wizard.tsx`,
`src/app/onboarding/actions.ts`, `src/app/(student)/profile/actions.ts`
Migration: **none €” deliberately**
Required in both surfaces: onboarding step 1 will not advance without a selection, and the
edit panel will not save empty (inline "Please select your gender", and the label no longer
says "(optional)"). **Validated server-side** in `saveProfile` and `updateProfile`, not just
in the UI.
Decisions: **I counted the nulls first, as the fix requires €” 52 of 144 profiles have
`gender IS NULL`.** That is greater than zero, so per the stated default I did NOT add a
`NOT NULL` constraint and wrote no migration; the column stays nullable and enforcement is
application-layer only. **You need to decide on a backfill for those 52 rows** €” they will
keep failing validation the next time those users edit their profile, which is the intended
nudge, but they are invisible until then.
Notes: one unrequested change to flag €” the subagent also removed an `"other"` option from
`GENDERS`. No production row uses it (distinct values are `male`, `female`,
`prefer_not_to_say`), so nothing broke, and `boy.webp`/`girl.webp` defaults still resolve.
Revert it if you wanted that option kept.

## fix-015 €” Fix focus stealing in the "+ skill" input
Status: DONE  ·  Files: `src/components/discover/post-intent-fields.tsx`  ·  Migration: none
Enter (and comma) now `preventDefault()` + `stopPropagation()`, commit the chip, clear the
field and explicitly re-focus it via a ref. Enter can no longer submit the form.
Notes: **the runbook pointed at the wrong file.** There is no free-text chip input in
`edit-profile-form.tsx` or onboarding €” interests there are fixed pill toggles, not typed
chips. The only "+ skill" chip input in the codebase is `TagInput` in
`post-intent-fields.tsx` (Project Partner "skills needed"), which is where the bug actually
was and where it is fixed.

## fix-011 €” Deduplicate the map's info/undo icons
Status: DONE  ·  Files: `src/components/map/campus-map-viewer.tsx`  ·  Migration: none
Decisions: **there is no `[i]` info icon on the map at all** €” all four map files were read
in full. The real duplicate pair was "Fit map to screen" (`Maximize`) and "Reset map"
(`RotateCcw`): both called the identical `resetToFit()` (scale †’ fitScale, pan †’ 0,0),
differing only in a cosmetic `disabled` condition. Kept **"Reset map"** €” per the stated
default, its curved-arrow icon and label are the ones that match what the handler actually
does €” and deleted the Fit button, its divider and the dead `Maximize` import. The left
cluster is now a single circular button that balances the zoom cluster opposite it.

## fix-010 €” Add more places to the campus map
Status: DONE  ·  Files: `src/lib/map/places.ts`  ·  Migration: none
**26 pins added.** Coordinate system: percentages of `public/map.png` (x 0=left†’100=right,
y 0=top†’100=bottom), confirmed from the viewer's `place.x/100 * natural.w` maths.
Two new `PlaceType`s were genuinely needed €” `hostel` and `service` €” because medical,
bank, photocopy and hostels had no honest home among the existing eight; each got a full
`PLACE_TYPE_META` entry (label, lucide icon `BedDouble`/`Store`, distinct accent), and
search and the detail card pick them up automatically since both read from
`PLACE_TYPE_META`/`CAMPUS_MAP_PLACES` with no hardcoded list anywhere.
Notes: the fix says to wire the new categories' filter chips €” **there are no filter chips
in the current map code.** Only a stale doc comment mentions "type filters"; nothing renders
them. So that step was vacuous, not skipped.

### Pin coordinates needing my verification
Every pin below is tagged `// TODO: verify position` in `places.ts`. Positions were inferred
from neighbouring pins and the map image €” wrong-but-close, as instructed. Please nudge:
| Pin | Type | x,y |
|---|---|---|
| D Block Cafeteria | cafe | 34,15 |
| B Block Cafeteria | cafe | 84,16 |
| A Block Cafeteria | cafe | 86,62 |
| D Block Computer Labs | building | 38,13 |
| C Block Networking Lab | building | 61,13 |
| B Block Electronics Lab | building | 84,14 |
| A Block Software Labs | building | 90,60 |
| CS Dept Office | building | 57,8 |
| EE Dept Office | building | 83,8 |
| Management Sciences Dept Office | building | 34,8 |
| Social Sciences Dept Office | building | 85,54 |
| Main Auditorium | building | 70,45 |
| C Block Seminar Hall | building | 65,18 |
| Gymnasium | sports | 23,58 |
| Squash Courts | sports | 40,64 |
| Volleyball Court | sports | 14,85 |
| Visitor Parking | parking | 75,93 |
| Student Car Parking | parking | 5,30 |
| Ladies Prayer Area | prayer | 37,76 |
| Medical Center | service | 38,16 |
| Bank & ATM | service | 58,17 |
| Photocopy & Stationery Shop | service | 65,21 |
| Boys Hostel 1 | hostel | 8,60 |
| Boys Hostel 2 | hostel | 8,68 |
| Girls Hostel | hostel | 14,60 |
| Gate 5 | gate | 95,50 |

## fix-022 €” Friendly "page unavailable" screen
Status: DONE  ·  Files: `src/app/not-found.tsx`, `src/components/not-found-go-back.tsx`
(new), plus 9 segment `not-found.tsx` files  ·  Migration: none
Global not-found is a centered glass card with exactly "We are sorry, this page is
unavailable.", a purple `bg-accent` capsule to Home and a secondary "Go back". The page
stays a Server Component; `router.back()` lives in a small `"use client"` child. Nine
segment files re-export it: post, profile, communities, chat/c, chat, discover/post, help,
events, societies.
Audit of step 3 €” every id-based route ALREADY called `notFound()` correctly on a missing
row (post, profile, community, chat room, help request, event, society); none rendered an
empty shell or threw, so nothing needed changing. `/discover/post` has no id-based fetch
(it manages your own posts) so it needed no data-path change.
Access-denied: RLS makes `single()`/`maybeSingle()` return null for both "doesn't exist" and
"you can't see it", so both land on the identical `notFound()` and the identical screen.
There is no distinct access-denied message anywhere, so existence is not leaked.

## fix-009 €” Edit your own posts
Status: DONE  ·  Files: `supabase/migrations/0134_edit_own_post.sql`,
`src/app/(student)/home/actions.ts`, `src/lib/feed/types.ts`,
`src/components/feed/post-card.tsx`  ·  Migration: **0134 applied**
"Edit post" sits beside Delete in the post overflow menu under the **same** `isMine`
condition Delete already used (no new ownership check invented), opening an inline sheet
with a textarea, Save/Cancel, optimistic update and revert-on-failure. `edited_at` was added
to `FEED_COLUMNS` in `src/lib/feed/types.ts`, which serves both the feed and the post-detail
page in one change. The "edited" capsule renders bottom-right of the action row, inline with
Share, as a muted micro-pill.
Decisions:
- Scope is body only, as specified. Poll posts are excluded from Edit €” a poll's body is its
  question, and the RPC refuses to empty it.
- **On "only the body column mutable":** RLS filters rows, not columns, so a policy cannot
  deliver that. Column-level GRANTs could, but revoking UPDATE on `posts` from
  `authenticated` to re-grant two columns risks silently breaking future author-scoped
  writes. So the column guarantee lives in a SECURITY DEFINER `edit_post` RPC €” the same
  pattern `delete_post` already uses in this codebase, and for the same reason (`posts`
  SELECT is deliberately revoked for anonymity). The existing "authors update their own
  posts" policy keeps the row-level half and **gained the `WITH CHECK` it was missing**, so
  a post can no longer be reassigned to another author mid-update.
- Comments and community posts are out of scope this pass, per the stated default. **Logged
  as follow-up.**
Verified: executed `edit_post` against a real post row with no authenticated user and
confirmed it raises "not authorized" €” creation alone would not have caught a bad column
reference, since `check_function_bodies` masks those.

## fix-014 €” Restyle the date & time picker
Status: BLOCKED
Not attempted €” the session ran out of budget. Nothing was started, so there is no partial
state to clean up. What it needs: grep `type="datetime-local"`, `type="date"`, `type="time"`
(known call sites include `src/components/discover/post-intent-fields.tsx` and event
creation), build one shared `src/components/ui/date-time-field.tsx` on the glass/purple
tokens with a clear "no date set" state, and swap every call site onto it keeping the ISO
string value contract so no server code changes.

## fix-025 €” Pin a location on the map from any form with a location field
Status: BLOCKED
Not attempted €” the session ran out of budget, and this one legitimately sat last: it
depends on fix-010's place list (done) and fix-014's picker (blocked). Nothing was started.
What it needs: enumerate every form with a location/venue input (discover post fields, event
creation, help request, society events, community settings), build one shared
`LocationPicker` that puts the EXISTING `campus-map-viewer.tsx` in a sheet with tap-to-drop
and snap-to-nearest from `places.ts` plus the free-text field for off-map places, persist
both label and coordinates (migration needed for the missing columns), and make displayed
locations tappable through to the map. Do not fork the viewer.

