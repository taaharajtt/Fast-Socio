# Fast Socio — "Fixes Final" autonomous runbook (fix-001 → fix-038)

**How to use this:** launch the session with the command in "Launching the run" below, paste
**only the "KICKOFF PROMPT" block**, then leave. Everything else in this file is the spec the
session reads for itself. Do not paste the individual fixes.

---

## Launching the run

Permission prompts are a harness setting, not something a prompt can turn off — Claude cannot
grant itself permissions from inside the conversation. Start the session in bypass mode from your
terminal, in `D:\FastSocio`, with the model set to Opus 5:

```bash
claude --dangerously-skip-permissions --model claude-opus-5
```

Then paste the kickoff block. No tool call will stop for approval for the rest of the session.

Two things this means, so there are no surprises in the morning: bypass mode disables *every*
confirmation, including for commands the runbook doesn't anticipate — the guardrails in Operating
rule 9 (no drops, no unqualified DELETE, no push, no deploy) become the only thing standing
between the session and production, and they're instructions rather than enforcement. And since
the Supabase MCP is connected to the live project, applied migrations hit production directly.
The branch protects your code; it does not protect your database. If that's more exposure than you
want, run with `--model claude-opus-5` alone and accept that you'll wake to a session paused on a
prompt — or tell me and I'll rewrite Batch A to write migration files without applying them.

---

## KICKOFF PROMPT — paste this, then walk away

```
Read D:\FastSocio\FIXES-FINAL-RUNBOOK.md in full, then implement every fix in it
(fix-001 through fix-038) autonomously in this one session, in the batch order given
in the "Execution order" section.

Operate under the "Operating rules" and "Orchestration" sections of that file. You are
the orchestrator: you do the analysis, planning, decisions, and all security-sensitive
work yourself, and you delegate mechanical implementation to Sonnet 5 subagents as the
Orchestration section describes. Raise and lower your own reasoning effort per the
effort table there.

Do not stop to ask me questions — every ambiguity in the spec already has a stated
default; take it, and record the decision in FIXES-FINAL-LOG.md. I am asleep and will
read the log in the morning.

Work continuously until all 38 fixes are done or you hit a genuine hard blocker.
Commit after each batch. Keep going after individual failures — a fix you cannot
complete gets marked BLOCKED in the log and you move to the next one.

Start now.
```

---

## Operating rules (Claude: these govern the whole session)

**Environment.** Repo `D:\FastSocio`, Next.js 16 App Router PWA + Supabase, Windows/PowerShell.
Read `node_modules/next/dist/docs/` before using any Next API you're unsure of — this Next
version differs from your training data. Layouts must stay non-async (Cache Components / PPR is
on) or shells collapse. Keep the existing design tokens and glass/purple aesthetic.

**1. Branch first, before touching anything.**
```
git checkout -b fixes-final-batch
```
All work lands there. Never commit to `main` in this session. If the branch already exists,
continue on it.

**2. Never block on me.** Every fix below states a default for every judgement call. Take the
default, write one line in the log explaining it, move on. There are no questions to ask.

**3. Migrations: write AND apply.** When a fix needs a schema/RLS change, add the next numbered
file in `supabase/migrations/` and **apply it to the database yourself** via the Supabase MCP
`apply_migration` tool. Verify it took effect (query the schema / execute the function — note that
`check_function_bodies` masks column errors, so verify functions by *executing* them, not just
creating them). Log every migration number you applied. If an apply fails, revert the local file,
mark the fix BLOCKED, and continue.

**4. Commit per batch, not per fix.** After each batch in the execution order: run
`npm run lint` and `npm run build`, then commit with a message listing the fix numbers
(`fix(batch-A): 023, 031, 024, 026 — community/room authorization + join requests`). Do **not**
push and do **not** deploy — I'll review and push in the morning.

**5. If the build breaks, fix it before moving on.** A red build at the end of a batch is a stop
condition for that batch only: revert the smallest change that broke it, mark that fix BLOCKED,
get the build green, commit the rest, continue to the next batch. Never leave `main`-mergeable
work in a non-building state.

**6. Verify in the browser where the change is visible.** Use `preview_start` on the dev server
and the browser tools. Screenshot before/after for the visual fixes (001, 002, 013, 014, 027, 029,
032, 037) into `.fix-screenshots/` and reference them in the log. Don't ask me to check manually.

**7. Keep a running log.** Create and continuously append to `FIXES-FINAL-LOG.md`:

```markdown
## fix-0NN — <title>
Status: DONE | PARTIAL | BLOCKED
Files: <paths touched>
Migration: <number applied, or none>
Decisions: <any default you took, and why>
Verified: <how — browser screenshot / SQL query / test>
Notes: <anything I need to know>
```

Write the entry immediately after each fix, not at the end — if the session dies I still get the
history.

**8. Scope discipline.** Do exactly what each fix says. If you spot an adjacent bug, log it under
a `## Observed, not fixed` section at the bottom of the log — do not fix it.

**9. Destructive-action boundary.** You may create/alter tables, policies, functions, and columns.
You may **not** drop tables, delete production rows, or run `DELETE`/`TRUNCATE` without a `WHERE`
that you have first tested with a `SELECT`. Cascade deletes defined in a migration are fine. No
pushing, no deploying, no `git push --force`, no touching Vercel env or production config.

**10. Morning summary.** End the session by writing a `# Summary` section at the **top** of the
log: counts (done / partial / blocked), migrations applied, commits made, and the top 3 things
that need my attention.

---

## Orchestration (Claude: you are the orchestrator, not the typist)

You are running as Opus 5. Your job is to think, decide, verify, and delegate — not to hand-write
every line of boilerplate. Sonnet 5 subagents do the volume work under your instructions.

### The split

**You (Opus 5) always do, never delegate:**
- Reading and understanding this runbook, and all planning and sequencing.
- **Everything in Batch A.** Authorization and RLS are where a plausible-looking wrong answer is
  most expensive. Write those policies and role checks yourself.
- The **fix-004 notification type audit** — the exhaustive enumeration across triggers, enums, and
  the renderer. Sonnet may write the copy strings afterward *from your table*; it must not build
  the table.
- Every **root-cause diagnosis**: fix-026, fix-036, fix-011, fix-015. Finding *why* something is
  broken is the hard part; applying the fix afterward can be delegated.
- **All migration SQL** — writing it, applying it, and verifying it.
- Every **decision the spec left as a default**, and every log entry recording one.
- The **per-batch verification gate**: lint, build, browser check, commit.

**Delegate to Sonnet 5 subagents (`Agent` with `model: "sonnet"`):**
- Mechanical, well-specified edits with a clear before/after: fix-007, fix-008, fix-012, fix-013,
  fix-017, fix-021, fix-032, fix-035, fix-038.
- Repetitive multi-file sweeps once you've defined the pattern — e.g. applying the fix-017 capsule
  layout across every call site, or swapping every date input onto the fix-014 component after
  *you* have designed that component.
- Writing the notification copy strings for fix-004 from your finished audit table.
- Boilerplate scaffolding: dialogs, form fields, and Server Action shells that follow an existing
  pattern you point them at.
- Codebase reconnaissance you need breadth on — "find every form with a location field"
  (fix-025 step 1), "list every place a date/time is set" (fix-014) — use the `Explore` agent for
  these.

**How to delegate well.** A subagent starts cold and cannot see this conversation. Every task
prompt must be self-contained: the exact files, the exact change, the pattern to copy (name a
real file to imitate), the acceptance criteria, and an explicit "do not touch anything else."
Run two or three independent delegations in parallel where they don't share files — never in
parallel where they'd edit the same file.

**Review everything that comes back.** A subagent's report is a claim, not a fact. Read the diff
before you accept it. If it's wrong, fix it yourself rather than round-tripping — a second cold
start usually costs more than doing it directly.

**When not to delegate.** If a task is faster to do than to specify, do it. Delegation earns its
cost on volume and repetition, not on single small edits.

### Effort switching

Raise and lower your own reasoning effort deliberately as you move through the run:

| Effort | Use it for |
|---|---|
| **High** | Batch A in full; the fix-004 audit; fix-006's schema design; fix-026 and fix-036 diagnosis; any migration touching RLS; any moment the build breaks and the cause isn't obvious. |
| **Medium** | Designing shared components (fix-014, fix-025), fix-028's thread conversion, fix-009, fix-029, and writing subagent task prompts. |
| **Low** | Dispatching and reviewing mechanical delegations, log writing, commits, and Batch C in general. |

Drop to low when the work is bookkeeping; go straight back to high the moment you hit anything
security-related, anything you're diagnosing rather than applying, or anything that surprised you.
Do not coast at low effort through Batch A or the migrations — that is exactly where cheap
reasoning produces confident, wrong policies.

### Budget awareness

38 fixes will exhaust context and the session will compact. Defend against that:
- Delegation is your main context lever — a Sonnet subagent reading twelve files and reporting a
  three-line summary keeps those twelve files out of *your* window. Prefer delegating
  wide-but-shallow reading.
- Write the log entry the moment a fix is done. The log survives compaction; your working memory
  does not.
- After any compaction, re-read `FIXES-FINAL-LOG.md` first to re-establish where you are, then
  continue from the first fix not marked DONE/PARTIAL/BLOCKED.

---

## Execution order

Do the batches in this order. Within a batch, order doesn't matter much, but do the listed order
where one fix feeds another.

| # | Batch | Fixes | Rationale |
|---|---|---|---|
| A | Security & broken flows | 023, 031, 024, 026 | Live authorization holes + the dead join-request flow. Highest value, riskiest — do it while the session is freshest. |
| B | Notifications | 004 → 005 → 006 → 007 | 004's type audit feeds 005 and 006. **Strictly in this order.** |
| C | Branding & icons | 001, 002, 012, 020, 021 | Mechanical asset/token swaps, low risk. |
| D | Chat surface | 037, 038, 008, 028, 018, 019 | All concentrated in `src/components/chat` + discover groups; batching avoids repeated re-reads. |
| E | Community cards & manage | 029, 027, 030, 017 | Depends on A being done (role checks) — 030's delete must respect the owner-only rule from 031. |
| F | Profile & forms | 015, 032, 033, 034, 035, 036, 009 | Profile edit cluster + post editing. |
| G | Map, pickers & misc | 011, 010, 025, 014, 013, 016, 022, 003 | 025 depends on 010's place list and 014's picker. |

---

# The fixes

## Batch A — Security & broken flows

### fix-023 — **Critical:** Manage tab is owners/moderators only
Right now **every** member of a community or chat room can see and use the Manage tab. Only owners
and moderators may. Treat this as a proper authorization fix, not a UI hide:

1. **Server-side first.** Every Manage-related Server Action and route handler (edit community,
   cover upload, member access, kick/ban, review posts, announcements, join-request queue,
   settings, delete) must re-check the caller's role and reject otherwise. Read
   `src/components/communities/` and the corresponding actions.
2. **RLS.** Verify the underlying tables' policies actually enforce owner/moderator for these
   writes. Anything relying on the UI alone gets a migration — write and apply it.
3. **Routing.** The `/manage` segment 404s for non-privileged members (reuse fix-022's screen if
   that's done; otherwise `notFound()`).
4. **UI last.** Hide the Manage tab in `src/components/communities/tabs/` and `space-shell.tsx`
   for plain members and followers.

**Log:** a table of action → who can call it now → enforced at (RLS / action / both), plus any
other member-visible surface that lets a plain member mutate community state.

### fix-031 — Chat room Manage restricted to owners
Same class of bug, for **chat rooms**: every member currently reaches Manage; only the room
**owner** should. Server Action → RLS → UI, same as fix-023. Note the deliberate difference:
communities allow owner *and* moderators; chat rooms are **owner-only**.
**Default if rooms turn out to have a moderator concept:** owner-only still — moderators of a room
get read access to Manage but no mutations. Log it. Same action/enforcement table in the log.

### fix-024 — Only the owner appoints officers
Restrict officer appointment and all role changes to the community/society **owner**. Moderators
and officers must not appoint. Server action check → RLS policy → UI, same defence-in-depth. See
the society officer-role code (member-access components + the officer-role migration).
**Defaults:** the owner *can* demote officers; an officer *can* resign their own role. Implement
both.

### fix-026 — Join requests for communities and chat rooms are broken
Owners are receiving no join requests. Debug end to end and state the root cause in the log before
the fix:

1. Does pressing Join actually insert a row? `src/components/communities/request-join-button.tsx`
   and its Server Action.
2. Does the INSERT survive RLS for the requesting user?
3. Does the owner's queue read it? `src/components/communities/join-request-queue.tsx` + the
   owner's SELECT policy.
4. Is the notification trigger firing for the owner?
5. Fix whichever layer is broken (most likely an RLS policy or a wrong join in the queue query);
   write and apply the migration if it's a policy.
6. **Verify the whole flow in the browser:** request → owner sees it in Manage → owner gets a
   notification → accept → membership created → requester notified. Screenshot it.

---

## Batch B — Notifications (strict order)

### fix-004 — Write real copy for every notification type
Notifications render vague placeholder text ("New notification") for several types.

1. **Audit first.** Enumerate every notification `type` the system can emit — DB triggers and
   functions in `supabase/migrations/` (`notify_comment`, like notifiers, community message/
   request notifiers), the notifications table's type enum/check constraint, and the renderer in
   `src/components/notifications/activity-list.tsx`. Build a table: type → currently catered? →
   current copy. **Note: check the LATEST redefinition of each trigger function before editing —
   earlier migrations get superseded.**
2. **Write copy** for every uncatered type. Covers at minimum: post replies, comment replies,
   likes on posts, likes on comments, @-mentions, community/chat-room messages, community join
   requests, join request accepted/rejected, discover match, discover team join request +
   accepted, help request offers/approvals, officer appointment, badge granted, moderation/appeal
   outcomes, system/admin announcements.
3. **Copy rules:** one line, ≤ ~90 chars, actor name first, present tense, concrete noun
   ("Ali replied to your comment", "Your join request for CS Society was approved"), include the
   target's title/snippet where available. No "New notification" fallbacks.
4. **Centralize** in `src/lib/notifications/copy.ts` with an exhaustive `switch` over the type
   union so TypeScript fails the build when a new type is added without copy.
5. Put the before/after table in the log.

### fix-005 — Every notification deep-links to the right page
Tapping a notification must land on the exact relevant screen, for **every** type.

1. Use fix-004's audit. Derive each destination yourself from the routes under
   `src/app/(student)/` — post like/comment/reply → post detail anchored to the comment; mention →
   the post/comment containing it; community message → that community's chat thread; join request
   → the community's Manage → requests queue; request approved → the community page; discover
   match → the match's chat; help offer → that help request's detail; badge → own profile badges.
2. Add `notificationHref(notification)` to the same module as fix-004, exhaustive over the type
   union.
3. Anchored links scroll the target comment/reply into view and briefly highlight it.
4. Mark read on click. The row is a real `<Link>` — keyboard focusable, middle-click works.
5. Log the full type → route checklist, flagging any destination you had to infer.

### fix-006 — Purge notifications for deleted entities
When a notification's subject is deleted, the notification disappears — posts, comments, replies,
communities, chat rooms, discover posts, help requests, events, anything.

- **Preferred:** notification rows reference their subject with a real FK + `ON DELETE CASCADE`.
  Inspect the current schema; if it stores loose ids/JSON, write the migration that adds proper
  references or per-subject delete triggers. Apply it.
- Handle soft-deletes: filter those out in the read path.
- Defensive guard in the read query so an orphan never renders even if one slips through.
- Unread counter and bell badge must recompute correctly — no phantom counts.
- Log the migration number and a SQL snippet proving zero orphans remain (run it).

### fix-007 — Match notification icon should be the lightning bolt
The "match" notification type renders a star. Change it to the lightning/flash icon (lucide `Zap`,
matching the bolt used elsewhere for match/discover). Same size and color treatment as the other
notification type icons. `src/components/notifications/activity-list.tsx` and its icon map.

---

## Batch C — Branding & icons

### fix-001 — Brand the auth panels with the real logo
Replace the lightning-bolt glyph + "Fast Socio" wordmark in **all** auth panels — login,
create-account/signup, forgot-password (`src/app/(auth)/`, `src/app/auth/`, plus any shared auth
header/card they import) — with the actual logo asset from `public/brand/`.
**Default:** use `logo.png` if it's the full lockup; inspect both `logo.png` and `logo1.png` and
pick the one that reads correctly at ~180px wide on a card. Log which and why.
`next/image`, explicit width/height, `priority` on the LCP panel, `alt="Fast Socio"`. Remove the
dead text wordmark and icon. Keep vertical rhythm — the logo occupies roughly the block the old
icon+text pair did, centered, correct in light and dark. Screenshot every auth route.

### fix-002 — Correct the map and notification icons on Home
On the Home header (`src/app/(student)/home/` + its header/action-bar component):
1. **Map button** → plain map *marker*/pin only (lucide `MapPin`), no paper/fold shape.
2. **Notifications button** → standard bell (lucide `Bell`).
Keep icon size, stroke width, tap-target size, and unread-badge positioning unchanged.
**Default:** leave `src/components/floating-dock.tsx` alone — this fix is the Home header only.
Log any other place referencing the old icons.

### fix-012 — Strip "SOCIO" from discover card name capsules
Discover swipe cards render "SOCIO" in front of the person's name in the top-left capsule. Remove
the prefix; show just the name. `src/components/discover/swipe-deck.tsx` and `intent-card.tsx`.
Keep the capsule shape, padding, background; drop the prefix text and its separator/icon if that
existed only to prefix the name. Verify long names truncate cleanly with the reclaimed width.

### fix-020 — Discover chats use the app icon, not the wordmark
Discover-created group chats show the "Fast Socio" logo/wordmark as their avatar; they should show
the app **icon** — the lightning bolt mark. `src/components/discover/discover-group-avatar.tsx`.
**Default:** render an inline bolt glyph on a brand-purple circle rather than scaling down a PNG —
it stays crisp at 32–48px. If a dedicated bolt asset exists in `public/brand/` or `public/icons/`,
prefer that. Fix it everywhere the avatar appears: inbox list, thread header, notification
thumbnails.

### fix-021 — Community & chat-room capsules go purple
The Community and Chat-room type capsules should be brand **purple**. Update the capsule
variant/token, not a hardcoded hex, so light and dark stay correct and contrast is AA.
**Default:** if the capsule types are currently color-coded to distinguish community vs chat room,
keep them distinguishable by *label/icon* and make both purple — flattening the color is what was
asked. Log that you did.

---

## Batch D — Chat surface

### fix-037 — No decorative frames around chat attachments and posts
We draw a wrapper card/border *around* image attachments and shared posts — a redundant outer
frame with padding. Remove it: **the element's own border is the border.**
- The image *is* the bubble — rounded corners on the image itself, no outer padded container, no
  extra background, no double border.
- Same for `shared-post-preview.tsx`: the preview card's own edge is the boundary; drop the
  enclosing wrapper.
- Keep the message max-width, own-vs-other alignment, and timestamp placement.
- Both `chat-thread.tsx` and `community-thread.tsx`; both themes. Before/after screenshots.

### fix-038 — Remove search in chat
Delete the search input/icon from the chat inbox (`src/components/chat/inbox-list.tsx`) and any
in-thread search, along with its state, debounce, query params, and any server-side search action
or RPC nothing else uses. Re-balance the header so it doesn't look like something was ripped out.
Confirm no other feature (discover, communities, help, map) shares the removed helper before
deleting it.

### fix-008 — Drop the paperclip on shared posts in chat
When a post is shared into a conversation we render a paperclip/attachment icon alongside it.
Remove it — the preview card speaks for itself. `src/components/chat/shared-post-preview.tsx` and
the message renderers. Reclaim its horizontal space so the preview aligns flush with other message
content. **Do not** remove attachment icons for real file attachments — only the shared-post case.

### fix-028 — Broadcast announcements as a chat window
Community broadcast announcements are standalone cards; convert them to a **chat-window**
presentation: a scrolling thread of announcement messages (newest at the bottom, like our chat
threads), composer at the bottom for those allowed to post, timestamp/author per message. Reuse
`src/components/chat/community-thread.tsx` patterns (scroll anchoring, realtime subscription,
grouping consecutive messages by author) rather than building new. Who-can-post rules unchanged
(officers/owner). Delete stays reachable from a long-press/⋯ on each message (see fix-027).
Read/unread and the announcement notification must still behave.

### fix-018 — Replace anonymous posting with media in discover groups
In groups created via Discover, remove "post anonymously" and replace it with media attachment.
- Remove the anonymous toggle from the composer; stop persisting/reading the anonymous flag for
  these groups. Author always shown.
- Add an image-upload control to the composer following the existing chat media-upload pattern
  (same bucket, compression/size limits, preview + remove affordance).
- **Default for legacy rows:** keep showing "Anonymous" for messages already posted that way —
  retroactively unmasking an author who was promised anonymity is not acceptable. Log it.
- **Do not** touch anonymity in Campus Help — anonymous helpers there are intentional.

### fix-019 — Members can leave a discover group chat
Members of a Discover-created group chat have no way out; only the owner gets Delete. Add
"Leave group" for non-owner members, mirroring the owner's affordance.
- Same overflow menu as the owner's Delete (`src/components/discover/discover-group-menu.tsx`).
  Owner sees Delete; non-owner members see Leave. Never both.
- Confirm dialog ("Leave <group name>? You'll stop receiving its messages."), destructive styling.
- Server Action removes the membership row; add/verify an RLS DELETE policy letting a user delete
  only their own membership. Migration if needed — write and apply.
- After leaving: redirect out of the thread, remove it from the inbox immediately.
- **Default for the owner:** block the owner from leaving, with a clear message telling them to
  delete the group instead. No ownership transfer in this pass.

---

## Batch E — Community cards & manage

### fix-029 — Community chat card = full cover photo background
Redesign the community/chat-room card (`src/components/communities/chat-room-card.tsx` and the
community card variants) to this layout:
- The **entire card background is the cover photo**, edge to edge, no letterboxing, no inner
  padding frame. `next/image` with `fill` + `object-cover`.
- Bottom gradient scrim so text stays legible over any photo.
- **Bottom-left:** name, with member count beneath or beside it.
- **Bottom-right:** **Follow** and **Join** capsules side by side, solid/glassy enough to read
  over the photo.
- No-cover fallback: brand gradient, not a broken image.
- Follow ≠ join semantics unchanged (`follow-join-buttons.tsx`) — this is layout/skin only.
- Card body still opens the space; the buttons must not trigger navigation.
Before/after screenshots.

### fix-027 — Better UI for deleting an announcement
The announcement-card delete UI is ugly. Redesign: overflow (⋯) menu on the card instead of a bare
exposed button → "Delete announcement" in destructive red → the app's standard confirm dialog
("Delete this announcement? This can't be undone.") with a loading state on confirm and optimistic
removal. **Find and reuse the existing delete-confirm component** rather than writing a new dialog.
Announcement components: `src/components/communities/` and
`src/components/notifications/announcement-modal.tsx`.

### fix-030 — Delete a chat room from Manage
Add chat-room deletion to the room's Manage tab, **owner only** (consistent with fix-031).
- "Delete chat room" in a Danger Zone at the bottom of Manage, destructive styling.
- Confirm dialog requiring the room name to be typed — this is irreversible. Match the destructive
  confirm pattern already used for Discover group delete.
- Server Action: owner check, then cascade or explicitly clean up messages, memberships, join
  requests, and notifications pointing at the room (ties into fix-006). Migration for cascades if
  needed — write and apply.
- After delete: redirect to the communities/chat list, remove from every member's inbox
  (realtime), toast.

### fix-017 — Capsules render right of the group name
The Discover and Community capsules must always render on the **right** of the group name, never
the left. Everywhere they appear: chat inbox rows (`src/components/chat/inbox-list.tsx`), thread
headers, community/chat-room cards, discover group headers. Consistent layout — name flexes and
truncates, capsule pinned right with a fixed gap, capsule never shrinks. Verify with long group
names that the capsule stays visible and the name ellipsizes.

---

## Batch F — Profile & forms

### fix-015 — Fix focus stealing in the "+ skill" input
Typing a skill and pressing Enter/Next adds the chip but then moves the cursor into the *next
section's* text box. Focus must stay in the skill input.
- `src/components/profile/edit-profile-form.tsx` and any other use (onboarding).
- Root cause is almost certainly Enter submitting/blurring: `preventDefault()` on Enter, add the
  chip, clear the input, explicitly re-focus it.
- Enter inside this field must never submit the whole form.
- Same behaviour for the interests chip input if it shares the component (see fix-033).

### fix-032 — Overlay the camera icon on the profile picture
In Me → Edit, the change-profile-picture camera button sits *inside* the avatar circle. Move it to
**overlay the avatar's bottom-right corner**, half-hanging off the edge — a small circular button
ringed in the app background so it reads as a badge on the avatar. Tap target ≥40px, keyboard
accessible with a proper label. Make sure it isn't clipped by any `overflow-hidden` on the avatar
wrapper (the image keeps its own clip; the button sits outside it). Before/after screenshot.

### fix-033 — Interests: minimum 3, no maximum
In profile edit (and onboarding if it shares the field):
- **Minimum 3** required — block save with an inline message ("Pick at least 3 interests").
- **No maximum** — remove any cap and any "max reached" messaging.
- **Expand the catalogue substantially.** Read the current list, then add options across
  academic, tech, sports, arts, gaming, social/campus, career, and hobbies. **Default: add ~40–60
  new options**, campus-appropriate for FAST NUCES, no duplicates, consistent casing with the
  existing entries. List everything you added in the log.
- The picker must still scroll/wrap well with a large selection; fix-015's focus behaviour applies
  here too.
- Check nothing downstream (matching, discover scoring, profile display) assumes a fixed count.

### fix-034 — Gender is required
Required in **both** account creation/onboarding and the profile edit panel.
- Onboarding: cannot advance past that step without picking one.
- Edit panel: cannot save with it empty.
- Validate server-side (Server Action / zod schema), not just in the UI.
- **DB default:** count existing NULL rows first. If the count is 0, add `NOT NULL` via migration
  and apply it. **If it is greater than 0, do NOT add the constraint** — leave the column nullable,
  enforce at the application layer only, and log the null count so I can decide on a backfill.
- Keep the existing option set and the gender-dependent avatar defaults
  (`public/brand/boy.webp` / `girl.webp`).

### fix-035 — Remove Recent Activity from the Aura breakdown
On the profile, in the Aura breakdown, remove the "Recent Activity" functionality entirely — the
list, its data fetch, and now-dead helpers/queries. Keep the rest of the breakdown intact and
re-flow so there's no leftover gap or orphaned heading. `src/components/profile/` and the profile
route's data loader. Confirm no other screen reads that same query before deleting it.

### fix-036 — Post count stat is always zero
The profile post-count stat is permanently 0.
- Find where it's computed (profile stats tab / profile data loader) and inspect the actual query.
- Check in order: counting the wrong table/column; a filter excluding everything (status/
  visibility flag); an RLS SELECT policy hiding rows from the counting context; a `count` on a
  joined relation returning null. **Verify with a direct SQL query** against the DB for a known
  user with posts — put both the wrong and corrected results in the log.
- Correct on **both** your own profile and someone else's public profile. **Default semantic:**
  own profile counts all your non-deleted posts; a public profile counts only posts the viewer can
  see. Log it.
- Policy or index needed for performance → write and apply the migration.

### fix-009 — Edit your own posts
Add "Edit" alongside "Delete" in the post options menu for posts the current user owns.
- **Scope:** text/body only (and existing caption). Media unchanged.
- **UI:** Edit item in the post overflow menu → inline editor or a compact sheet consistent with
  existing edit surfaces; Save / Cancel; optimistic update.
- **Server:** Server Action validating ownership, applying the same content validation as the
  create path, setting `edited_at`. Add the column via migration if absent, with an RLS `UPDATE`
  policy scoped to `author_id = auth.uid()` and only the body column mutable. Write and apply.
- **Indicator:** when `edited_at` is set, render a small "edited" capsule at the **bottom-right of
  the post, inline with the Share option** — styled like our other micro-capsules, muted.
- Feed posts and post detail. **Default:** comments and community posts are out of scope this
  pass; log them as a follow-up.

---

## Batch G — Map, pickers & misc

### fix-011 — Deduplicate the map's info/undo icons
On the campus map (`src/components/map/campus-map-experience.tsx` / `campus-map-viewer.tsx`) the
`[i]`-style icon and the curved-arrow (reset/undo) icon do the same thing. Confirm by reading the
handlers, then remove one — **default: keep whichever label matches what the handler actually
does**, and delete the other button plus its dead state/handler. Re-balance the control cluster
spacing. Log which you kept and what the action is.

### fix-010 — Add more places to the campus map
Extend `src/lib/map/places.ts` (currently ~21 pins over `public/map.png`).
- Log the existing places with coordinates and types first.
- Add FAST NUCES Islamabad locations — cafeterias, labs, department offices, auditoriums, sports
  facilities, parking, mosque, medical room, bank/ATM, photocopy shop, hostels, gates — grouped by
  the existing `type` categories; add a new category only if genuinely needed (and wire its filter
  chip + icon).
- **Coordinates:** I'm asleep, so infer positions from neighbouring pins and the map image, and
  add each new pin with a `// TODO: verify position` comment. In the log, list every new pin under
  a **"Pin coordinates needing my verification"** heading so I can nudge them in the morning.
  Wrong-but-close is fine; missing is not.
- Search index, filter chips, and detail card must work for all new pins.

### fix-025 — Pin a location on the map from any form with a location field
Any form with a location field should let the user pin it on the campus map, not only type text.
1. Find every form with a location/venue input — discover post fields, event creation, help
   request, society events, community settings. List them in the log.
2. Build one shared `LocationPicker`: the existing viewer (`campus-map-viewer.tsx`) in a sheet,
   tap to drop a pin, snap to a known place from `places.ts` when close, plus the existing
   free-text field for anything off-map.
3. Persist both the text label and the coordinates. Add columns via migration where missing —
   write and apply. Existing text-only rows keep working.
4. Where a location is displayed, make it tappable → opens the map focused on that pin.
5. Reuse the map's existing zoom/pan behaviour — do not fork the viewer.

### fix-014 — Restyle the date & time picker
The set-date-and-time control looks like a raw browser default and clashes with the app.
- Find every place a date and/or time is set (`src/components/discover/post-intent-fields.tsx`,
  event creation, anywhere else — grep `type="datetime-local"`, `type="date"`, `type="time"`).
- Build one shared `src/components/ui/date-time-field.tsx`: glass surface, brand purple accents,
  rounded corners, our type scale, dark-mode correct, keyboard accessible, mobile-friendly, clear
  "no date set" state.
- Swap all call sites onto it, keeping the same value contract (ISO string) so no server code
  changes.
- Screenshot in light and dark.

### fix-013 — "Back to Discover" as a purple capsule button
On `src/app/(student)/discover/post/`, the "Back to Discover" text link becomes a purple capsule
button — full pill radius, brand purple, correct text contrast, hover/active states, tap target
≥40px. Keep the chevron/arrow if present, sized to match. **Reuse an existing button variant from
`src/components/ui/`** rather than hand-rolling styles if one fits.

### fix-016 — Give "Create group" its own button in Smart Discover
"Create group" is buried inside the Close/dismiss control. Pull it out.
- `src/components/discover/discover-post-manager.tsx` and the "Your post" card.
- Add a distinct, obviously-tappable "Create group" button on the Your-post card, visually
  separate from Close/dismiss. Close does nothing but close.
- **Make the Your-post card bigger if needed** to fit both actions comfortably — don't cram them.
- Capsule styling consistent with fix-013.

### fix-022 — Friendly "page unavailable" screen
When a user navigates to something deleted or unavailable, show **"We are sorry, this page is
unavailable."**
- Add/replace the global `not-found.tsx` and segment-level not-found handling for routes that can
  404 on deleted content: post, profile, community, chat room, discover post, help request, event,
  society.
- Make the data-fetch paths actually call `notFound()` on a missing/soft-deleted/no-access row
  instead of throwing or rendering an empty shell.
- Design: centered glass card, the message, a purple capsule button to Home plus a secondary "Go
  back". Theme-aware, never the raw Next default.
- Cover "you no longer have access" (e.g. removed from a private community) with the same screen —
  don't leak whether the thing exists.

### fix-003 — Remove Filters from Campus Help → SOCIO
In Campus Help (`src/app/(student)/help/` + `src/components/help/`), remove Filters **from the
SOCIO tab only**. The ME tab is untouched.
- Delete the top-right Filters entry point, the filter sheet/panel, and its state for SOCIO.
- Remove now-unused filter query params, server-side filter arguments, and dead helpers — but keep
  code paths the ME tab still uses.
- SOCIO renders the full unfiltered feed by default.
- No TypeScript errors from removed props; ME tab still filters correctly.

---

## Done criteria

The session is finished when:
- All 38 fixes are DONE, PARTIAL, or BLOCKED in `FIXES-FINAL-LOG.md` — none missing.
- `npm run lint` and `npm run build` are green on `fixes-final-batch`.
- Every migration written has been applied and verified, and is listed in the log.
- The `# Summary` section is at the top of the log.
- Nothing has been pushed or deployed.

The summary must also state: which fixes you delegated to Sonnet subagents, and any subagent
output you had to correct or redo — I want to know where the delegation held and where it didn't.
