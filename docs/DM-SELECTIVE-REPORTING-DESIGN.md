# DM privacy hardening — selective reporting

**Status:** design for Phases 2 + 3 (privacy hardening). **Not** end-to-end encryption.
**Date:** 2026-08-29

---

## 0. What this is, and what it is not

This work removes application-level admin access to whole one-to-one DM
conversations and replaces it with a report-scoped evidence workflow: a
participant selects 1–10 messages, describes the problem, and only those
messages reach moderators.

**This is not E2EE.** Message bodies remain plaintext columns in
`public.messages`. Anyone with database credentials — Supabase project owners,
anyone with the service-role key, a DBA, a backup, a replica — can still read
every DM. What changes is that *the FAST SOCIO application no longer offers a
way to do it*. That is a real and worthwhile reduction in exposure (it removes
casual, in-product, one-click access by any moderator) and it is not a
cryptographic guarantee.

No encryption indicator, badge, or claim may be added to the UI as a result of
this work.

---

## 1. Audit — every path that exposes DM content today

| # | Path | Kind | Exposure | Disposition |
|---|------|------|----------|-------------|
| 1 | `admin_dm_conversations(text,int,int)` | RPC (SECURITY DEFINER, `is_admin`) | Lists every conversation in the product with participant names and message counts, searchable by name | **Dropped** |
| 2 | `admin_dm_messages(uuid)` | RPC (SECURITY DEFINER, `is_admin`) | Returns the **complete transcript** of any conversation — bodies, attachment URLs, shared posts. Wrote a `dm.view` audit row, i.e. it was audited but unrestricted | **Dropped** |
| 3 | `/admin/content?tab=dm` | Page | Conversation browser UI | **Tab removed** |
| 4 | `/admin/content/dm/[id]` | Page | Transcript viewer UI | **Deleted** |
| 5 | `components/admin/dm-message-row.tsx` | Component | Renders one transcript row + per-message Delete | **Deleted** |
| 6 | `deleteMessage()` in `admin/content/actions.ts` | Server action | Deletes an arbitrary DM by id | **Deleted** |
| 7 | `admin_content_feed(p_type => 'message')` | RPC branch | **The worst one.** A global, paginated, full-text-searchable feed of *every DM body in the product*, with no conversation scoping at all — `q=` ran `messages.body ilike '%…%'` | **Branch removed; `'message'` now raises** |
| 8 | `/admin/content?tab=message` | Page tab | UI for #7 | **Tab removed** |
| 9 | `admin_set_content_hidden(p_type => 'message')` | RPC branch | Hides an arbitrary DM with no report behind it | **Branch removed** |
| 10 | `admin_delete_content(p_type => 'message')` | RPC branch | Hard-deletes an arbitrary DM **and snapshots the whole row, body included, into `moderation_audit_log.before_data`** — a plaintext DM copy in the audit trail | **Branch removed** |
| 11 | `admin_table_rows('messages' \| 'conversations')` | RPC | The `/admin/database` browser reads any table. Migration 0149 constrained *writes* only; **reads were never guarded**, so a super_admin could page through `messages` and search bodies | **Read guard added (0160) + raw RPC revoked (0162)** |
| 12 | `admin_table_rows` **called directly** | RPC grant | 0160 added the guard wrapper but left the underlying RPC granted to `authenticated` by 0038 — so the wrapper could simply be skipped over PostgREST. **Found in review; see §1a** | **EXECUTE revoked from `public, anon, authenticated` (0162)** |
| 13 | `admin_update_row('messages', …)` | RPC | Returns the updated row as jsonb, so a **no-op write is a read**: `{"hidden": false}` against a message id returns that message's body. Not covered by 0149's denylist | **Write floor added inside the function (0162)** |
| 14 | `admin_delete_row('messages', …)` | RPC | Deletes a private message **and** snapshots the full row, body included, into `moderation_audit_log.before_data` | **Write floor added inside the function (0162)** |
| 15 | `/admin/matching` rendered `message_requests.message` | Page | The opening line of a DM, selected into the RSC payload and passed as a prop to a client component, for every pending request | **Column no longer selected or rendered (0163 + page change)** |
| 16 | `admin_delete_row('message_requests', …)` | RPC | 0162 exempted this table so the matching admin kept working — so every deletion still wrote the opening message into `before_data` | **Exemption removed; replaced by `admin_delete_message_request()` (0163)** |
| 17 | `moderation_audit_log.before_data` / `after_data` | Table columns | Retained plaintext from the old delete paths, readable by any admin over PostgREST and pageable via the database browser. `/admin/audit` never rendered it, so it was invisible from the UI | **Write grants revoked, SELECT column allowlist, browser denied (0164)** |

### Paths deliberately left alone

- **`moderate_report`** hides the reported target when a report is actioned,
  including `target_type = 'message'`. It is report-scoped by construction and
  exposes no body. Kept.
- **`/admin/users/[id]` message count** — `count: exact, head: true` over
  `messages`. An aggregate, no bodies. Kept, as permitted.
- **Community / event / society / Campus Help / Discover room chat** — out of
  scope. `admin_content_feed('community')` still reads
  `community_chat_messages`. Those are group surfaces with a different privacy
  expectation and are explicitly excluded from this task.
- **Participant paths** — `messages` RLS SELECT/INSERT, `get_or_create_conversation`,
  `mark_conversation_read`, `edit_message`, `delete_message`,
  `toggle_message_reaction`, `toggle_pin_message`, `fetchOlderMessages`, the
  inbox preview, realtime, and chat-media signing are all untouched.

### Verification that removal is safe

Every removed branch was traced to its only caller before removal. Nothing in
`src/app/(student)/**` or `src/components/chat/**` calls `admin_dm_*`,
`admin_content_feed`, `admin_set_content_hidden`, or `admin_delete_content`.
`moderate_report` inlines its own `update messages set hidden` and does **not**
delegate to `admin_set_content_hidden`, so removing the `'message'` branch does
not break report actioning. No participant-facing behaviour changes.

### 1a. Migration 0162 — the generic row RPCs (P0 found in review)

Migration 0160 guarded the door and left the wall open. It created
`admin_browser_table_rows()` and pointed the `/admin/database` UI at it, but the
underlying `public.admin_table_rows()` kept the `EXECUTE` grant migration 0038
gave `authenticated`. The wrapper was therefore a **UI convention, not a
control**: any super_admin could skip it entirely with

```js
supabase.rpc("admin_table_rows", { p_table: "messages", p_search: "…" })
```

and get back exactly the unrestricted, body-searchable DM browser Phase 2
exists to remove. **Confirmed live on the dev project by catalog probe** — the
grant is present for both `authenticated` *and* `anon`.

Auditing that bypass surfaced two siblings of it, both also live and both
missed by 0160:

- **`admin_update_row` returns the row it wrote.** It reads as a writer, so it
  was never considered a read path — but a no-op update
  (`{"hidden": false}`) against a `messages` id returns that message's full row,
  body included. 0149's denylist does not cover it because that list names
  audit and session tables; `messages` was never on it.
- **`admin_delete_row` snapshots before deleting.** Pointed at `messages` it
  both destroys a private message and writes a second plaintext copy of it into
  `moderation_audit_log.before_data` — the exact behaviour 0160 removed from
  `admin_delete_content('message')`.

**The reader and the writers need different fixes.** `admin_table_rows` has
exactly one caller left after 0160 (the wrapper), so its grant is simply
revoked. The three mutators cannot be revoked: 0149 documented, correctly, that
the dedicated admin actions call them directly on purpose — `users/actions.ts`
→ `profiles`, plus `communities`, `events`, and `matching` → `matches` and
`message_requests`. Revoking them would break working, audited features. They
get a hard floor *inside* the function instead.

This is **not** the thing 0149 declined to do. 0149 refused to denylist
profiles *columns* inside `admin_update_row`, because dedicated actions
legitimately write those exact columns. Nothing in this product has ever
legitimately written `messages`, `conversations`, `message_reactions` or the
report-evidence tables through a generic row editor, so a table-level floor for
those breaks nothing and cannot drift.

The revoke does not stop the wrapper from delegating: `admin_browser_table_rows`
is `SECURITY DEFINER`, so its body runs as the function **owner**, and an owner
keeps `EXECUTE` on its own functions regardless of what is revoked from
`PUBLIC`, `anon` or `authenticated`. Verification §8b asserts this by catalog
(both functions share an owner, wrapper is `prosecdef`) and §9b by behaviour.

**One list, three enforcement points.** The protected set now lives in
`_dm_protected_tables()` and is consumed by the read guard (0160), the write
floor (0162) and the browser guard (0149), so the three cannot disagree.

**`message_requests` is a deliberate asymmetry.** Its `message` column is the
opening message of a DM — private user text — so it is **read**-protected. It
stays **writable**, because `/admin/matching` deletes these rows as a working
feature. That means deleting one still copies its text into
`moderation_audit_log.before_data`. Recorded as a residual below rather than
silently breaking the matching admin.

---

## 1b. Migrations 0163 / 0164 — the message-request gap and the audit residue

**0163 — `message_requests`.** Its `message` column is the opening line of a DM:
private user text, written by one student to another. Migration 0162 read-
protected it but *exempted* it from the write floor so `/admin/matching` kept
working. That exemption was the whole problem: `admin_delete_row` captures
`to_jsonb(row)` into `moderation_audit_log.before_data` before deleting, so
every deletion minted a permanent plaintext copy — and `admin_update_row`
returns the row it writes, so a no-op update was a read.

The exemption is gone. `message_requests` now sits under the full floor with the
other DM tables, and the legitimate feature is re-provided by
`admin_delete_message_request(p_id uuid)`: super_admin-gated, deletes one row,
and audits an explicit allowlist — request id, sender, recipient, status,
timestamps. It never selects, returns or logs `message`, and it passes `null`
for `before_data`/`after_data`. The admin page no longer selects the column at
all, so it never reaches the RSC payload (Next.js data-security guide: return
minimal DTOs).

**0164 — the residue.** Closing the write paths does nothing about what the old
ones already wrote. Measured on dev, 2026-08-29: 464 audit rows, 12 with
non-null `before_data`, of which **exactly one** is `content.delete:message` —
one retained plaintext DM body. Production must be measured separately.

Three exposures were live and are now closed:

- `authenticated` and `anon` held **INSERT, UPDATE and DELETE** on
  `moderation_audit_log`. Only the *absence of an RLS policy* stopped writes to
  the audit trail. Revoked — every legitimate writer is SECURITY DEFINER and
  runs as the owner, so nothing breaks.
- The RLS SELECT policy is row-level (`is_admin(auth.uid())`), so any admin
  could read `before_data` over PostgREST. Replaced with a **column allowlist**
  covering exactly the 8 columns `/admin/audit` and `/admin/broadcast` read.
  `before_data`, `after_data` and `ip` are withheld.
- `admin_browser_table_rows` is SECURITY DEFINER and so bypasses column grants
  entirely. `moderation_audit_log` is now on its read denylist.

The column-allowlist approach is the one migration 0082 tried on `profiles` and
0083 had to revert, because Postgres needs table-level SELECT for
`INSERT … ON CONFLICT DO UPDATE`. That hazard does not apply here: `authenticated`
never writes this table. Verification §10e asserts the allowlist did not
over-revoke — the check that would have caught the 0082 mistake.

**Nothing was deleted.** See §5 for the retention decision this leaves open.

---

## 2. Data model

Two new tables. They are separate from `public.reports` rather than an
extension of it, because `reports` has a permissive SELECT policy
(`reporter_id = auth.uid() or is_admin(auth.uid())`) that would hand every
moderator unaudited read access to evidence the moment it lived there. Keeping
evidence in its own sealed table is what makes "every evidence view is audited"
enforceable rather than aspirational.

```
dm_report_cases
  id                  uuid pk
  reporter_id         uuid -> profiles
  conversation_id     uuid -> conversations
  reported_user_id    uuid -> profiles        (derived server-side)
  category            text  (checked list)
  description         text  (20..1000 chars)
  status              report_status           (reuses the existing enum)
  assigned_to         uuid -> profiles null
  evidence_count      smallint  1..10
  protocol_version    smallint default 0      (0 = server-plaintext era)
  created_at / updated_at

dm_report_messages
  id                  uuid pk
  report_id           uuid -> dm_report_cases on delete cascade
  source_message_id   uuid -> messages on delete set null
  sender_id           uuid                    copied from messages
  recipient_id        uuid                    derived from conversations
  original_created_at timestamptz             copied from messages
  body_snapshot       text                    copied from messages
  attachment_path     text                    copied from messages
  attachment_type     attachment_type         copied from messages
  shared_post_id      uuid                    copied from messages
  evidence_source     text  'server_plaintext' | 'reporter_disclosed'
  evidence_order      smallint
  created_at
```

`protocol_version` and `evidence_source` are the forward-compatibility hooks
for the later E2EE phase: when messages become ciphertext, the server can no
longer copy a body, and the reporting client will supply deliberately disclosed
plaintext with `evidence_source = 'reporter_disclosed'`. Nothing crypto-related
is implemented now.

`source_message_id` is `on delete set null`, not cascade: if the underlying
message is later deleted, the evidence snapshot and the case must survive.

### RLS

- `dm_report_cases`: RLS on. One policy — `select` where
  `reporter_id = auth.uid()`. A reporter can see their own case and its status;
  nothing else. **No admin policy**, so moderators cannot read the table
  directly through PostgREST; they reach it only through the audited RPCs.
- `dm_report_messages`: RLS on, **zero policies** — deny-all to `anon` and
  `authenticated`. Evidence is reachable only through SECURITY DEFINER RPCs.
  This is the same sealed-table pattern the codebase already uses for masked
  Help data.
- `revoke insert/update/delete` on both from `authenticated`, plus a
  `before update or delete` trigger on `dm_report_messages` that raises
  unconditionally. The trigger is the real immutability guarantee: RLS and
  GRANTs are bypassed by SECURITY DEFINER, a trigger is not.

---

## 3. Submission security model

`submit_dm_report(p_conversation_id, p_message_ids uuid[], p_category, p_description)`
→ `uuid`, SECURITY DEFINER, `set search_path = public`.

The browser supplies exactly four things: a conversation, a set of message ids,
a category, and prose. **Every identity, body, and timestamp is read from the
database**, never accepted from the client. Order of checks:

1. `auth.uid()` must be non-null.
2. Caller must be `user_low` or `user_high` of `p_conversation_id`.
3. `reported_user_id` := the *other* participant, derived from the conversation
   row. Not a parameter.
4. Deduplicate `p_message_ids`; require `1 <= count <= 10` after dedup, so
   passing the same id ten times is one message, not ten.
5. Every id must resolve to a row in `messages` **with that
   `conversation_id`**. A missing or foreign id aborts the whole call. This is
   the check that stops a participant fabricating evidence from another
   conversation.
6. Category must be in the fixed list; description trimmed, then 20..1000 chars.
7. Rate limit: at most 5 DM cases per reporter per 24h, counted inside the
   transaction. Enforced in SQL, so it cannot be bypassed by calling the RPC
   directly with an anon-key client.
8. Duplicate guard: a partial unique index on
   `(reporter_id, conversation_id) where status in ('pending','reviewing')`
   rejects a second open case for the same conversation. This covers both
   double-tap submission and open-case spam; the error is surfaced as a clear
   message, and the reporter can file again once the first case is closed.
9. Insert case, insert evidence rows copied from the trusted `messages` rows,
   insert a `dm_report.created` audit row — one transaction, all or nothing.

The server action additionally applies the app-level `report` rate limit before
calling in, and the client disables the submit control while in flight. Those
are conveniences; step 7 is the guarantee.

---

## 4. What moderators can and cannot see

**Can:** case metadata (id, category, description, status, assignee, created
at), reporter and reported-user profile links, the 1–10 selected messages with
sender / recipient / timestamp, a signed URL for a *selected* attachment only,
and the case's audit history.

**Cannot:** any message from the conversation that the reporter did not select;
any other conversation; a link, id-guess, or parameter that would widen the
view. The detail RPC takes a `report_id` — there is no conversation-scoped read
in the moderator surface at all, and `conversation_id` is displayed as an
opaque truncated id with no navigation target.

**Audit.** `admin_dm_report_detail` writes a `dm_report.view_evidence` row to
`moderation_audit_log` on *every* call, before returning anything. Status
changes, assignment, internal notes, and message tombstones each write their own
row. Ban / strike / suspension / shadow-ban are **not** reimplemented — the case
page links to the existing `/admin/users/[id]` controls, which already audit.

---

## 5. Known limitations

- Not E2EE; see §0. Database-level access is unchanged.
- A message tombstone hides a message from the app. It cannot retract
  screenshots, offline clients, or backups.
- Evidence is a *snapshot copied by the server at submission time*, linked to
  an immutable `source_message_id`. It is moderation evidence, not
  cryptographic proof of authorship.
- Historic `moderation_audit_log.before_data` rows written by the old
  `admin_delete_content('message')` path may still contain plaintext DM bodies.
  Removing the branch stops new ones; purging old ones is a retention decision
  and is **not** done here.
- **RESOLVED in 0163** — `message_requests` deletions no longer snapshot their
  text into the audit log; the exemption was removed and replaced by
  `admin_delete_message_request()`.
- **OPEN — historic audit residue requires an owner decision.** Migration 0164
  makes the retained plaintext unreachable in-product, but it is still on disk
  and in backups. Dev holds exactly 1 such row; production is unmeasured. The
  three options — leave as is / redact the snapshot but keep the record /
  delete the rows — are written out in §4 of migration 0164, with the redaction
  SQL ready to run. **Recommendation: redact, keep the record.** This is
  deliberately not executed by any migration.
- `admin_list_tables()` and `admin_table_meta()` remain granted. They expose
  table names, row counts, sizes, column names and index definitions — metadata,
  no content. Row counts over `messages` are the aggregate the brief explicitly
  permits.
- The partial unique index means one open case per (reporter, conversation) at
  a time.

---

## 6. Policy wording that must change later (not done in this task)

Terms and Privacy Policy are untouched here by instruction. Before this ships:

- Remove any statement that moderators may **browse reported conversations** —
  after this change they cannot; they see only reporter-selected messages.
- State that reporting discloses the selected messages, their senders and
  timestamps, and the reporter's description, and nothing else from that thread.
- State that report evidence and moderation audit records are retained after a
  case closes.
- Do **not** add any encryption claim. DMs remain plaintext at rest.
