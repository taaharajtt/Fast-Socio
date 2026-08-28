# Summary — Round 2 autonomous run

## PUSHED — on explicit instruction, overriding the rule 10 gate

**Update:** the run first stopped at `PUSH SKIPPED` (below). The user then read the summary and
instructed "commit and push to main". `fixes-round2` was merged `--no-ff` as `2166627` and pushed;
Vercel deployment `dpl_FJuu…` reached **READY**, so the 19 DONE fixes are live in production.
No force push; the branch is preserved.

The original gate decision is kept below because the reasoning still stands and explains why the
push needed a human decision.

### Original: PUSH SKIPPED

Nothing was merged or pushed. `main` is untouched and **nothing shipped to production users** from
the Git side. The failed precondition, from Operating rule 10:

> *"At least 24 of the 28 fixes are DONE. Fewer than that means something went systematically
> wrong and I want to look before it ships."*

**19 of 28 are DONE.** That is below the gate, so the run stops on the branch exactly as instructed.
All work is on **`fixes-round2`** (3 commits), which is left in place for you.

A second precondition also fails, though it is not this run's doing: **`npm run lint` is not green**
— 3 `no-require-imports` errors in `scripts/gen-splash.js`, a dev-only script nobody touched.
Verified unmodified via `git diff`; it was already failing before this run started.

> **Important caveat about the database.** The push gate protects the *code*, not the *schema*.
> Per Operating rule 3, **five migrations were written AND applied directly to the production
> database** and are live right now, even though the code that uses them is unmerged. See the risk
> note below — this matters most for fix-037.

## Counts

| status | n | fixes |
|---|---|---|
| **DONE** | **28 — all of them** | 001, 009, 025, 033, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 054, 055, 056, 057, 058, 059 |
| PARTIAL | 0 | — |
| BLOCKED | 0 | — |

**Completed across three sittings.** The first landed 19. The second was cut short by an API
session limit and left 4 fixes with a verified data layer but no UI. The third (subagents still
rate-limited, so hand-written) finished those 4 and the 5 untouched ones — the composer rebuild,
the photo viewer and announcements-as-chat.

The earlier per-sitting narratives are kept below rather than rewritten, because the reasoning in
them — especially the root causes and the defaults taken — is the part worth reading.

All six Batch A regressions are DONE. All three Batch B logic/privacy fixes are DONE. All nine
Batch E chrome/copy fixes are DONE. Batch D is half done (044 yes, 045 no). Batch C (7 fixes) and
Batch F (1 fix) were not started — reasons in their entries; none was left half-built.

## Migrations applied to production and verified

| # | what | verified by |
|---|---|---|
| **0137** | notification subject cascade gaps (fix-042) | probe txn: `cascade_deleted=t`; 49 orphans purged |
| **0138** | pinned location columns + `set_smart_match_post_place` (fix-025) | constraints + RPC executed |
| **0139** | project/FYP deck cohort filter (fix-043) | probe txn: outsider sees **0**, cohort-mate sees **1** |
| **0140** | match percentage formula (fix-037) | live RPC row-by-row vs recomputed weights |
| **0141** | expose `place_id/x/y` through the deck (fix-025) | probe txn: `pin_reaches_viewer=[futsal-ground @ 11.00,89.00]` |
| **0142** | community-chat delete + image columns (fix-051/052) | probe txn as `authenticated`: `moderator_ok=t plain_blocked=t edit_blocked=t` |
| **0143** | body CHECK allows tombstone + captionless image | fixed a 23514 that 0142 alone hit; re-probed green |
| **0144** | matches list + one-hop boundary (fix-056) | probe: `one_hop_rows=21`, **`TWO_HOP_WALK_rows=0`** |
| **0145** | admin broadcast targeting (fix-045) | real send as admin: `sent=37`, **`WRONG_AUDIENCE=0`** |
| **0146** | `verified` audience, so one send path serves all six | `verified_n=2`, `all_n=92` |
| **0147** | optional title + poll + image on announcements (fix-049) | `body_only_ok=t poll_ok=t outsider_blocked=t` |

Every one was verified by **executing** it, not by trusting the DDL — `check_function_bodies` masks
column errors, so each was exercised against real production data inside a transaction that rolls
back. No production rows were deleted except the 49 orphaned notifications in 0137, whose predicate
was run as a `SELECT` first (29 + 20) per the destructive-action rule.

## Commits (on `fixes-round2`, not pushed)

- `d679f18` — Batch A reopened (001, 009, 033, 036, 042) + Batch E (038, 039, 040, 046, 047, 048, 053, 054, 055)
- `78caeba` — 037 match formula, 043 deck privacy, 025 location pinning, 044 dark-only
- `8304be1` — 041 team-member tagging restricted to matches

## Verification honesty — read this before trusting any "DONE"

**This session had no browser tooling** — no `preview_start`, no Playwright/Chrome MCP, no
screenshots. The runbook's browser-verify-and-screenshot gate was **not executable**, and
`.fix-screenshots/` does not exist. I did not fake it.

What I substituted, and how far it goes:
- **Data-layer fixes (036, 042, 043, 037, 025, 041) are verified to a higher standard than a click
  would give** — executed against production with two- and three-account probes that prove absence
  at the source, which a UI check cannot do.
- **Visual fixes (001, 033, 038, 039, 040, 044, 046, 047, 048, 053, 054, 055) are verified by source
  review + lint + build only.** Each is flagged `NEEDS-CLICK` in its entry.
- **fix-009 is the one I'd most want you to click.** Its bug was a runtime paint-order artefact; I
  removed the structural cause (deleted the second sheet entirely) rather than mitigating it, which
  is the strongest guarantee available without a browser — but it is not a click.

## Delegation — 7 Sonnet agents, 3 defects caught in review

Delegated: all of Batch E (5 parallel agents), the fix-044 theme sweep, the fix-025 UI build, and
fix-041. I kept every migration, all root-cause work, the fix-037 formula, the fix-043 privacy
design, and every defaulted decision.

**Where delegation failed — all three caught by reading diffs, none by agent self-report:**
1. **fix-038 collapsed the PPR shell.** The agent made `HomePage` async and awaited a profile read
   at the top, directly against that file's own docstring. I restored it to synchronous and passed
   the placeholder as a promise behind its own Suspense boundary; the build's route table now
   proves `/home` is still Partial Prerender.
2. **fix-047 would have silently done nothing** — it read `profiles.display_name`, which exists (so
   it type-checked and every agent-side check passed) but is **NULL for all 144 production rows**.
   Switched to `full_name`. This is precisely round 1's failure mode, and only a data check caught it.
3. **fix-040 broke reduced-motion styling** — `motion-reduce:bg-transparent` stripped the option's
   glass background instead of settling into the selected state. Switched to `motion-safe:`.

**A process failure worth knowing:** running five agents in parallel on one working tree caused them
to revert each other's in-progress edits — the fix-025 agent reported this explicitly. I verified
the final tree myself (`tsc` clean, build green) and switched to serial dispatch afterwards. Don't
run parallel agents on a shared tree again without worktree isolation.

I also caught **one of my own errors**: an early survey grouped notifications through
`lateral jsonb_object_keys(data)`, which multiplies rows by key count and made a correct DELETE look
like it had over-reached 2×. Chased down and disproven before drawing any conclusion.

## Top 3 things needing your attention

1. **fix-037 changed every user's match percentage, and migration 0140 is LIVE in production while
   the code is unmerged.** The formula was genuinely wrong (same-school scored **+25** when the spec
   wants cross-school favoured; interests capped at 4; a third of the number came from invisible
   aura and incoming-like terms). But `get_discover_candidates` is a definer RPC the *current*
   deployed app already calls — so **live users are seeing the new numbers now**. Cross-school pairs
   went up, same-school pairs went down. This is intended, but it is the single most user-visible
   change of the run and it shipped ahead of its code. If you want it reverted before morning, the
   old function body is in the header comment of `0140_match_percentage_formula.sql`.
2. **fix-043 was a real, live privacy hole — worth confirming you're happy with the boundary.**
   Every user could read every project-partner and FYP post. It is now cohort-gated
   (department + degree + semester, fail-closed) and verified with two accounts. Two judgement calls
   are yours to ratify: I mapped **"school" → `profiles.department`** (no `school` column exists),
   and I deliberately **added no RLS policy**, because the table's only SELECT policy is already
   author-only and adding one would have *widened* access rather than narrowing it. Zero posts of
   these modes exist in production today, so nothing was exposed in practice.
3. **The 9 unfinished fixes are 7 composer + 2 features, and the composer is the real backlog.**
   Batch C is deliberately untouched rather than half-built — a partly-rewritten composer would
   regress three working surfaces. fix-045 and fix-056 each have groundwork documented in their
   entries (including the `current_semester` and `department` traps that will bite anyone who
   targets an audience by semester or school). Also flagged: `profiles.display_name` is a live trap
   that already cost one fix this run — consider dropping the column.

---
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

---

## fix-043 — restrict project-partner and FYP posts to the right deck
Status: DONE
Files: `supabase/migrations/0139_restrict_project_fyp_visibility.sql`
Migration: **0139 written and applied to production**
Effort: HIGH

### The actual exposure
`get_unified_discover_feed` — SECURITY DEFINER, so RLS is bypassed — filtered on status,
expiry, blocks, mutes and passes, and **nothing else**. Every signed-in user received every
`project_partner` and `fyp_teammate` post regardless of degree, department or semester.
Confirmed by reading the shipped function body, not inferred.

### Where enforcement belongs — and why I deliberately added NO RLS policy
The runbook asked for the deck query **and** the RLS layer, warning that filtering the UI over
readable rows is not a fix. I agree with the principle, and on inspection the situation is the
reverse of what it assumes:

- `smart_match_posts`'s only SELECT policy is `author_id = auth.uid()` — non-authors **cannot
  read the table at all**.
- **Zero views** reference the table (checked `pg_class` / `pg_get_viewdef`).
- So the leak was 100% the definer RPC.

Adding a "same cohort may read" SELECT policy would therefore have **widened** direct table
access and *created* an exposure. RLS is already stricter than the requirement, so it is left
untouched — and I hardened the two definer paths instead. Recording this as a deliberate,
reasoned deviation rather than a skipped step.

Second bypass closed: `get_smart_match_posts` (the pre-0110 per-mode deck) is also SECURITY
DEFINER with no cohort filter, so a client could have called it straight over PostgREST and read
every FYP post. Nothing in `src/` calls it (grep: two comments only), so EXECUTE is **revoked
from `authenticated` and `anon`** — closing it without rewriting unexercised logic.

### Decisions (defaults taken)
- **"School" maps to `profiles.department`.** There is no `school` column in this schema;
  `department` is the school-equivalent field the rest of the app uses.
- **Semester comes from `current_semester(username)`, not `profiles.semester`.** That column is
  stale by design since mig 0099 moved semester to compute-on-read from the roll number.
- **Fail-closed.** Every leg requires both sides non-null. If either party's department, degree
  or semester is unknown, the post is **hidden**. Two unknowns must never read as a match in a
  privacy filter — the alternative (`is not distinct from`) would have shown FYP posts to every
  user with an incomplete profile.
- **Author always sees their own post** — via the helper. Note the deck itself excludes your own
  posts (`author_id <> me.uid`) by design, since you do not swipe your own; your own posts are
  reached through the manage/own-posts path, which the author-only RLS policy already permits.
- Predicate **inlined** in the deck (reusing the already-joined author profile `ap`) rather than
  calling the helper per row, which would have re-queried `profiles` for all 40 rows.
- Also shipped `can_see_smart_match_post(author_id, mode)` as the single written-down statement
  of the rule, so a future deck surface reuses it instead of re-deriving it.

### Verified by executing the deck as two different real users
No `project_partner` / `fyp_teammate` posts exist in production, so verification used a probe
transaction (terminal `RAISE` guarantees rollback) with three real accounts: an author **A**, a
cohort-mate **B** (same department + degree + semester), and an outsider **C**.

```
PROBE -> cohort_sees_fyp=1  cohort_sees_sports=1
         OUTSIDER_sees_fyp=0  outsider_sees_sports=1
         outsider_helper=f  author_own_helper=t
```

This is the runbook's "verify with two accounts from different degrees that the post is genuinely
absent, not just hidden" — and it is stronger than a UI check, because it proves absence at the
source the UI reads from. Sports (an unaffected mode) stays visible to the outsider, so the
filter is targeted rather than blanket.
Notes: real production data has **zero** posts of either restricted mode, so no live user is
currently affected either way; this closes the hole before it is exercised.

---

## Batch E — chrome and copy (delegated to Sonnet, reviewed by me)

All nine were dispatched as five parallel Sonnet tasks on disjoint files. **Three defects were
caught in diff review and repaired by me** rather than re-delegated — details under each fix.

### fix-038 — home post-card placeholder
Status: DONE · Files: `src/app/(student)/home/page.tsx`, `src/components/feed/home-feed.tsx`
Placeholder is now `Yo, {name}! What is on your mind?` (exact copy per the runbook), degrading to
first name when the full name exceeds 18 chars and to the nameless default when absent.
**Defect I repaired:** the agent made `HomePage` **async** and awaited a profile read at the top —
directly contradicting that file's own docstring ("leaves this function synchronous, so nothing
above the feed can be held back by it") and collapsing the PPR shell for the whole route. I
restored it to synchronous and passed the placeholder as an unawaited **promise**, mirroring how
`loadFeed()` is already handed to the client, then unwrapped it with `use()` inside a new
`PersonalisedComposer` behind its own Suspense boundary — so only the composer can ever wait, and
the fallback is the same composer with its default placeholder, keeping geometry identical.
Verified: `npm run build` route table shows `/home` as `◐ (Partial Prerender)`, not `ƒ (Dynamic)` —
proof the shell survived.

### fix-039 — Campus Help subtext
Status: DONE · Files: `src/app/(student)/help/page.tsx`
Now `Drop the Gatekeeping, help your Campus.` with `help your Campus.` in `text-aura` (the
codebase's brand purple) and the rest default. The original string was
"SOCIO helps me solve campus problems." — different casing from the runbook's quote.

### fix-040 — illuminate the selected report option
Status: DONE · Files: `src/components/discover/report-sheet.tsx`
250ms brand-purple flash on press, then settles into the selected state; timer cleared on unmount
and on re-press so it cannot fire late.
**Defect I repaired:** the agent used `motion-reduce:bg-transparent`, which under
`prefers-reduced-motion` stripped the option's `glass` / `glass-strong` background for 250ms — so
instead of "going straight to the selected state" it briefly lost its background. Replaced with
`motion-safe:bg-aura/30`, which expresses the intent directly: under reduced motion the flash is
simply never applied. (The agent also justified its approach with incorrect reasoning — it claimed
class-string order decides Tailwind precedence; it does not, generated stylesheet order does.)

### fix-046 — logo elements beside section titles
Status: DONE · Files: `src/components/ui/section-logo.tsx` (new),
`src/app/(student)/communities/page.tsx`, `src/app/(student)/leaderboard/page.tsx`,
`src/app/(student)/discover/page.tsx`
New shared `SectionLogo` copies the Campus Help precedent exactly (`gradient-brand`, `h-10 w-10`,
`rounded-[14px]`, `gap-2.5`) and is used on Community, Ranks and Discover.
Decision forced by reality: the runbook said "use the exact logo used in the navbar", but the
**navbar contains no logo** — the bottom dock is lucide icons only. The agent used the app's brand
image asset (`/brand/logo.png`, the Home masthead logo) inside Campus Help's wrapper geometry.
That is the closest faithful reading; flagging it because the instruction's premise was wrong.

### fix-047 — Community subtext
Status: DONE · Files: `src/app/(student)/communities/page.tsx`
Now `What do you want, {name}?` with the same 18-char / first-name / absent rules as fix-038, in a
Suspense-wrapped async slot so the static shell still prerenders.
**Defect I repaired — this one would have silently done nothing:** the agent queried
`profiles.display_name`. That column exists, so it type-checked and looked correct, but it is
**NULL for all 144 production profiles** (`full_name` is populated for 103). The subtext would have
rendered the nameless fallback forever — precisely round 1's failure mode of a fix that appears
applied and changes nothing. Switched to `full_name`, the column the rest of the app displays.

### fix-048 — purple round button around the Community plus
Status: DONE · Files: `src/components/communities/create-space-button.tsx`
`bg-aura` fill, `h-11 w-11` (44px, above the 40px floor), circular, white icon centred,
`hover:bg-aura/90 active:bg-aura/80`. onClick and accessible label unchanged.

### fix-053 — blue tick for verified societies
Status: DONE · Files: `src/components/communities/community-main-view.tsx`,
`src/components/chat/inbox-list.tsx`, `src/app/(student)/communities/page.tsx`,
`src/app/(student)/chat/inbox-data.ts`, `src/lib/chat/inbox-types.ts`
Reused the existing `VerifiedBadge` from `src/components/ui/badges.tsx` — which is **already blue**
(`--verified: #3b82f6`), so no new variant and no second component were needed, and existing
verified-user badges are untouched. Drives off the existing `communities.is_official` flag (set by
admin `verify_society()`); no new flag, no migration. It was already present on the society header
and the Verified Communities rail; added to the two surfaces missing it — the "Your Spaces" tile and
community/society chat-inbox rows — extending those two queries to select `is_official`. Names keep
`truncate`; badges are `shrink-0`.

### fix-054 — remove the display name over the cover photo
Status: DONE · Files: `src/app/(student)/profile/page.tsx`, `src/app/(student)/profile/[id]/page.tsx`
The overlaid `CoverName` component is gone from both own and public profiles; the name remains in
`Identity()`'s `<h1>` below the cover.
Scrim decision (agent's, and I agree): the gradient was **kept**. It is
`bg-gradient-to-t from-bg via-bg/20 to-transparent` — `from-bg`, not black — so it blends the cover
into the page background at the avatar overlap, and removing it would leave a hard edge under the
avatar. It was not there solely for the removed text.

### fix-055 — remove the doubled hairline above the first post
Status: DONE · Files: `src/components/profile/profile-tabs.tsx`
Root cause: the posts-list wrapper carried `border-y`, whose **top** border sat directly beneath the
tabs' own `border-b`. Changed to `border-b`.
Justified deviation from the runbook's `first:border-t-0` instruction: there is no repeated per-item
top border to apply a `first:` variant to — Tailwind's `divide-y` already omits the leading divider.
The duplicate came from one wrapper's own border. Still a static CSS class change with no JS index
conditional, which was the actual intent of that instruction.

Notes for all of Batch E: **NEEDS-CLICK.** These are visual changes verified by source review plus
`npm run lint` and `npm run build`; I have no browser. The three repaired defects above are the ones
review could catch — a fourth class (pure visual misjudgement) can only be caught by looking.

---

## fix-037 — match percentage formula
Status: DONE
Files: `supabase/migrations/0140_match_percentage_formula.sql`,
`src/lib/discover/match-score.ts` (new), `src/lib/discover/match-score.test.ts` (new)
Migration: **0140 written and applied to production**
Effort: HIGH

### What was there
The percentage was computed in SQL inside `get_discover_candidates`'s `weighted` CTE:

| signal | old weight |
|---|---|
| **same** department | +25 — backwards; the spec favours cross-school |
| semester proximity | up to +15 (a distance ramp, not "same semester") |
| shared interests | `least(n,4) * 8` → max 32, **capped at four** |
| mutual communities | up to +18 |
| aura | up to +10 via `ln()` |
| `they_liked_me` | +9, an invisible incoming-like boost |

clamped to 1..100. So interests were not dominant, same-school was *rewarded* rather than
penalised, and roughly a third of the number came from signals a user cannot see or reason about.

### Authoritative side
**The SQL is authoritative** — it both orders the deck and produces the number the swipe card
renders (`profile.compatibility`, `swipe-deck.tsx:486`). `src/lib/discover/match-score.ts` is a
pure-function mirror serving as the executable specification, with 19 unit tests.

> **SUPERSEDED by migration 0158 (2026-08-28).** The +15 opposite-gender term below is gone:
> gender no longer contributes to the percentage at all. Those 15 points moved to shared
> interests (50 -> 65, term ' + chr(96) + '9 x min(s,6) + 11 x e/(e+6)' + chr(96) + '), so the worked example below now
> scores **92**, not 94. Gender is now purely an ORDERING policy for female viewers
> (see ' + chr(96) + 'src/lib/discover/gender-pacing.ts' + chr(96) + '). The rest of this section is kept as history.

### Final weights (total 100 before clamping)
| signal | weight | notes |
|---|---|---|
| shared interests | **50** | dominant; asymptotic, never actually reaches 50 |
| opposite gender | 15 | |
| same semester | 13 | exact match, derived from the roll number |
| **different** school | 12 | cross-school pairings favoured; same school scores 0 |
| same batch | 10 | intake year from the roll number |

**Interests term:** `7 × min(s,6)` then a bonus of `8 × e/(e+6)` where `e = max(s-6,0)`.
The bonus is a hyperbola, so: s=6 → 42, s=12 → 46, s=24 → 48, s=40 → 48.6, approaching 50
without arriving. A student who ticks all 40 interests therefore **cannot** max the term out.
I chose a hyperbola over a hard cap deliberately: a cap would make "picked everything" score
identically to "genuinely aligned", which is the failure mode the runbook was guarding against.

### Worked example (also pinned as a test)
Two students: 8 shared interests, opposite gender, both semester 4, different schools, both
batch 22.
- interests: `7×6 = 42`, plus `8×2/(2+6) = 2` → **44**
- opposite gender → +15 = 59
- same semester → +13 = 72
- different school → +12 = 84
- same batch → +10 = **94**

A pair sharing nothing, same gender, different semester, same school, different batch scores a raw
0 → clamped to **5**.

### Decisions (defaults taken)
- **Clamped to 5..99**, never 0% or 100%, per the runbook.
- **Unknowns score 0, never partial credit.** Every categorical signal requires the value present
  on *both* sides, so an incomplete profile can never inflate a score. Confirmed live: a candidate
  with no recorded gender scored 0 for that signal.
- **Semester and batch come from the roll number** (`current_semester`, and a new
  `roll_batch_year`), not the stale `profiles.semester` column.
- **"School" = `profiles.department`** — no `school` column exists in this schema.
- **Symmetric and deterministic.** Every signal is symmetric, so score(a,b) = score(b,a); both
  properties are asserted as tests.
- **Aura, mutual communities and the incoming-like boost are not deleted — they moved.** The
  runbook lists five signals and requires the number be explainable from them, but
  `they_liked_me` and mutual communities are real product behaviour, and silently dropping them
  would degrade the deck. They are now **ORDER BY tie-breakers beneath `compatibility`** instead
  of being baked into the number. The score stays honest; the ordering keeps its intelligence.
  Aura is dropped from both — it is a reward metric, not a compatibility signal.

### Verified by executing both implementations
`vitest`: **19/19 pass**, covering the worked example, the cross-school inversion, the
never-maxes-out property, monotonicity, symmetry, determinism, the 5..99 bounds over a 100-case
sweep, and unknown/invalid gender handling.

One test initially failed and the **test was wrong, not the formula**: I had asserted
`interestsTerm(1000) >= 50`, which the asymptote makes impossible by design (it returns 49.952).
Rewritten to assert the real property.

Live SQL check — impersonated a real viewer, ran the RPC, and compared each row against the
weights recomputed independently:
```
viewer dept=Fast School of Management sem=4 g=male batch=24 nInterests=6
roll(i222015)=22  roll(abc)=NULL
sh=2 oppG=t sameSem=t diffSchool=f sameBatch=t  got=52 expect=52
sh=2 oppG=f sameSem=t diffSchool=t sameBatch=t  got=49 expect=49
sh=1 oppG=  sameSem=f diffSchool=t sameBatch=f  got=19 expect=19
sh=2 oppG=f sameSem=t diffSchool=t sameBatch=t  got=49 expect=49
```
Every row matches, and the TypeScript mirror produces the same values (e.g. row 1:
`interestsTerm(2)=14`, +15+13+0+10 = 52), so SQL and TS are in agreement.
Notes: the deck's displayed number changes for every user — expect scores to shift noticeably
(cross-school pairs up, same-school pairs down). That is the intended correction, but it is the
most user-visible change in this whole run.

---

## fix-025 — location pinning was not applied
Status: DONE
Files: `supabase/migrations/0138_pinned_locations.sql`,
`supabase/migrations/0141_discover_feed_place_columns.sql`,
`src/components/map/location-picker.tsx` (new),
`src/components/events/new-event-form.tsx`, `src/app/(student)/events/actions.ts`,
`src/components/discover/post-intent-fields.tsx`,
`src/components/discover/discover-post-form.tsx`,
`src/app/(student)/discover/discover-actions.ts`,
`src/components/discover/intent-card.tsx`, `src/lib/smart-match/types.ts`,
`src/lib/societies/queries.ts`, `src/components/societies/event-mini.tsx`,
`src/app/(student)/events/[id]/page.tsx`,
`src/components/events/tabs/event-overview-tab.tsx`
Migrations: **0138 and 0141 written and applied to production**
Effort: HIGH (design + migrations, mine) / delegated UI build

### Root cause
Nothing to diagnose: it was **never implemented**. Location was free text in two places —
`events.location` and `smart_match_posts.place` — and **no table in the schema had any
coordinate column at all**. A viewer's only route back to the map was `resolvePlace()` doing
best-effort string matching, client-side, on the Discover sports card only.

### Every form with a location field (the runbook asked for this list)
1. **`src/components/events/new-event-form.tsx`** — the one events form, used for standalone,
   community *and* society events (a `communityId` prop switches context). Plain text input.
2. **Discover sports intent** — `CampusPlaceField` in
   `src/components/discover/post-intent-fields.tsx`, driven by the `place` field spec in
   `src/lib/smart-match/modes.ts`. Quick-select chips that just typed a name into a text box.

**There is no event-type intent in Discover.** The runbook says "the event and sports forms in
Discover's post flow", but Discover's modes are `project_partner`, `fyp_teammate`,
`hackathon_team`, `sports`, `recruitment`, and only `sports` has a location field. Events are a
separate `/events/new` form. Both real surfaces are covered; the third does not exist.
Confirmed to have **no** location field: help requests, society announcements, the feed composer.

### Design decisions (mine, all defaulted per the runbook)
- **Coordinates are percentages of `public/map.png` (0-100), not lat/lng** — matching
  `src/lib/map/places.ts`. Stored explicitly (`place_x`, `place_y`) rather than derived from
  `place_id` at read time, so a post keeps the pin it was created with even if the places dataset
  is later renumbered.
- **The existing text label columns are kept and still written.** `events.location` and
  `smart_match_posts.place` are unchanged, with the pin travelling alongside. This is why no
  existing read path, admin view or payload mapping needed touching.
- **Selection is restricted to the ~21 known campus places.** `CampusMapViewer` has no
  arbitrary-point mode, the dataset is a fixed known-place list with search and type filters, and
  a free-dropped pin would produce locations the app cannot name or search. So "snap to a known
  place when close" degenerates to "pick a place" on this map. Logged as a deliberate reading of
  the requirement rather than a silent narrowing.
- **I did not rewrite `create_smart_match_post` / `update_smart_match_post`.** Both are long
  SECURITY DEFINER functions that map a jsonb payload key-by-key; reproducing them verbatim to add
  three keys is a large blast radius for a small change. Instead 0138 adds a narrow,
  author-checked `set_smart_match_post_place(id, place_id, x, y)` which the action calls
  immediately after create/update. It accepts all-nulls so clearing a pin works, and a failure
  there never fails the post (the label is already saved).
- A `CHECK` constraint on both tables rejects coordinates outside 0-100, so a malicious client
  cannot write a pin off the map.

### The half that was missing before, and nearly was again
The runbook is explicit that viewers seeing the pin is not optional. The delegated agent built
the picker and the viewer links, then **reported honestly that it could not finish this half**:
`get_unified_discover_feed`'s `RETURNS TABLE` predates 0138, so `place_id/x/y` never reached the
client, and the pin-first link only worked for an author reading their own posts (`select *`).
Migrations are mine, so I closed it with **0141**, which drops and recreates the function (a
return type cannot be altered by `CREATE OR REPLACE`) with the three columns added and the
fix-043 cohort predicate carried forward unchanged. The client already read `r.place_id`,
`r.place_x`, `r.place_y`, so it lit up with no further code change.

### Verified by executing, as a viewer rather than the author
Probe transaction (terminal `RAISE` forces rollback) inserted a sports post pinned to Futsal
Ground and read it back through the deck **as a different user**:

```
POST-0141 -> cohort_sees_fyp=1  OUTSIDER_sees_fyp=0  outsider_sees_sports=1
             pin_reaches_viewer=[futsal-ground @ 11.00,89.00]
```

So a viewer genuinely receives the pinned place id and its coordinates — the end-to-end
requirement — and the same probe re-confirms fix-043's filter survived 0141's DROP/CREATE.
`npm run build` succeeds.
Notes: **NEEDS-CLICK** for the picker's feel (opening the sheet, tapping a marker, confirming) and
for the tap-through actually focusing the pin on `/map`. The data path is proven in both
directions; the interaction is not. `/map` already accepted `?place=` (via `resolvePlace`, which
takes an id, name or alias), so no map-page change was needed.
Also note `src/components/societies/event-mini.tsx` had to be restructured — an `<a>` cannot nest
inside the card's own `<a>` — so the location is now a sibling link rather than nested.

---

## fix-044 — remove light theme entirely
Status: DONE
Files: `src/app/layout.tsx`, `src/components/theme-provider.tsx`,
`src/app/(student)/settings/page.tsx`, `src/app/styleguide/page.tsx`,
`src/app/(student)/home/page.tsx`, `src/components/ui/section-logo.tsx`,
`src/components/theme-toggle.tsx` (deleted)
Migration: none
Effort: MEDIUM (delegated after I set the scope limit)

Dark forced at the root: `<html>` unconditionally carries `dark` plus `style={{colorScheme:"dark"}}`
(`globals.css` already had `color-scheme: dark`). `theme-provider.tsx` **kept** per the runbook's
default but pinned with `forcedTheme="dark"` and `enableSystem` removed — hydration stays safe,
blast radius stays small. `theme-toggle.tsx` deleted along with its only two call sites (settings
and the internal `/styleguide`). Grep for `useTheme|resolvedTheme|setTheme|systemTheme` afterwards
returned **zero** hits, so nothing else needed collapsing. No custom `storageKey` was ever set and
the toggle was the only consumer of next-themes state, so there was no stored preference to purge
(unrelated `localStorage` use in `appearance.ts` for font/density/motion was left alone).
Manifest and `gen-splash.js` were already dark (`#0A0B10`) — no change, no binary regeneration.

Theme-dependent **assets** were the real functional catch: the app shipped `/brand/logo.png` (dark)
and `/brand/logo1.png` (light) and switched between them. Both sites — the Home masthead and the
new `section-logo.tsx` from fix-046 — now always render the dark asset.

Decision I made and enforced on the agent: **the app's `dark:` Tailwind utilities were NOT
mechanically rewritten.** Under a permanently dark root every `dark:` variant simply always
applies, so they are already correct, and rewriting them app-wide is a large cosmetic refactor with
real regression risk for zero user-visible gain. I required a count instead — it came back as
**3 occurrences across 2 files** (`globals.css`, `src/lib/events/qr.ts`), so the runbook's "collapse
every `dark:` conditional" turned out to be a non-issue rather than a shortcut taken.
Verified: `tsc` clean, `npm run build` succeeds, and `/home`, `/profile`, `/communities` all still
build as `◐ (Partial Prerender)` rather than flipping to `ƒ (Dynamic)` — the layout stayed
non-async, so the PPR shells survived.
Notes: **NEEDS-CLICK** to confirm no surface renders light in practice, especially the auth pages,
the not-found screen and the admin dashboard.

---

## fix-041 — only matches can be tagged as team members
Status: DONE
Files: `src/app/(student)/discover/discover-actions.ts`,
`src/components/discover/team-member-mentions.tsx`
Migration: none — deliberately
Effort: MEDIUM

`searchTeammates` is now scoped to the viewer's matches via a new `getMatchIds(uid)` helper that
reads **both sides** of the canonical `user_low`/`user_high` pair, and returns `[]` immediately
when the user has no matches. The tagger shows a distinct empty state,
`Match with people to add them to your team.`, separate from its existing no-results-for-query text.

The security half is server-side: **both** `createDiscoverPost` and `updateDiscoverPost`
re-resolve match ids from the database and reject any submitted id that is not among them
(`{ ok: false, error: "You can only tag people you've matched with." }`), rather than trusting the
client or merely filtering the UI.

Decisions:
- **No DB-level enforcement, on purpose.** A trigger or RLS rule on `smart_match_team_members`
  would have broken migration 0128 (`accept_adds_team_member`), which adds a team member when an
  application is *accepted* — and an applicant is not necessarily a match. The check therefore
  belongs in the two Server Actions, which are the only author-tagging path.
- **Runbook default honoured:** `updateDiscoverPost` fetches the post's existing members and
  exempts them, so a previously-tagged user who is no longer a match survives an edit; only
  newly-added ids are checked.
Verified: diff reviewed line by line; `tsc` clean; `npm run build` succeeds; `vitest` shows no new
failures.
Notes: **NEEDS-CLICK** for the tagger's suggestion list and empty state.

---

# NOT COMPLETED — 9 fixes

These carry a status per the runbook's requirement that all 28 be accounted for. They are
**not started**, not half-built: nothing was left in a broken or partially-migrated state, and
every one of them is independent of the 19 that shipped.

## fix-045 — admin broadcast with audience targeting
Status: BLOCKED — not started (session capacity)
Reason: needs a migration plus a real admin compose UI (audience selector, data-populated pickers,
resolved-recipient-count preview, confirm step). Not startable at the end of a long session
without rushing the targeting, which is the entire point of the fix.
**Groundwork already established for whoever picks it up:** `public.admin_broadcast(p_title, p_body,
p_url, p_segment, p_department)` already exists — SECURITY DEFINER, guarded by
`_admin_guard_super()`, and it already fans out one `notifications` row per recipient (the
runbook's stated default) with type `announcement`. Extending it means adding
`p_user_id`/`p_semester`/`p_degree` parameters and widening the `tgt` CTE. Two live constraints to
respect: **semester must be resolved via `public.current_semester(username)`**, never the stale
`profiles.semester` column (all 144 rows would mis-target); and **"school" means
`profiles.department`** — there is no `school` column.

## fix-056 — a real matches list, and your matches' matches
Status: BLOCKED — not started (session capacity)
Reason: a new route plus a one-hop privacy boundary that the runbook requires be enforced in RLS,
not just the query. That authorization design is mine to do properly and was not something to
rush. `matches(user_low, user_high)` and `get_match_count` exist; fix-037's `matchScore` is now
available for the percentage column, and fix-041 added a `getMatchIds` helper that is the natural
seed for the first-degree list.

## Batch C — the chat composer rebuild (7 fixes)
Status: BLOCKED — not started (session capacity)
fix-049, fix-050, fix-051, fix-052, fix-057, fix-058, fix-059.
Reason: the runbook is explicit that these are **one job** — a single composer built once with a
per-surface capability flag, wired to community / chat-room / discover, plus a reusable full-screen
photo viewer, plus a moderator-delete authorization migration. Starting a coherent multi-surface
rebuild with limited remaining session capacity would have produced exactly the half-applied state
the runbook warns against, and a broken composer would regress three working surfaces. Leaving it
untouched keeps those surfaces working.
Note for fix-051 specifically: its authorization is a migration plus Server Action work, and per
the runbook it must **not** be gated on UI visibility alone. Note also that fix-049's surface
cannot currently be exercised against real content — `society_announcements` has **0 rows** in
production.

---

## Observed, not fixed

- **Pre-existing test failure.** `src/lib/smart-match/logic.test.ts > "passes a complete project
  request"` fails. I verified in an isolated git worktree that it **already fails at `c8729fc`**,
  the commit this run branched from, so it predates round 2 entirely. Left alone per scope
  discipline. Full suite is otherwise 245 passing.
- **Pre-existing lint errors.** `npm run lint` reports 3 errors, all
  `@typescript-eslint/no-require-imports` in `scripts/gen-splash.js`, a dev-only splash generator
  that no one touched this run (`git diff` confirms it is unmodified). This means **lint is not
  green at HEAD and was not green before this run either** — relevant to Operating rule 10.
- **`community_join_request` notifications** carry only `community_id`, so they cascade when the
  community dies but linger after the join request itself is withdrawn or approved. Closing this
  needs a `join_request_id` in the notification payload — an emitter change, outside fix-042.
- **`society_announcements` is empty in production** (0 rows). Every announcement notification in
  the database was an orphan. The announcements feature currently has no live data.
- **`profiles.display_name` is NULL for all 144 rows** while `full_name` is populated for 103. The
  column is a trap: it exists, so it type-checks, but reading it silently yields nothing. It cost
  one delegated fix a silent failure this run (see fix-047). Consider dropping it.
- **fix-033's "fix-015 focus behaviour"** could not be preserved because there is no
  focus-management code in `edit-profile-form.tsx` at all — only an autosave debounce and a toast
  timer. Either fix-015 landed elsewhere or it was never implemented.
- **The runbook's premise for fix-046 was wrong:** it asks for "the exact logo used in the navbar",
  but the bottom navbar contains no logo — it is lucide icons only. The app's brand image asset was
  used instead.

---

# Second sitting — "finish everything" (session-limited)

Attempted the 9 outstanding fixes. **A hard API session limit (resets 08:00 Asia/Karachi) killed
both UI subagents mid-flight**, so this sitting delivered the *data layer* for four fixes —
designed, applied to production and verified by execution — and none of the UI.

Both killed agents left **zero partial edits** (`git status` showed only my migration files), so
nothing is half-written in `src/`. The four migrations are **purely additive and
backward-compatible**, so production is not in a broken or inconsistent state:

- **0142** adds nullable columns, a new RPC, and an UPDATE policy where *none existed before*
  (so it only grants capability that was previously impossible — it cannot break an existing path).
  The view gained three appended columns, which existing consumers ignore.
- **0143** *relaxes* a CHECK constraint — strictly more permissive.
- **0144** and **0145** add new functions only; the existing `admin_broadcast` is untouched.

## fix-051 — owners and moderators can delete any message
Status: **PARTIAL** — data layer DONE and verified; client UI not built
Files: `supabase/migrations/0142_community_chat_delete_and_media.sql`,
`supabase/migrations/0143_community_chat_body_allows_media_and_tombstone.sql`
Migrations: **0142, 0143 applied to production**
Effort: HIGH (authorization is mine to own)

**Key discovery that collapses three fixes into one surface:** a Discover team room is not a
separate system. `create_discover_group_chat` inserts a `communities` row with
`is_discover_group = true` and puts the team in `community_members`. Chat rooms are communities
too. So all of fix-051's *and* fix-058's surfaces are one table, `community_chat_messages`, and
one component, `CommunityChat`. The DM thread is a different table and already has delete + images.
(The recon agent asserted Discover chat used `conversations`/`messages` and the DM composer — that
was **wrong**, and I caught it by reading `create_discover_group_chat` directly. Acting on it would
have sent the whole batch at the wrong component.)

**Authorization is in RLS, not just the RPC.** The table had SELECT and INSERT policies only — no
UPDATE, no DELETE — so nothing could be deleted by anyone. Rather than a SECURITY DEFINER function
that bypasses RLS and re-checks by hand, `delete_community_message` is **SECURITY INVOKER**, so the
policy *is* the enforcement: an unauthorised caller matches zero rows and the function raises.
The policy's `WITH CHECK` additionally constrains what the row may *become*, so this path can only
ever produce a tombstone and can never be repurposed to edit someone else's text.
Permitted: the author, the community owner, a moderator, a society officer (for societies), an admin.

**A bug my own migration introduced, caught only by executing it.** 0142 applied cleanly and the
policy was right, but every delete still failed. Instrumenting the error rather than guessing gave
SQLSTATE 23514: a pre-existing `community_chat_messages_body_check` requires
`char_length(body) >= 1`, so the tombstone's `body = ''` was rejected at write time. The same
constraint would also have blocked fix-052's image-with-no-caption. 0143 amends it to allow an
empty body in exactly two cases: the message carries an image, or it is a tombstone. **This is
precisely the failure mode the runbook warns about — a green migration that does not work.**

Verified by executing as the `authenticated` role (otherwise RLS is bypassed and the test proves
nothing), in a rolled-back transaction with a real owner, moderator and plain member:
```
FIX051/052 -> plain_blocked=t author_ok=t moderator_ok=t edit_blocked=t
              tombstoned=t tomb_body=[] view_ok=t image_only_insert=t
```
A plain member cannot delete another's message; the author can delete their own; **a moderator can
delete anyone's**; the update path cannot be turned into an edit; the tombstone is written and
exposed through `community_chat_view`.
Remaining: the client half — long-press/⋯ → ConfirmDialog → optimistic removal, realtime UPDATE
propagation, and the muted "Message deleted" tombstone rendering.

## fix-052 — media attachment (pictures only)
Status: **PARTIAL** — data layer DONE; upload/render UI not built
Migrations: **0142, 0143** (as above)
`community_chat_messages` now has `attachment_url` and `attachment_type`, constrained to
`'image'` only at the database level (`attachment_type is null or attachment_type = 'image'`) plus
a pair constraint so url and type must both be present or both absent. Verified an image-only
message with an empty caption now inserts. Remaining: the picker → `ImageCropper` →
`uploadWithProgress("chat-media", …)` flow, the server-side MIME check in the Server Action, and
rendering the image AS the bubble with no wrapper frame.

## fix-056 — a real matches list, and your matches' matches
Status: **PARTIAL** — data layer DONE and verified; the page and route are not built
Files: `supabase/migrations/0144_matches_list_one_hop.sql`
Migration: **0144 applied to production**
Effort: HIGH (the one-hop boundary is mine to own)

`matches` already has RLS allowing a user to read only rows they are part of, so a second-degree
list is impossible by direct query and no hand-crafted PostgREST request can walk the graph. The
definer RPCs are therefore the only path, which makes the guard inside them the real enforcement,
with RLS as the backstop — the same architecture as fix-043.

- `get_my_matches()` — first degree, with the match percentage.
- `get_matches_of(p_user)` — second degree, gated on the caller being matched with `p_user`.
  **Deliberately returns no match percentage**: the score between those two people is not the
  viewer's to see (the runbook's stated privacy default). The viewer is also excluded from their
  own second-degree list.
- `match_percentage(a, b)` — fix-037's formula as a callable function, so the matches page and the
  deck share one definition. 0140's deck keeps it inlined for per-row performance; the two are
  identical and the comment in 0144 says to change all three (SQL x2 + TS) together.

**Asking for the matches of a non-match returns an empty set rather than raising** — a raise would
confirm that the target exists and has matches; an empty list is indistinguishable from "they have
none", which is the safer answer. Logged as a deliberate default.

Verified against a real two-hop chain in production (A—B, B—D, A not matched to D):
```
FIX056 -> my_matches=18  first_degree_has_pct=t  one_hop_rows=21
          viewer_in_own_hop_list=0  TWO_HOP_WALK_rows=0  pct(A,B)=35
```
The one hop works; **the two-hop walk returns 0** — the boundary holds.
Remaining: the route under `/profile/matches`, the row UI (avatar, name, roll number, percentage,
tap-through to profile + chat shortcut), the second-degree drill-in, and the two empty states.

## fix-045 — admin broadcast with audience targeting
Status: **PARTIAL** — data layer DONE and verified; the admin compose UI is not built
Files: `supabase/migrations/0145_admin_broadcast_targeting.sql`
Migration: **0145 applied to production**
Effort: MEDIUM

Added `admin_audience_ids`, `admin_audience_options`, `admin_broadcast_preview` and
`admin_broadcast_targeted`, supporting the four required audiences — single user, semester, degree,
school — alongside the existing `admin_broadcast`, which is left untouched so today's admin UI keeps
working. Audience resolution lives in ONE function used by both the preview and the send, so the
preview cannot drift from what actually goes out. Fail-closed: an unrecognised audience matches
nobody. Value shapes are validated up front so a bad value cannot half-send.

**The stale-column trap, quantified.** Semester is resolved with `current_semester(username)`.
Had I used the `profiles.semester` column, a "semester 4" broadcast would have reached **4 people
instead of 37** — silently addressing the wrong audience:
```
sem4_via_rollnumber=37   sem4_via_stale_column=4   all=92   bogus_audience=0
```
Verified by performing a real targeted send as a real super-admin, in a rolled-back transaction
with the push-dispatch trigger disabled so no live user received anything:
```
FIX045 -> preview=37  sent=37  rows_created=37  WRONG_AUDIENCE=0
          single_user_sent=1  nonadmin_blocked=t
```
Preview equals what is actually sent, **only addressed people received it** (the entire point of the
fix), single-user targeting sends exactly one, and a non-admin is refused at send time.
Remaining: the admin composer — audience selector, data-populated pickers, recipient-count preview,
confirm step.

## fix-049, fix-050, fix-057, fix-058, fix-059
Status: **BLOCKED — not started** (session limit)
The composer rebuild (050/058/059), the photo viewer (057) and announcements-as-chat (049) were
specified in full and dispatched, but the agent was killed before writing anything. Nothing is
half-built. The design is recorded below so the next session starts from a decision, not a blank page.

### The composer design, ready to build
One `ChatComposer` at `src/components/chat/chat-composer.tsx` with a per-surface capability flag:
```ts
type ComposerCapabilities = { poll?: boolean; anonymous?: boolean; media?: boolean };
```
- community + chat room → `{ poll: true, anonymous: true, media: true }`
- Discover team room → `{ poll: true, anonymous: false, media: true }` (fix-018's decision)
- announcements (049) → `{ poll: true, media: true }`, placeholder "Post an announcement"

Because all three surfaces are the same `CommunityChat` component, this is **one wiring, not three**.

Shape (fix-058): field first, icon cluster *inside* the field's right edge in the order
poll → anonymous → media, send as its own circle *outside* the field. Row is `items-end` so the
cluster and send stay aligned to the bottom of a grown field.

Multi-line (fix-050): `textarea rows={1}`, auto-grow to 5 lines then scroll internally, Enter sends,
Shift+Enter newlines — copy the DM thread's existing effect.

**Placeholder centring (fix-059) — the exact arithmetic, so nobody "fixes" it with a margin:**
`leading-[20px]` + `py-[10px]` + `min-h-[40px]` → 20 + 10 + 10 = 40, so a single line is
mathematically centred at rest. Max height 120px = 5 × 20 + 20.

---

# Third sitting — the remaining nine

Subagents were still rate-limited, so all of this is hand-written. Migrations **0146** and **0147**
applied and verified on top of 0142–0145.

## The discovery that shrank Batch C

The runbook treats community chat, campus chat rooms and Discover team rooms as three composers to
unify. They are **one**. `create_discover_group_chat` inserts a `communities` row with
`is_discover_group = true` and puts the team in `community_members`; chat rooms are communities
too. All three are `community_chat_messages` rendered by `CommunityChat`. Only DMs are a different
table.

The reconnaissance agent asserted the opposite — that Discover chat used `conversations`/`messages`
and therefore the DM composer. I checked `create_discover_group_chat` directly and found it wrong.
Acting on that report would have aimed the entire batch at the wrong component.

So the capability flag has exactly one job: **Discover passes `allowAnonymous={false}`** (fix-018's
decision). Everything else is shared.

## fix-050, fix-058, fix-059 — the composer
Status: DONE · Files: `src/components/chat/chat-composer.tsx` (new),
`src/components/communities/community-chat.tsx`, `src/components/chat/community-thread.tsx`,
`src/app/(student)/chat/c/[id]/page.tsx`

Shape per fix-058: field first, capability icons grouped **inside** the field's right edge in the
order poll → anonymous → media, send as its own circle **outside**. The row is `items-end` so the
cluster and send stay pinned to the bottom of a grown field.

fix-050: `textarea rows={1}` auto-growing to five lines then scrolling internally; Enter sends,
Shift+Enter newlines — the DM thread's existing pattern.

**fix-059 is geometry, not a nudge.** `leading-[20px]` + `py-[10px]` + `min-h-[40px]` = 40px, so one
line box plus symmetric padding centres the placeholder *by construction* at any font size and in
either theme. A margin or `translate-y` would only be correct at one size. The arithmetic is
written into the file so nobody "fixes" it later. Max height 120px = 5 × 20 + 20.

## fix-052 — media, images only
Status: DONE · Migrations 0142 + 0143
Picker → `ImageCropper` → `chat-media` upload → `sendCommunityImage`. Images only, enforced in
**three independent places**: the picker's `accept`, a real server-side MIME check that asks storage
what the object actually is, and a DB CHECK permitting only `attachment_type = 'image'`. The image
IS the bubble — no padded wrapper — matching the DM thread.

## fix-051 — owners and moderators delete any message
Status: DONE · Migrations 0142 + 0143
Authorization is in RLS, not the RPC: `delete_community_message` is **SECURITY INVOKER**, so the
policy is the gate and an unauthorised caller matches zero rows. Its `WITH CHECK` constrains what
the row may *become*, so the path can only ever produce a tombstone and can never be repurposed
into an edit — verified (`edit_blocked=t`).
Client: long-press → GlassSheet → `ConfirmDialog` → optimistic tombstone, propagated to everyone by
a **new realtime UPDATE subscription** (the existing one was INSERT-only, so a delete would never
have reached other clients).
`canModerateChat` was added to the relationship helper because the existing `canManage` is
owner-only for casual rooms and would have hidden a permitted action from a plain community's
moderator.

## fix-057 — full-screen photo viewer
Status: DONE · Files: `src/components/ui/photo-viewer.tsx` (new), wired into the DM thread,
community chat and announcements.
Full-bleed on black, pinch/scroll zoom, drag to pan, tap / swipe-down / Esc to close, sender name
and timestamp overlay. **No download, no share** per the stated default.
The DM thread doesn't carry the peer's display name, so the overlay names only the viewer's own
photos rather than inventing a label for the other side.

## fix-056 — matches list and one-hop second degree
Status: DONE · Migration 0144 · Route **`/profile/matches`** (+ `/[id]`)
Chosen to sit beside `/profile/aura` and `/profile/badges` rather than a top-level `/matches`,
since it is a view of your own profile data. Linked from the Matches stat card.
Second-degree lists deliberately carry **no match percentage** and **no chat shortcut**, and do not
link onward — the UI offers exactly one hop, and the score between two other people is not yours.

## fix-045 — admin broadcast targeting
Status: DONE · Migrations 0145 + 0146
Audience selector (All / Verified / single user / semester / degree / school), pickers populated
from `admin_audience_options()`, a resolved recipient-count preview, and an explicit confirm step
replacing `window.confirm`.
**0146 exists because rebuilding on the targeted RPC would have silently dropped the "Verified
only" audience** the current UI offers — one send path now serves all six.
The count and the confirm step are **derived from an audience key**, not held as independent flags,
so it is structurally impossible to confirm a send against a count belonging to a different
audience.

## fix-049 — announcements are exactly the chat
Status: DONE · Migration 0147
The blocker was schema, not markup: `society_announcements.title` was NOT NULL with a 2–120 check,
so a one-field composer could not write a row. **0147 makes title optional** rather than deriving a
fake title from the first line. Older titled rows keep and still render theirs.
Polls reuse the community poll machinery **unchanged** — a society IS a `communities` row, so
`community_polls`, `community_poll_results`, `PollCard` and `voteCommunityPoll` all work as-is; the
new RPC just lands the poll in the announcement thread instead of the chat room. Members vote and
tallies re-read.
The "Open chat" capsule and the grouped chat-style thread already existed from round 1's fix-028.
`announcement-composer.tsx` is deleted — nothing called it any more.

## Two silent bugs caught while wiring, both invisible to `tsc`

1. The chat-room page's initial `select` omitted `deleted_at` / `attachment_*`, hidden by an
   `as CommunityMessage[]` cast. Tombstones and images would not have appeared until a realtime
   refetch. **A force-cast turns a missing column into `undefined` rather than a type error** — the
   same shape of failure as round 1's `rpc().count`.
2. The chat inbox previewed "empty body means a poll". A tombstone and an image are both
   empty-bodied now, so both would have previewed as a blank line. Mirrored the DM path's handling.

## Migrations from this sitting

| # | what | verified by |
|---|---|---|
| 0146 | `verified` audience on the targeted resolver | `verified_n=2`, `all_n=92`, 15 option rows |
| 0147 | optional title + poll + image on announcements | `body_only_ok=t poll_ok=t poll_options=2 feed_exposes_poll=t outsider_blocked=t` |

## What is still NOT verified

Everything in these three sittings that is visual remains **NEEDS-CLICK**. There was never a browser
in this session. The composer's exact pixel shape, the placeholder's centring, the photo viewer's
gestures, and the announcement thread's feel are all verified by construction, `tsc`, lint and
build — not by looking. The arithmetic behind fix-059 is sound, but sound arithmetic and a correct
appearance are not the same claim.
