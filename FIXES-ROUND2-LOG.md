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
