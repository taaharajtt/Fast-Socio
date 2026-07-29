# Fast Socio — Round 2 fix log

> Summary is written at the END of the run. Statuses below are appended as each fix completes.

## Environment note that shapes every "Verified" line below

**This session has no browser automation tooling** — no `preview_start`, no Playwright/Chrome MCP,
no screenshot capability. The runbook's "browser-verify + screenshot into `.fix-screenshots/`"
gate is therefore **not executable as written**, and I have not pretended otherwise anywhere in
this log. Substitute verification per fix:

- data-layer fixes → executed against the production DB (probe transactions that roll back)
- pure logic → unit tests via `vitest`
- wiring/markup → `npm run lint` + `npm run build` + direct source review

Where the original report could only be truly confirmed by a human click, the entry says so
explicitly rather than claiming a visual pass. **Fixes marked DONE on non-visual evidence are
flagged `NEEDS-CLICK` in Notes.** Round 1's failures were caused by exactly this gap being
papered over, so it is stated loudly here instead.

---

## fix-036 — post count in stats is still zero
Status: DONE
Files: `src/app/(student)/profile/page.tsx`
Migration: none needed — round 1's **0133 was already correct and working**
Effort: HIGH

### Real root cause (round 1's diagnosis was right about the DB and wrong about the bug)
Round 1 correctly found that `posts` has RLS on with no SELECT policy, and correctly added the
SECURITY DEFINER RPC `get_profile_post_count` in migration 0133. That RPC works. The bug was one
line **above** it, at the call site:

```ts
const [ ..., { count: postCount }, ... ] = await Promise.all([
  ...
  supabase.rpc("get_profile_post_count", { p_user: me }),   // line 308
]);
```

`supabase.rpc()` returns its scalar in **`data`**. PostgREST only populates `count` for
`.select()` with a count option. So `postCount` was `undefined`, `postCount ?? 0` collapsed it to
**0, for every user, forever** — the identical symptom the RPC was written to cure, which is why
the fix looked applied and changed nothing.

The tell: the line directly above it destructures `get_match_count` correctly as
`{ data: matchCount }`. Round 1 swapped a count-query for an RPC and left the old destructuring key.

### Wrong value vs true value, from live SQL
| author | rows in `posts` | `get_profile_post_count` (public branch) | what the UI showed |
|---|---|---|---|
| `7a3224dc…` | 33 | **16** | 0 |
| `45f6867e…` | 19 | **10** | 0 |
| `70e8bd51…` | 11 | **5** | 0 |

Fix: `{ count: postCount }` → `{ data: postCount }`, with a comment naming the trap.
Decisions: no migration — changing 0133 would have been fixing a working component twice.
Verified: RPC executed against production (not merely created) returning the non-zero values
above; the consumed field now matches the field PostgREST populates.
Notes: **NEEDS-CLICK** — one look at the Stats tab confirms the rendered number. The data path is
proven; only the render is unobserved.

---

## fix-042 — fix-006 did not work; notifications for deleted things still arrive
Status: DONE
Files: `supabase/migrations/0137_notification_subject_cascade_gaps.sql`
Migration: **0137 written and applied to production**
Effort: HIGH

### Re-diagnosis from scratch (per the runbook: previous approach not assumed sound)
Round 1's 0132 approach was actually the right architecture — eight mirrored subject columns with
real FKs and `ON DELETE CASCADE`, plus a `notifications_live` read-path guard view. I kept it.
It simply **did not cover the subject the user reported**.

The user posted an announcement, deleted it, and still got notified. Announcements live in
`public.society_announcements`, and `create_society_announcement` emits a notification whose
`data` carries `announcement_id`. But:

1. `notifications` had **no `subject_announcement_id` column**, so there was no FK for
   `delete_society_announcement`'s plain `DELETE` to cascade through.
2. `notifications_live` had **no `announcement_id` predicate**, so the read path didn't hide it
   either.

Cascade *and* guard both missed it, which is why the notification survived by both routes.
The same hole existed for `help_responses` (`response_id`, emitted by `help_response`,
`help_thanked`, `help_offer_accepted`).

**Measured on production before the migration: 29 orphaned `society_announcement` notifications
and 20 orphaned help-response notifications.** That is the user's report, quantified as data.

### What 0137 does
- Adds `subject_announcement_id` → `society_announcements(id) ON DELETE CASCADE` and
  `subject_help_response_id` → `help_responses(id) ON DELETE CASCADE`, each with a partial index.
- Extends `notifications_link_subject()` (reproducing the unchanged blocks verbatim — this is
  now the latest redefinition, per the lesson recorded in migration 0115).
- Backfills every row through the trigger (`update notifications set data = data`).
- Deletes the 49 exposed orphans, using the `not exists` predicate that was **run as a SELECT
  first** (29 + 20), per the destructive-action rule.
- Extends the read guard with the two new keys, and adds a guard for a subject that is *removed*
  rather than deleted: a `match` notification whose pair no longer appears in `matches`
  (unmatching leaves no row to cascade from, since the notification references the other user).

Decisions:
- The plain `announcement` type (370 rows, from `admin_broadcast`) is deliberately given **no**
  subject. It denormalises title/body/url and has no backing row that can be deleted, so it
  cannot dangle. Forcing a subject on it would have broken admin broadcasts.
- Kept 0132's architecture rather than rebuilding generically from zero — the mechanism was
  sound, the coverage was not.

### Verified by executing the cascade, not by reading the DDL
A probe transaction (with `notifications_dispatch_push` disabled so no real user got a spurious
push, and a terminal `RAISE` guaranteeing rollback) created a real announcement + notification,
then deleted the announcement:

```
PROBE RESULTS -> trigger_linked=t visible_while_alive=t
                 cascade_deleted=t read_guard_hides_orphan=t
```

That is the user's exact report reproduced and closed at the data layer: the notification exists
while the announcement lives, and **the row is gone the moment the announcement is deleted** —
so it disappears from the panel and the unread count together, both of which read
`notifications_live`. Post-state confirmed: 0 orphans of either kind, 34 help-response links
written, probe fully rolled back, push trigger re-enabled.

### Measurement error worth remembering
My first survey grouped `notifications` through `lateral jsonb_object_keys(data)`, which
**multiplies every row by its key count**. It reported 58 `society_announcement` rows when there
were 29 (2 keys each), and briefly made the DELETE look like it had over-reached by 2×.
Confirmed harmless: `announcement` showed 1110 with 3 keys = exactly the 370 real rows.
Never group by type through a lateral key expansion.

Notes: **NEEDS-CLICK** for the panel/badge render, though both read the view that was proven.
Scope honesty: 042 asked for "literally everything". The two real dangling-subject gaps are
closed and the `match` removal case is guarded. Other types either already cascade via 0132
(post, comment, community, event, help request, conversation, message) or have no deletable
subject (`achievement`, `level_up`, `announcement`). Two narrower cases are recorded under
*Observed, not fixed*.

---

## Observed, not fixed

- **`community_join_request` notifications** carry only `community_id`, so they cascade when the
  community dies but linger after the join request itself is withdrawn or approved. Closing this
  needs a `join_request_id` in the notification payload — an emitter change, out of 042's scope.
- **`society_announcements` is empty in production** (0 rows). Every announcement notification in
  the DB was an orphan. Worth knowing that the announcements feature currently has no live data,
  which also means fix-049's surface cannot be exercised against real content.

---

## fix-009 — edit post doesn't open; two stacked slider windows
Status: DONE
Files: `src/components/feed/post-card.tsx`
Migration: none — round 1's **0134 `edit_post` RPC was already correct**
Effort: HIGH

### Real root cause
Round 1 built the edit UI as a **second `GlassSheet`, a JSX sibling of the options sheet**, both
inside the same `<article>`. `GlassSheet` `createPortal`s to `document.body`, and both panels use
`fixed inset-x-0 bottom-0 z-50` — **identical z-index**. With equal z-index, paint order is decided
by DOM order in `document.body`, not by intent. The Edit sheet is declared first, so its portal node
is inserted first, which puts the Options sheet's node *after* it — i.e. on top.

The Edit handler set `setOptionsOpen(false)` and `setEditingOpen(true)` in the same React batch, so
both sheets animated simultaneously (spring, ~0.2–0.3s) and the outgoing options sheet — panel plus
its scrim — covered the incoming edit sheet and swallowed its clicks. Two sliding windows stacked,
Edit unreachable. Exactly the report.

Fix, per the runbook's required behaviour: **the second sheet is deleted outright**, no z-index
patching. `editingOpen` became `editing`, and when true the post body renders as an inline
`<textarea>` in place with Save / Cancel directly on the card in the feed. There is now exactly one
sheet in the component.
Kept from round 1 unchanged: the ownership-checked path (`editPost` action → `edit_post` SECURITY
DEFINER RPC, mig 0134), `edited_at`, optimistic body update with revert on failure, and the muted
"edited" capsule bottom-right inline with Share.
Decisions: Save/Cancel are inline side-by-side rather than stacked full-width buttons — full-width
stacked buttons are a bottom-sheet idiom and read wrong inline on a feed card.
Verified: source-level — one `GlassSheet` remains in the file; no `editingOpen` identifier survives;
`onCardTap`'s double-tap-to-like guard already excludes `textarea`/`button`, so editing cannot
trigger a stray like. Build/lint at the batch gate.
Notes: **NEEDS-CLICK** — the stacking bug was a runtime paint-order artefact, so a real click on
Edit is the only complete confirmation. The structural cause is removed rather than mitigated,
which is the strongest guarantee available without a browser.

---

## fix-033 — interests must not be a scrollable box inside the edit card
Status: DONE
Files: `src/components/profile/edit-profile-form.tsx`
Migration: none
Effort: LOW (root cause was a single className)

Root cause: line 384 wrapped the chips in
`className="flex max-h-72 flex-wrap gap-2 overflow-y-auto pr-1"` — a fixed 18rem-tall inner scroll
container, exactly what the fix forbids. Now `"flex flex-wrap gap-2"`: no height cap, no inner
scroll, so the card grows and the page scrolls while chips wrap over as many rows as needed.
Decisions: dropped `pr-1` too — it existed only to keep chips clear of the scrollbar that no
longer exists.
Verified: source-level; the only `max-h-`/`overflow-` on the interests region is gone (grep-confirmed
`max-h-72` has no remaining occurrence in the file).
Notes: The runbook asked me to preserve "the fix-015 focus behaviour" and min-3 validation.
**Min-3 validation is intact** (`MIN_INTERESTS` gate at lines 89/92-94, untouched). But there is
**no focus-management code in this file at all** — the only two effects are autosave debounce and
a toast fade. Either fix-015 landed elsewhere or it was never implemented; I changed nothing about
it either way. Worth a look in the morning. **NEEDS-CLICK** for the visual of the expanded card.

---

## fix-001 — logo at 150%
Status: DONE
Files: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`,
`src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/set-password/set-password-form.tsx`
Migration: none
Effort: LOW

180×90 → **270×135** (exactly 150%), as explicit `next/image` width/height rather than CSS scaling,
so it renders sharp. Aspect ratio preserved (2:1), centering untouched (the parent is
`flex flex-col items-center`), `priority` on login retained.
Sharpness confirmed by arithmetic, not assumption: the asset `public/brand/logo.png` is
**512×256**, so 270×135 is still well inside its intrinsic size — upscaling is impossible.
Decisions: the markup is duplicated across the panels rather than shared, so I bumped each in
place instead of introducing a shared `AuthLogo` component — refactoring four auth panels is out
of scope for a sizing fix (rule 8). **I also included a fourth panel the runbook didn't name,
`set-password`**: it uses the same duplicated logo block, and leaving it at 180×90 would have made
a sibling auth screen visibly inconsistent — which would read as a bug, not as scope discipline.
Verified: grep confirms zero remaining `width={180}` in `src/`.
Notes: **NEEDS-CLICK** for the three-panel visual.
