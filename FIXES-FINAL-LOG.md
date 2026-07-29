# Fixes Final — run log (branch `fixes-final-batch`)

Started 2026-07-29. Summary section will be written at the top when the run ends.

---

# Batch A — Security & broken flows

## fix-023 — Manage tab is owners/moderators only
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

1. `can_manage_community()` — the single authority used by every manage RPC **and**
   the `community_join_requests` SELECT policy — granted management to *anyone with a
   `society_roles` row*, regardless of the role value in it. Presence of the row was
   the whole test.
2. It applied the same rule to casual chat rooms and to societies, so a `moderator`
   `community_members` row would have granted management on a chat room too (fix-031).
3. `moderate_community_post()` didn't consult it at all — it hand-rolled a
   `community_members.role in ('owner','moderator')` check that ignored `owner_id`
   entirely and locked out every society officer.
4. **Live hole:** `community_members` had an INSERT policy
   ("students join approved communities") letting *any authenticated user insert
   themselves as a member of any approved community* via a direct PostgREST call —
   no approval, instant chat access. No application code path used it (grepped every
   `.from("community_members")` call site: all SELECT/DELETE). Dropped.

### Action → who can call it now → enforced at
| Action | Who | Enforced at |
|---|---|---|
| Edit community (name/desc/cover) | owner only | RLS `owners edit their community` + action `.eq("owner_id", uid)` |
| Cover upload | owner only | same UPDATE policy |
| Approve/reject member post | owner, society moderator/officer, admin | RPC `moderate_community_post` → `can_manage_community` (**both**, rewritten in 0131) |
| Read join-request queue | requester, or manager | RLS `requesters and managers read join requests` → `can_manage_community` |
| Approve/reject join request | manager | RPC `decide_community_join_request` (definer, explicit check) |
| Remove member | manager, never another manager | RPC `remove_community_member` (definer, explicit check) |
| Appoint / demote officer | **owner or admin only** | RPC `assign_society_role` / `remove_society_role` (**rewritten in 0131**) |
| Edit society identity | president+ or admin | RPC `upsert_society_profile` (unchanged, mig 0120) |
| Self-join a community | **nobody** — approval only | INSERT policy dropped in 0131 |
| Leave a community | self, not the owner | RLS `members leave communities` |

### Other member-visible surfaces that let a plain member mutate community state
- The dropped self-insert policy was the only one found. Everything else routes
  through a SECURITY DEFINER RPC with an explicit authorization check.

Decisions: (a) `can_manage_community` now branches on `is_society` rather than adding a
second function — one authority is easier to keep honest than two. (b) Post moderation
was *widened* to society officers to match what the Manage tab already shows them; that
is an alignment, not a new hole.
Verified: `can_manage_community` executed against live rows — owner `true`, plain member
`false`, super-admin member `true` (expected). `pg_policies` re-queried: the self-join
INSERT policy is gone; only SELECT + DELETE remain on `community_members`.
Notes: production currently has **zero** `community_members` rows with role `moderator`
and **zero** `society_roles` rows, so narrowing removed no live user's access.

## fix-031 — Chat room Manage restricted to owners
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
| Join-request queue read | owner, admin, requester | RLS → `can_manage_community` |
| Approve/reject join request | owner, admin | RPC (definer) |
| Remove member | owner, admin | RPC (definer) |
| Edit room | owner | RLS UPDATE |

Decisions: rooms have no moderator concept in the schema at all, so the runbook's
"if rooms turn out to have moderators" branch didn't arise — a `moderator` row is simply
inert on a non-society community now.
Verified: SQL — `can_manage_community` on a non-society community returns true only for
`owner_id`/admin. No `is_society = false` community exists in production yet (both live
communities are societies), so this is verified by function logic against synthetic ids
rather than live rows.
Notes: routing — there is no `/manage` URL segment in this app; Manage is client tab
state inside the profile page, so fix-023 step 3 (404 the segment) does not apply.

## fix-024 — Only the owner appoints officers
Status: DONE
Files:
- `supabase/migrations/0131_manage_authorization.sql`
- `src/lib/societies/logic.ts`, `src/lib/societies/logic.test.ts`
- `src/components/societies/member-role-list.tsx`
- `src/components/societies/tabs/manage-tab.tsx`
- `src/app/(student)/societies/[id]/page.tsx`
Migration: 0131

`assign_society_role()` previously allowed any caller of rank ≥ 90 (i.e. a **president**)
to appoint below their own rank. Now it requires `auth.uid() = communities.owner_id` (or
platform admin). `remove_society_role()` requires the same, **plus** an explicit
self-resign branch. The client rank helpers `canAssignRole` / `canRemoveRole` collapsed
to `isAdmin || role === "owner"`, and a new `canResignRole(viewer, targetUserId)` covers
the resign case.

Decisions (both implemented as the runbook defaults require):
- The owner **can** demote officers — `remove_society_role` accepts owner for any target.
- An officer **can** resign their own role — `p_user = auth.uid()` is always allowed, and
  no self-notification is emitted for it. The Manage tab's officer section is now shown
  to officers too (read-only, appointment UI hidden) purely so the resign affordance is
  reachable; without that they'd have the right with nowhere to exercise it.
Verified: `npx vitest run src/lib/societies/logic.test.ts` — 24 passed (tests rewritten
for the owner-only rule). Function definitions re-read from `pg_proc` after apply.
Notes: `upsert_society_profile` (society identity editing) still uses the president+
rank — fix-024 is about *role changes*, and narrowing identity editing was not asked for.

## fix-026 — Join requests for communities and chat rooms are broken
Status: DONE
Files: `src/lib/communities/relationship.ts`, `supabase/migrations/0131_manage_authorization.sql`
Migration: 0131 (the self-join policy drop; the queue bug needed no schema change)

### Root cause — stated before the fix, layer by layer
1. **Does Join insert a row?** Yes. `request_community_join()` is SECURITY DEFINER and
   works; production holds 2 rows in `community_join_requests`, both `pending`.
2. **Does the INSERT survive RLS?** Yes — definer, and the table has no INSERT policy
   precisely because only the RPC writes it.
3. **Does the owner's queue read it?** **No — this is the bug.** `getJoinRequests()`
   embedded the requester with a bare `profile:profiles(...)`. But
   `community_join_requests` has **two** foreign keys to `profiles` — `user_id` and
   `decided_by` — so PostgREST cannot choose a relationship and fails the entire query
   with **PGRST201** ("more than one relationship was found"). The helper destructured
   only `{ data }` and never looked at `error`, so the failure was invisible: `data` came
   back `null`, `?? []` turned it into an empty array, and every owner saw a permanently
   empty queue with two real requests sitting in the table.
4. **Is the notification trigger firing?** Yes — 8 `community_join_request` notifications
   exist. Owners *were* being told; the queue they were sent to was silently empty.
5. **Fix:** name the constraint in the embed —
   `profile:profiles!community_join_requests_user_id_fkey(...)` — and log `error` instead
   of discarding it, so an empty queue can only ever mean "no requests".

**Second, separate defect found while tracing this:** the `community_members` INSERT
policy let anyone self-join without approval, which made the whole request flow bypassable
(see fix-023). Dropped in 0131.

Decisions: fixed at the query layer, not with a migration — the FK ambiguity is correct
schema (`decided_by` legitimately references `profiles`); it is the query that was
under-specified. Dropping a FK to make a bare embed work would be the wrong repair.
Verified: SQL — both FKs confirmed on `pg_constraint`; 2 pending rows and 8 matching
notifications confirmed present, which is what makes "owner sees nothing" a *read*-path
bug and nothing else. Typecheck clean.
Notes: **Browser verification not performed** — the end-to-end flow needs two signed-in
accounts and I have no test credentials in this session. The SQL evidence above pins the
layer unambiguously. Worth a two-account click-through in the morning; the two existing
pending requests should now appear in that community's Manage tab immediately.

---

# Batch C — Branding & icons (delegated to Sonnet 5, reviewed by me)

## fix-001 — Brand the auth panels with the real logo
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
Notes: **flagged, not fixed** — neither PNG is theme-adaptive, so in light theme the pale
lockup will have weak contrast on the light `.auth-gradient`. That limitation is
pre-existing (the `text-white` headings had the identical assumption); fixing it properly
needs a second asset or an adaptive SVG, which is outside this fix. `src/app/auth/dev-login`
was left alone — it `notFound()`s in production and uses a different gradient-text style.

## fix-002 — Correct the map and notification icons on Home
Status: DONE
Files: `src/app/(student)/home/page.tsx`
Migration: none
`MapPinned` -> `MapPin` (plain marker, no paper fold) and `Activity` -> `Bell`. Icon size,
stroke width, tap target and unread-badge positioning untouched.
Decisions: took the stated default — `src/components/floating-dock.tsx` left alone.
Notes: `MapPinned` is still used by `src/components/tour/new-features-tour.tsx` (line 5
import, line 32 usage). Left as-is per scope; mention it if you want it aligned.

## fix-012 — Strip "SOCIO" from discover card name capsules
Status: DONE
Files: `src/components/discover/swipe-deck.tsx`
Migration: none
Removed the `KIND_CAPSULE.socio` span trailing the first name in `ProfileCardBody`'s
top-left capsule. Capsule shape/padding/background/position unchanged. Added
`min-w-0 max-w-[70%]` on the capsule and `truncate` on the name (with `shrink-0` on the
bolt) so the reclaimed width can't let a long name grow the capsule off the card.
Notes: `intent-card.tsx` needed no change — its capsule renders the intent MODE label
("Hackathon", "Sports"), and its author line never carried a SOCIO prefix. `KIND_CAPSULE`
is still imported in swipe-deck.tsx because the IntentDetail sheet uses it.

## fix-020 — Discover chats use the app icon, not the wordmark
Status: DONE
Files: `src/components/discover/discover-group-avatar.tsx`
Migration: none
Decisions: took the stated default — an inline lucide `Zap` in white on a `gradient-brand`
circle, rather than scaling the wordmark PNG. No standalone bolt asset exists:
`public/brand/` holds only the two full lockups, and `public/icons/` holds PWA app icons.
Component props/API unchanged, so both call sites pick the fix up for free:
`src/components/chat/inbox-list.tsx` (inbox list) and
`src/app/(student)/chat/c/[id]/page.tsx` (thread header). No other surface renders a
discover-group avatar outside this component.

## fix-021 — Community & chat-room capsules go purple
Status: DONE
Files: `src/components/chat/inbox-list.tsx`, `src/app/(student)/chat/c/[id]/page.tsx`
Migration: none
Both capsules now use `bg-accent text-white` — the token pairing already used for primary
purple across the app, defined once as `--color-accent` in `globals.css`, so light/dark
and AA contrast come for free. No hex, no arbitrary Tailwind colour. Size, shape, radius,
padding and position untouched.
Decisions: the two capsules WERE colour-coded (neutral glass "Community" vs
`gradient-brand` "Discover"). Flattening the colour is what was asked, so **I did, and the
distinction now rests entirely on the label text** — "Community" vs
`discoverGroupLabel(...)` ("Discover" / "Discover - <mode>") — which was already distinct
and needed no icon added.
Notes: there is no capsule anywhere in the app literally labelled "Chat room". In this
codebase a chat room IS a non-society community, and its capsule reads "Community" — that
is the one now purple. Grep confirmed exactly two call sites.

---

# Batch B — Notifications

## fix-004 — Write real copy for every notification type
Status: DONE
Files: `src/lib/notifications/copy.ts` (new), `src/lib/notifications/view.ts`
Migration: none

### Audit method
`notifications.type` is plain `text` with **no enum and no check constraint** — the DB
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
cost more than writing them — the runbook's own "when not to delegate" rule. Logged as a
deliberate deviation from the orchestration split.
Verified: `npx tsc --noEmit` clean, `npm run build` green, existing
`src/lib/notifications/view.test.ts` still passes.

## fix-005 — Every notification deep-links to the right page
Status: DONE
Files: `src/lib/notifications/copy.ts`, `src/components/communities/space-shell.tsx`,
`src/lib/use-hash-target.ts` (new), `src/components/feed/comment-thread.tsx`,
`src/components/feed/comments-section.tsx`, `src/app/globals.css`
Migration: none

`notificationHref(type, data)` lives beside the copy and is exhaustive over the same
union. Full type -> route checklist:

| type(s) | destination |
|---|---|
| `post_like`, `comment`, `comment_reply`, `comment_like`, `mention`, `match_post` | `/post/{post_id}` — **anchored `#comment-{comment_id}`** when the payload names one |
| `message` | `/chat/{conversation_id}` |
| `community_message` | `/chat/c/{community_id}` — **fixed**, previously sent you to the community profile, but room chat lives in `/chat` |
| `community_join_request`, `community_post_review` | `/communities|societies/{id}?tab=manage` — the queue itself |
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
  `data.user_id` — there is no `conversation_id` to route on. `/chat` is the honest
  degradation. Adding `conversation_id` to the match notifier would fix it properly.
- `message_reaction` -> `/chat`. Payload has `message_id` only, with no conversation to
  resolve it against; linking to a guessed thread would be worse than the inbox.
- `matching_accepted`, `message_request_accepted` -> `/chat`, same reasoning.
- `smart_match_*` -> `/discover/post` (the manage screen) rather than the swipe deck,
  since these are all about a post you own or applied to.

Supporting work:
- `?tab=` deep links now work: `SpaceShell` reads the param after mount from
  `window.location` — deliberately NOT `useSearchParams`, which would need a new Suspense
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
Notes: anchor scroll/highlight not click-verified in a browser (no test credentials) —
worth one click on a comment notification in the morning.

## fix-006 — Purge notifications for deleted entities
Status: DONE
Files: `supabase/migrations/0132_notification_subject_cascade.sql`,
`src/app/(student)/activity/page.tsx`, `src/app/(student)/home/page.tsx`,
`src/components/notifications/notification-bell.tsx`
Migration: **0132 applied**

Took the runbook's PREFERRED route: real foreign keys with `ON DELETE CASCADE`, not
per-table delete triggers. `notifications.data` is loose jsonb, so 0132 adds eight typed,
nullable mirror columns — `subject_post_id`, `subject_match_post_id`, `subject_comment_id`,
`subject_community_id`, `subject_event_id`, `subject_help_request_id`,
`subject_conversation_id`, `subject_message_id` — each with a real FK and cascade, each
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
resolved. **267 orphans removed** (2235 -> 1968) — of which 180 pointed at deleted posts,
31 at deleted discover posts, 29 at deleted communities, 14 at deleted events, 8 at
deleted conversations, 4 at deleted help requests, 1 at a deleted comment. The matching
SELECT counts were run before the DELETE, per the destructive-action rule.

Defensive read path: view `public.notifications_live` (security_invoker, so RLS still
applies) hides any row whose `data` names a subject that didn't resolve, plus soft-deleted
messages. The Activity feed, the bell's list AND count, and the Home unread badge all read
it now — so no phantom counts.

Verified — SQL proving zero orphans remain, re-run after the migration with the same
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

## fix-007 — Match notification icon should be the lightning bolt
Status: DONE
Files: `src/components/notifications/activity-list.tsx`
Migration: none
`TYPE_ICON.match` changed from `Star` to `Zap`, same size and colour treatment as every
other entry in the map; the now-unused `Star` import was dropped. Did this myself rather
than delegating — a two-line change costs less to make than to specify.
