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
