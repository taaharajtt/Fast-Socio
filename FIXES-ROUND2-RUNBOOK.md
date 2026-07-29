# Fast Socio — Round 2 autonomous runbook (fix-037 → fix-059 + five reopened)

Second unattended run. Covers the new fixes **037–059** plus **five fixes reopened from round 1**
that were not applied correctly (001, 009, 025, 033, 036, and the 006 regression logged as 042).

**How to use this:** launch with the command below, paste **only the KICKOFF PROMPT**, then leave.

---

## Launching the run

Permission prompts are a harness setting — a prompt cannot disable them. Start from your terminal
in `D:\FastSocio`:

```bash
claude --dangerously-skip-permissions --model claude-opus-5
```

This run **applies migrations to production and pushes to `main` at the end**, as you asked.
`main` auto-deploys to `fast-socio.vercel.app`, so the final push ships to real users with no
human review in between. That is the instruction and the runbook follows it — I'm noting it once
so it's a decision and not a surprise. The guardrails in Operating rule 9 are the only brake, and
they're instructions rather than enforcement.

---

## KICKOFF PROMPT — paste this, then walk away

```
You are the orchestrator for an unattended overnight run. I am asleep and will not
respond to anything until morning. Do not ask me questions.

FIRST: read D:\FastSocio\FIXES-ROUND2-RUNBOOK.md in full before doing anything else.
It contains 28 fixes (fix-037 to fix-059, plus reopened 001, 009, 025, 033, 036), the
batch order, operating rules, orchestration split, and a stated default for every
judgement call. Follow it exactly.

YOUR ROLE
You are Opus 5. You think, decide, diagnose, and verify. You do not hand-write
boilerplate — you delegate that to Sonnet 5 subagents via the Agent tool with
model: "sonnet". Follow the Orchestration section's split precisely:

  You keep, always: the fix-037 match-percentage formula, the fix-043 deck-visibility
  filtering, fix-042's re-diagnosis of why fix-006 failed, fix-045's admin broadcast
  targeting, fix-051's moderator delete authorization, all migration SQL including
  applying and verifying it, every reopened fix's root-cause analysis, every defaulted
  decision, and the per-batch lint/build/browser/commit gate.

  You delegate: the copy and chrome fixes (038, 039, 040, 046, 047, 048, 053, 054,
  055, 059), repetitive sweeps once YOU have defined the pattern, boilerplate
  following an existing pattern, and wide codebase reconnaissance (use Explore).

Every subagent prompt must stand alone — exact files, exact change, a real file to
imitate, acceptance criteria, and "do not touch anything else." Run independent
delegations in parallel; never two on the same file. Read every returned diff before
accepting it. If a subagent got it wrong, fix it yourself rather than re-delegating.

EFFORT
Manage your own reasoning effort deliberately, and note in the log when you shift:
  HIGH   — fix-037 formula design, fix-043 privacy filtering, fix-042 re-diagnosis,
           fix-036 and fix-009 (both failed once already — find the REAL cause this
           time), fix-051 authorization, every RLS migration, and any build break
           whose cause isn't immediately obvious.
  MEDIUM — the chat composer rebuild (050/058/059/052), fix-049, fix-057, fix-056,
           fix-045, fix-044, and writing subagent task prompts.
  LOW    — dispatching and reviewing mechanical delegations, log writing, commits.

Do not coast at low effort through the reopened fixes. They were marked done once and
were not done. Whatever reasoning produced that result is the reasoning to avoid.

EXECUTION
Branch first: git checkout -b fixes-round2. Work through batches A to F in the
runbook's order. After each batch: npm run lint, npm run build, browser-verify the
visible changes, commit with the fix numbers in the message.

Apply every migration you write to the production database via the Supabase MCP and
verify it took effect. At the very end, after all batches are green, merge to main and
push — see Operating rule 10 for the exact sequence and its preconditions.

Write the FIXES-ROUND2-LOG.md entry immediately after each fix completes — not at the
end. It is the only thing that survives a context compaction. If you compact, re-read
that log first, then resume at the first fix not marked DONE / PARTIAL / BLOCKED.

A fix you cannot complete gets marked BLOCKED with the reason, and you move on. One
bad fix must not cost me the other 27. Keep going until all 28 have a status.

Finish by writing the # Summary at the top of the log: done/partial/blocked counts,
migrations applied, commits, whether the push to main happened, what you delegated and
where delegation failed, and the top 3 things needing my attention.

Start now. Begin with Batch A at high effort.
```

---

## Operating rules

**Environment.** Repo `D:\FastSocio`, Next.js 16 App Router PWA + Supabase, Windows/PowerShell.
Read `node_modules/next/dist/docs/` before using any Next API you're unsure of. Layouts stay
non-async (Cache Components / PPR is on). Keep the existing design tokens and glass/purple
aesthetic.

**1. Branch first.** `git checkout -b fixes-round2`. All work lands there until rule 10.

**2. Never block on me.** Every fix states a default for every judgement call. Take it, log one
line explaining it, move on.

**3. Migrations: write AND apply.** Next numbered file in `supabase/migrations/`, applied to
production via the Supabase MCP `apply_migration` tool, then verified. `check_function_bodies`
masks column errors — verify functions by *executing* them, not just creating them. Log every
number applied. If an apply fails, revert the local file, mark BLOCKED, continue.

**4. Commit per batch.** After each batch: `npm run lint`, `npm run build`, browser-verify, then
commit listing the fix numbers. Do not push mid-run — the push happens once, at the end.

**5. Build breaks are a per-batch stop condition.** Revert the smallest breaking change, mark that
fix BLOCKED, get green, commit the rest, continue.

**6. Verify visually.** `preview_start` the dev server, use the browser tools, screenshot
before/after for every visual fix into `.fix-screenshots/`, reference them in the log.

**7. Running log.** Append to `FIXES-ROUND2-LOG.md` immediately after each fix:

```markdown
## fix-0NN — <title>
Status: DONE | PARTIAL | BLOCKED
Files: <paths touched>
Migration: <number applied, or none>
Decisions: <default taken, and why>
Verified: <how>
Notes: <anything I need to know>
```

**8. Scope discipline.** Adjacent bugs go under `## Observed, not fixed` at the bottom. Do not fix
them.

**9. Destructive boundary.** You may create/alter tables, policies, functions, columns. You may
**not** drop tables, delete production rows, or run `DELETE`/`TRUNCATE` without a `WHERE` you have
first tested as a `SELECT`. No `--force` anything. No Vercel env or production config changes.

**10. Final merge and push to main — last action of the session.**

Preconditions, all of which must hold; if any fails, stop and leave everything on the branch with
a `PUSH SKIPPED` note at the top of the log explaining which precondition failed:
- `npm run lint` and `npm run build` both green on the final tree.
- No fix is in PARTIAL state with a half-applied migration.
- Every migration written has been applied and verified.
- At least 24 of the 28 fixes are DONE. Fewer than that means something went systematically wrong
  and I want to look before it ships.

Then:
```bash
git checkout main
git merge --no-ff fixes-round2 -m "feat(round2): fixes 037-059 + reopened 001, 009, 025, 033, 036"
git push origin main
```
Do not force-push. Do not delete the branch — I want it for reference. If the merge conflicts,
stop, leave `main` untouched, and log it.

**11. Morning summary** at the top of the log: counts, migrations, commits, push status, what you
delegated and where it failed, top 3 things needing my attention.

---

## Orchestration

You are Opus 5. You think and decide; Sonnet 5 subagents type.

**You always keep:** the fix-037 formula design, fix-043 privacy filtering, fix-042's
re-diagnosis, fix-045's targeting logic, fix-051's authorization, all migration SQL, all
root-cause work on the five reopened fixes, every defaulted decision, and the per-batch gate.

**Delegate to Sonnet 5** (`Agent`, `model: "sonnet"`): the copy/chrome fixes (038, 039, 040, 046,
047, 048, 053, 054, 055, 059), multi-file sweeps once you've defined the pattern, boilerplate
following a pattern you point at, and breadth reconnaissance (`Explore`).

**Delegate well.** Subagents start cold. Self-contained prompts: exact files, exact change, a real
file to imitate, acceptance criteria, "do not touch anything else." Parallelize independent tasks;
never two on one file. Review every diff — a report is a claim, not a fact. Wrong output gets
fixed by you, not re-delegated.

**Don't delegate what's faster to do than to specify.**

**Context budget.** Delegation is your main lever — a subagent reading twelve files and returning
three lines keeps those files out of your window. Log after every fix; the log survives
compaction, your working memory doesn't. After compaction, re-read the log, resume at the first
fix without a status.

---

## Execution order

| # | Batch | Fixes | Rationale |
|---|---|---|---|
| A | Reopened regressions | 042, 036, 009, 033, 025, 001 | These were marked done and weren't. Do them first, at high effort, with real verification. |
| B | Matching & visibility logic | 037, 043, 041 | Pure logic + privacy. 043 is a data-exposure fix. Do before the UI work. |
| C | Chat composer rebuild | 050, 058, 059, 052, 057, 051, 049 | One coherent rebuild of the composer across community / chat room / discover. Doing them separately means three rewrites. |
| D | Theme & admin | 044, 045 | 044 touches every surface; do it while context is still clean. |
| E | Chrome & copy | 038, 039, 046, 047, 048, 053, 054, 055, 040 | Mostly delegable. |
| F | Matches page | 056 | New route, self-contained, safe to land last. |

---

# Batch A — Reopened regressions

> These six were reported fixed and are not. For each: **find the actual root cause before
> writing any code**, state it in the log, and verify the fix in the browser — not by reading the
> diff and assuming. A second failure on these is worse than the first.

### fix-042 — fix-006 did not work; notifications for deleted things still arrive
Reported: posted an announcement, deleted it, still got notified for it.

- Re-diagnose fix-006 from scratch. Do not assume the previous implementation's approach was
  sound; read what was actually shipped and find where it fails.
- Likely gaps: the cascade/trigger covered posts and comments but not announcements, join
  requests, or community/room messages; or the notification was already delivered/pushed before
  deletion and only the DB row was cleaned; or the read path doesn't filter soft-deleted subjects.
- **Scope is literally everything:** announcements, join requests, posts, comments, replies,
  likes, mentions, discover posts, help requests, events, communities, chat rooms, matches — every
  notification whose subject is deleted, removed, or has gone inactive must vanish from the panel
  and from the unread count.
- Build a **generic** mechanism, not another per-type patch: a subject-reference column with
  proper FKs and `ON DELETE CASCADE`, plus a read-path guard that drops any notification whose
  subject no longer resolves. Migration written and applied.
- **Verify by reproducing the exact report:** post an announcement → confirm the notification
  exists → delete the announcement → confirm the notification is gone from both the panel and the
  badge count. Screenshot both states. Repeat for a join request and a post comment.

### fix-036 — post count in stats is still zero
Still not fixed. Start over.

- Do **not** trust the previous diagnosis. Query the database directly for a known user with
  posts, then trace the exact code path the profile stat uses, comparing what it returns against
  the true count at every layer.
- Check specifically: is the counting query running as the *viewer's* role, so RLS hides the
  author's posts? Is it counting a view (`feed_posts`) that filters rows out? Is a
  `status`/`visibility`/`deleted_at` predicate excluding everything? Is `count` on a joined
  relation returning null and being coerced to 0?
- Log the wrong value, the true value, and the precise line responsible.
- **Verify in the browser** on both your own profile and another user's, with a real account that
  has posts.

### fix-009 — edit post doesn't open; two stacked slider windows
The Edit option is unreachable because two sliding sheets stack on top of each other.

- **Required behaviour:** pressing Edit in the *first* sheet closes that sheet and establishes
  **inline editing on the post itself** — the post body becomes editable in place in the feed,
  with Save / Cancel. No second sheet at all.
- Remove the second slider entirely; don't try to fix its z-index or stacking.
- Keep everything else from the original fix-009: ownership-checked Server Action, `edited_at`,
  and the small muted "edited" capsule at the bottom-right of the post inline with Share.
- **Verify by actually clicking Edit** on your own post in the browser and saving a change.

### fix-033 — interests must not be a scrollable box inside the edit card
The expanded interest list was put in a scrollable element inside the edit card. Wrong.

- **Extend the edit card itself** and lay the interests out on it — the page scrolls, the interest
  region does not. No inner scroll container, no fixed-height box.
- Chips wrap naturally across as many rows as needed; the card grows to fit.
- Keep min-3 / no-max validation and the fix-015 focus behaviour.
- Screenshot the full expanded card.

### fix-025 — location pinning was not applied
Not implemented. Do it properly this time.

- **Target forms explicitly:** the **event** and **sports** forms in Discover's post flow, plus
  every other form with a location field. Find them all and list them in the log.
- The user taps a marker on the campus map to pin a location; the pin is saved with the post.
- **Viewers must be able to see it** — the location renders on the post/card and tapping it opens
  the map focused on that pin. This half was missing before; it is not optional.
- Shared `LocationPicker` built on `src/components/map/campus-map-viewer.tsx`, snapping to known
  places from `src/lib/map/places.ts` when close. Persist both label and coordinates; migration
  written and applied.
- **Verify end to end:** create an event post with a pinned location as one user, view it as
  another, tap through to the map.

### fix-001 — logo at 150%
The auth-panel logo is too small. Render it at **150% of its current size** across login,
create-account, and forgot-password. Keep it centered, keep aspect ratio, keep `next/image` with
updated explicit width/height (not CSS scaling of a small intrinsic size — bump the rendered
dimensions so it stays sharp). Screenshot all three panels.

---

# Batch B — Matching & visibility logic

### fix-037 — match percentage formula
Replace the current match percentage with a real, explainable formula. **Design it yourself** at
high effort, then document it in the log with a worked example.

Signals that raise the percentage:
- **Number of matching interests** — the primary driver; more shared interests, higher score.
- **Opposite gender.**
- **Same semester.**
- **School:** same school scores lower than different school (`same school < different school` —
  cross-school pairings are favoured).
- **Same batch.**

**Defaults:** weight matching interests as the dominant term (roughly half the total weight) with
diminishing returns past ~6 shared interests so someone who picked 40 interests can't max it out;
distribute the remaining weight across the four categorical signals. Normalize to 0–100, never
output 0% or 100% (clamp to 5–99) so the number never reads as broken. Deterministic — the same
pair always yields the same score.

Implement as a single pure function with unit-testable inputs (put it in `src/lib/discover/` and
add tests). If the score is computed in SQL for deck ordering, keep SQL and TypeScript in
agreement and say in the log which is authoritative. Log the final weights table.

### fix-043 — restrict project-partner and FYP posts to the right deck
**Privacy/visibility bug: currently every user can see these.**

- **Project partner** posts appear only in the decks of users with the **same semester, same
  school, and same degree**.
- **FYP** posts appear only in the decks of users with the **same semester, same school, and same
  degree**.
- Enforce in the deck query **and** at the RLS layer — a filtered UI over readable rows is not a
  fix. Migration written and applied.
- Other intent types (hackathon, sports, recruitment) are unaffected.
- **Default:** the post's author always sees their own post regardless of matching.
- Verify with two accounts from different degrees that the post is genuinely absent, not just
  hidden.

### fix-041 — only matches can be tagged as team members
In "post to Discover", the current-team-members tagger must only offer the user's **own matches** —
not all users. Restrict the search/suggestion source to the current user's match list
(`src/components/discover/team-member-mentions.tsx`), and validate server-side on submit that
every tagged user is actually a match. **Default:** if a previously-tagged user is no longer a
match, leave existing posts alone but block new tags. Empty state: "Match with people to add them
to your team."

---

# Batch C — Chat composer rebuild

> 050, 058, 059, and 052 are one job. Build the composer once as a shared component with a
> capability flag per surface, then wire the three surfaces to it. Do not implement them as four
> separate edits.

### fix-058 — the composer's exact shape
**Community and chat-room chat composer**, left to right:
`[ Message... ]` then icon row — **poll**, **post anonymously**, **add media** — then the
**send** button (circular, separate from the icon group).

**Discover chat composer:** `[ Message... ]` then **poll**, **add media**, then **send**. No
anonymous option — that's deliberate and matches the earlier fix-018 decision.

Icons sit inside the field's right edge as a group; send sits outside it. Match the sketch:
grouped icons in a rounded cluster, send as its own circle.

### fix-050 — composer is multi-line
The community, chat-room, and discover composers are single-line; the DM chat composer is
multi-line. Make all three behave like the DM one: the field grows with content up to a max height
(**default: 5 lines**, then it scrolls internally), Enter sends, Shift+Enter inserts a newline, and
the icon row and send button stay vertically aligned to the *bottom* of the grown field.

### fix-059 — placeholder vertically centered
The `Message...` placeholder must render in the **exact vertical centre** of the composer at its
resting single-line height. Fix the line-height/padding mismatch rather than nudging with a
margin. It must stay centered in both light and dark and at every font-size setting. This is the
single most visible detail of the whole composer — check it at 1×, and screenshot it.

### fix-052 — media attachment (pictures only)
Wire the add-media icon in all three surfaces: **images only** (no video, no arbitrary files —
enforce by accept attribute *and* server-side MIME check). Reuse the existing chat image-upload
pipeline — same bucket, same compression and size limits, same preview-with-remove affordance
before send. Uploaded images render per fix-037 of round 1: the image *is* the bubble, no wrapper
frame.

### fix-057 — full-image photo viewer in DMs
Tapping an image in a DM opens a full-screen photo viewer. Build it as a reusable component:
full-bleed image on a dark backdrop, pinch/scroll to zoom, drag to pan, tap or swipe-down or Esc to
close, and the sender's name plus timestamp in an overlay. **Default:** no download button, no
share. Use it for the community/room/discover images from fix-052 too — one viewer, all surfaces.

### fix-051 — owners and moderators can delete any message
In **discover groups, communities, and chat rooms**, owners **and moderators** may delete any
message in the chat; regular members may delete only their own.

- Authorization at the Server Action **and** in RLS — write and apply the migration. Do not gate on
  UI visibility alone.
- Long-press / ⋯ on a message reveals Delete when permitted; confirm dialog; optimistic removal
  with realtime propagation to everyone in the thread.
- **Default:** deleted messages leave a muted "Message deleted" tombstone rather than vanishing,
  so the thread doesn't silently rewrite itself. Also purge any notifications pointing at the
  deleted message (ties into fix-042).

### fix-049 — announcements must be exactly the chat, with the composer as "Post an announcement"
Round 1's fix-028 produced a better window but not the right one. Required layout, per the sketch:

- An **"Open Chat"** capsule button at the top of the announcements view.
- Below it, the announcement thread rendered **exactly like a chat thread** — same message
  bubbles, same alignment, same grouping, same scroll behaviour as `community-thread.tsx`. Not a
  card list, not a variant. The same component where possible.
- At the bottom, the composer, placeholder **"Post an announcement"**, with **image** and **poll**
  icons and the send button — same composer component built in this batch, configured for this
  surface.
- **Polls:** members of the community can vote. Reuse `src/components/communities/poll-card.tsx`
  if it already does this; extend it if not. Live vote counts, one vote per member, voter can
  change their vote (default), results visible after voting.
- Who may post announcements is unchanged (owner/officers). Delete per fix-027's dialog and
  fix-051's rules.

---

# Batch D — Theme & admin

### fix-044 — remove light theme entirely
Dark is the only way to view the app.

- Remove the light theme end to end: the System | Light | Dark control in settings, the
  theme-provider's light branch, `next-themes` mode switching, and every `dark:` conditional that
  only exists to support a light counterpart — collapse those to the dark values rather than
  leaving dead classes.
- Force dark at the root (`<html class="dark">` or equivalent) so nothing can flip it, set
  `color-scheme: dark`, and update the PWA manifest `theme_color` / `background_color` and the
  splash assets if they assume light.
- Delete `src/components/theme-toggle.tsx` and its call sites if nothing else uses it.
- **Default:** keep `theme-provider.tsx` in place but pinned to dark rather than ripping it out —
  smaller blast radius, and hydration stays safe.
- Sweep for anything that reads a stored theme preference and remove the storage key.
- **Verify:** no surface renders light, including auth pages, the not-found screen, and the
  admin dashboard.

### fix-045 — admin broadcast with audience targeting
In `/admin`, add the ability to broadcast a message to:
- a **single user**,
- a **certain semester**,
- a **certain degree**,
- a **certain school**.

**Only the addressed people receive it.** This is the whole point — get the targeting right.

- Compose UI in the admin dashboard: audience type selector, then the matching picker (user
  search / semester / degree / school dropdown populated from real data), message body, a
  **preview showing the resolved recipient count** before send, and a confirm step.
- Delivery: create a notification per resolved recipient (or a broadcast row plus a recipient
  join — **default: fan out to per-user notification rows**, so read state and fix-042's cleanup
  work unchanged).
- Server-side: re-resolve the audience at send time and re-check admin role. Migration for any
  new table/columns, written and applied.
- Remember semester is computed-on-read from the roll number — resolve the semester audience the
  same way the rest of the app does, don't read a stale column.
- **Verify:** send to one semester with two test accounts, one in it and one not; confirm only the
  first receives it.

---

# Batch E — Chrome & copy

> Mostly delegable to Sonnet. Define the pattern, dispatch, review the diffs.

### fix-038 — home post-card placeholder
Change the Post card placeholder on Home to: **`Yo, {display name}! What's on your mind?`**
where `{display name}` is replaced with the current user's display name. **If it overflows, fall
back to the first name only.** Measure and degrade gracefully rather than truncating mid-name;
if the first name alone still overflows, ellipsize it.

### fix-039 — Campus Help subtext
Replace `Socio helps me solve Campus problems` with:
**`Drop the Gatekeeping, help your Campus.`**
The phrase **"help your Campus"** renders in brand purple; the rest in the default text colour.

### fix-046 — logo elements beside section titles
Add a logo element beside the **Community** title, matching how Campus Help already does it. Then
add the relevant logos to **Ranks** and **Discover** too. **Use the exact logo used in the navbar**
— same asset, same treatment, sized to match the Campus Help precedent. Find the Campus Help
implementation first and copy its structure so all four are consistent.

### fix-047 — Community subtext
Replace the Community subtext with: **`What do you want, {display name}?`** — same display-name
substitution and overflow behaviour as fix-038.

### fix-048 — purple round button around the Community plus
The `+` symbol for creating a space in Community should sit inside a **purple round button**.
Brand purple fill, circular, icon centered, correct contrast, hover/active states, tap target
≥40px. See `src/components/communities/create-space-button.tsx`.

### fix-053 — blue tick for verified societies
Render a blue verified tick next to the name of a **verified society**, everywhere the society
name appears — society page header, cards, listings, and any mention in feeds. Reuse the existing
verified-badge component from the round-1 design system rather than adding a second one; if the
existing badge is a different colour, add a blue variant for societies. **Default:** drive it off
the existing society verification flag; do not invent a new one.

### fix-054 — remove the display name over the cover photo
On the profile, remove the display name currently rendered on top of the cover photo. The name
stays wherever else it appears below; only the cover-photo overlay goes. Re-check the scrim — if
the gradient existed solely for that text's legibility, remove or soften it too.

### fix-055 — remove the doubled hairline above the first post
On the Me page, the topmost post has an upper hairline separator that sits directly under the
tabs' own separator, reading as two lines. Remove the **post's** upper hairline for the first item
only (keep separators between subsequent posts, keep the tabs' separator). Prefer a
`first:border-t-0`-style rule over a conditional in JS.

### fix-040 — illuminate the selected report option
In the report-post card, when the user selects an option, briefly illuminate the pressed option so
the selection registers. **Duration 0.25s**, then settle into the normal selected state. Use a
background flash in brand purple at low opacity; respect `prefers-reduced-motion` by skipping the
flash and going straight to the selected state. `src/components/discover/report-sheet.tsx`.

---

# Batch F — Matches page

### fix-056 — a real matches list, and your matches' matches
Pressing the **matches card** on the Me page opens a **separate page** listing the user's matches.

- New route under `src/app/(student)/profile/` (or `/matches` — pick and log it), linked from the
  matches stat card.
- Lists each match: avatar, display name, roll number, match percentage (fix-037's number), and a
  tap-through to their profile, plus a shortcut into the existing chat with them.
- **Second-degree:** the user can also view the match list **of a person they have matched with**.
  Reached by tapping through from a match's row/profile. Only for people you've actually matched
  with — one hop, not arbitrary browsing.
- **Privacy default:** second-degree lists show the same fields as first-degree *except* the match
  percentage between those two people, which is not yours to see. Enforce the one-hop rule in RLS,
  not just the query — someone must not be able to walk the whole graph by hand-crafting requests.
  Migration written and applied.
- Empty states for both levels. Verify with two accounts that the one-hop boundary actually holds.

---

## Done criteria

- All 28 fixes carry a status in `FIXES-ROUND2-LOG.md` — none missing.
- `npm run lint` and `npm run build` green.
- Every migration written has been applied to production and verified, and is listed in the log.
- The six Batch A regressions were each verified **in the browser by reproducing the original
  report**, not by inspection.
- `# Summary` at the top of the log.
- Merged to `main` and pushed per Operating rule 10 — or `PUSH SKIPPED` with the failed
  precondition named.
