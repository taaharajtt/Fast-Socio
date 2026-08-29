-- =============================================================================
-- FAST SOCIO — Selective DM reporting (Phase 3)
--
-- Migration 0160 removed every route a moderator had into a private DM. This
-- one gives them back exactly one route, and makes the participant the only
-- person who can open it: a reporter selects between 1 and 10 messages from
-- their own conversation, and only those messages are disclosed.
--
-- WHY A SEPARATE TABLE INSTEAD OF EXTENDING public.reports
-- `reports` carries the policy
--     select ... using (reporter_id = auth.uid() or is_admin(auth.uid()))
-- so the moment evidence lived in that table, every moderator would hold
-- unaudited PostgREST read access to it. The whole point of this design is that
-- reading evidence is an audited event. That is only enforceable if the
-- evidence table has no admin read policy at all and the sole way in is a
-- SECURITY DEFINER function that writes the audit row before it returns.
--
-- TRUST BOUNDARY
-- The browser supplies four things: a conversation id, a set of message ids, a
-- category and prose. Every identity, body, attachment and timestamp in the
-- evidence rows is copied by the server from the `messages` and `conversations`
-- rows it looked up itself. Nothing about who sent what, or when, is taken from
-- the client. A message id that does not belong to the named conversation
-- aborts the whole call.
--
-- THIS IS NOT E2EE. `messages.body` is still plaintext and the server can still
-- read it — which is precisely why the server is able to copy the snapshot
-- below. `evidence_source` and `protocol_version` exist so that a later E2EE
-- phase can add 'reporter_disclosed' evidence supplied by the participant's
-- device without reshaping the table. No cryptography is implemented here.
--
-- ROLLBACK
-- Purely additive: two new tables, one trigger, six new functions. Nothing
-- existing is altered or dropped. To roll back, drop the functions and then the
-- two tables (dm_report_messages first, or use cascade). Doing so destroys
-- filed evidence, so treat it as a data-loss operation, not a routine revert.
-- =============================================================================

set check_function_bodies = off;


-- -----------------------------------------------------------------------------
-- 1. Cases
-- -----------------------------------------------------------------------------
create table if not exists public.dm_report_cases (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  -- Derived from the conversation by the server, never a parameter.
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  category         text not null check (category in (
                     'harassment', 'hate_speech', 'sexual_content',
                     'threat_or_violence', 'spam_or_scam', 'impersonation', 'other'
                   )),
  description      text not null check (char_length(description) between 20 and 1000),
  status           public.report_status not null default 'pending',
  assigned_to      uuid references public.profiles (id) on delete set null,
  evidence_count   smallint not null check (evidence_count between 1 and 10),
  -- 0 = server-plaintext era. Bumped when E2EE lands and evidence arrives from
  -- the reporting device instead of being copied server-side.
  protocol_version smallint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists dm_report_cases_status_idx
  on public.dm_report_cases (status, created_at desc);
create index if not exists dm_report_cases_reporter_idx
  on public.dm_report_cases (reporter_id, created_at desc);
create index if not exists dm_report_cases_reported_idx
  on public.dm_report_cases (reported_user_id, created_at desc);
create index if not exists dm_report_cases_assigned_idx
  on public.dm_report_cases (assigned_to);

-- Duplicate guard. A second submission of the same form — a double tap, a
-- retried server action, an impatient reporter — hits this and is refused with
-- a clear message rather than filing a second case. Once the first case is
-- closed (actioned/dismissed) the reporter can file again about a new incident.
create unique index if not exists dm_report_cases_one_open_per_pair_idx
  on public.dm_report_cases (reporter_id, conversation_id)
  where status in ('pending', 'reviewing');

drop trigger if exists dm_report_cases_set_updated_at on public.dm_report_cases;
create trigger dm_report_cases_set_updated_at
  before update on public.dm_report_cases
  for each row execute function public.set_updated_at();

alter table public.dm_report_cases enable row level security;

-- The reporter may see the case they filed — its id and its status, so the app
-- can show "your report is being reviewed". Deliberately NO admin policy:
-- moderators read cases through admin_dm_report_list / _detail, which audit.
drop policy if exists "reporters read their own dm cases" on public.dm_report_cases;
create policy "reporters read their own dm cases"
  on public.dm_report_cases for select to authenticated
  using (reporter_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- 2. Evidence
-- -----------------------------------------------------------------------------
-- One row per disclosed message. Every column except evidence_order is copied
-- from a trusted server row at submission time.
create table if not exists public.dm_report_messages (
  id                  uuid primary key default gen_random_uuid(),
  report_id           uuid not null references public.dm_report_cases (id) on delete cascade,
  -- set null, not cascade: if the message is later deleted or tombstoned, the
  -- evidence and the case must survive it.
  source_message_id   uuid references public.messages (id) on delete set null,
  -- Deliberately NOT foreign keys. These are a snapshot of who sent and
  -- received the message at the time it was reported. A FK with `on delete
  -- cascade` would silently delete evidence rows out from under a case when an
  -- account is removed, leaving the case with a wrong evidence_count; `set
  -- null` would contradict `not null`. Evidence records history, so it holds
  -- the ids as data, and the case's own reporter/reported FKs handle account
  -- deletion at the right granularity (the whole case goes, not part of it).
  sender_id           uuid not null,
  recipient_id        uuid not null,
  original_created_at timestamptz not null,
  body_snapshot       text,
  attachment_path     text,
  attachment_type     public.attachment_type,
  shared_post_id      uuid,
  -- 'server_plaintext' — copied by the server from a readable row (today).
  -- 'reporter_disclosed' — supplied by the reporting device (post-E2EE).
  evidence_source     text not null default 'server_plaintext'
                        check (evidence_source in ('server_plaintext', 'reporter_disclosed')),
  evidence_order      smallint not null,
  created_at          timestamptz not null default now(),
  unique (report_id, source_message_id)
);

create index if not exists dm_report_messages_report_idx
  on public.dm_report_messages (report_id, evidence_order);

alter table public.dm_report_messages enable row level security;
-- No policies at all: deny-all to anon and authenticated. Evidence is reachable
-- only through the audited SECURITY DEFINER RPCs below. This is the same sealed
-- -table pattern the Campus Help masking views use.


-- -----------------------------------------------------------------------------
-- 3. Immutability
-- -----------------------------------------------------------------------------
-- RLS and GRANTs are both bypassed by SECURITY DEFINER, which every admin RPC
-- in this codebase is. A trigger is not. So the trigger — not the absent UPDATE
-- policy — is what actually guarantees that filed evidence cannot be edited or
-- quietly dropped after the fact, including by a future function that forgets.
create or replace function public.dm_report_evidence_immutable()
returns trigger language plpgsql as $$
begin
  -- An UPDATE is never legitimate.
  if tg_op = 'UPDATE' then
    raise exception 'report evidence is immutable once filed';
  end if;

  -- A DELETE is legitimate only as the FK cascade from a case that is itself
  -- being deleted — which happens when a participant's account is removed and
  -- profiles cascades through dm_report_cases. Postgres deletes the parent
  -- first, so by the time this fires for a cascade the case row is already
  -- gone. A direct DELETE against evidence finds its case still present, and
  -- is refused.
  --
  -- Without this distinction the trigger would abort account deletion, since
  -- the cascade could never complete.
  if exists (select 1 from public.dm_report_cases where id = old.report_id) then
    raise exception 'report evidence cannot be deleted while its case exists';
  end if;

  return old;
end $$;

drop trigger if exists dm_report_messages_immutable on public.dm_report_messages;
create trigger dm_report_messages_immutable
  before update or delete on public.dm_report_messages
  for each row execute function public.dm_report_evidence_immutable();

revoke insert, update, delete on public.dm_report_cases from authenticated, anon;
revoke insert, update, delete on public.dm_report_messages from authenticated, anon;
revoke select on public.dm_report_messages from authenticated, anon;


-- -----------------------------------------------------------------------------
-- 4. Submission
-- -----------------------------------------------------------------------------
create or replace function public.submit_dm_report(
  p_conversation_id uuid,
  p_message_ids     uuid[],
  p_category        text,
  p_description     text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me            uuid := auth.uid();
  v_low         uuid;
  v_high        uuid;
  v_other       uuid;
  v_ids         uuid[];
  v_n           int;
  v_found       int;
  v_desc        text := btrim(coalesce(p_description, ''));
  v_recent      int;
  v_case        uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  -- (2) Participation. A non-participant gets the same error as a nonexistent
  -- conversation: no probing whether a given conversation id exists.
  select user_low, user_high into v_low, v_high
    from public.conversations
   where id = p_conversation_id
     and (user_low = me or user_high = me);
  if v_low is null then
    raise exception 'not a participant in this conversation';
  end if;

  -- (3) The reported user is derived, never supplied.
  v_other := case when v_low = me then v_high else v_low end;

  -- (4) Dedupe first, then bound. Sending the same id ten times is one message.
  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_message_ids, '{}'::uuid[])) as x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 1 then
    raise exception 'select at least one message to report';
  end if;
  if v_n > 10 then
    raise exception 'you can report at most 10 messages at a time';
  end if;

  -- (5) Every id must be a real message IN THIS conversation. A foreign,
  -- cross-conversation or nonexistent id fails the whole submission rather
  -- than being silently dropped — a partial report is a misleading report.
  select count(*) into v_found
    from public.messages m
   where m.id = any (v_ids)
     and m.conversation_id = p_conversation_id;
  if v_found <> v_n then
    raise exception 'one or more selected messages do not belong to this conversation';
  end if;

  -- (6) Category and description. The check constraints would catch these, but
  -- raising here produces a message the UI can show verbatim.
  if p_category is null or p_category not in (
    'harassment', 'hate_speech', 'sexual_content',
    'threat_or_violence', 'spam_or_scam', 'impersonation', 'other'
  ) then
    raise exception 'choose a report category';
  end if;
  if char_length(v_desc) < 20 then
    raise exception 'describe what happened in at least 20 characters';
  end if;
  if char_length(v_desc) > 1000 then
    raise exception 'description must be 1000 characters or fewer';
  end if;

  -- (7) Rate limit, enforced in SQL so it holds even if the RPC is called
  -- directly with an anon-key client instead of through the server action.
  select count(*) into v_recent
    from public.dm_report_cases
   where reporter_id = me
     and created_at > now() - interval '24 hours';
  if v_recent >= 5 then
    raise exception 'you have filed too many reports today, try again tomorrow';
  end if;

  -- (8) Duplicate guard, via the partial unique index. Caught explicitly so the
  -- reporter sees an explanation rather than a constraint name.
  begin
    insert into public.dm_report_cases (
      reporter_id, conversation_id, reported_user_id,
      category, description, evidence_count
    ) values (
      me, p_conversation_id, v_other,
      p_category, v_desc, v_n
    ) returning id into v_case;
  exception when unique_violation then
    raise exception 'you already have an open report for this conversation';
  end;

  -- (9) Evidence copied from trusted rows. sender_id, timestamp, body and
  -- attachment come from `messages`; recipient_id is computed from the
  -- conversation participants, not from anything the client said.
  insert into public.dm_report_messages (
    report_id, source_message_id, sender_id, recipient_id,
    original_created_at, body_snapshot, attachment_path, attachment_type,
    shared_post_id, evidence_source, evidence_order
  )
  select
    v_case,
    m.id,
    m.sender_id,
    case when m.sender_id = v_low then v_high else v_low end,
    m.created_at,
    m.body,
    m.attachment_url,
    m.attachment_type,
    m.shared_post_id,
    'server_plaintext',
    row_number() over (order by m.created_at, m.id)
  from public.messages m
  where m.id = any (v_ids)
    and m.conversation_id = p_conversation_id;

  -- (10) Audit. Written directly rather than via log_admin_action(), which
  -- requires is_admin() — the actor here is a student filing a report.
  -- Metadata is counts and ids only: no body, no category-free text.
  insert into public.moderation_audit_log (actor_id, action, target_id, metadata)
  values (me, 'dm_report.created', v_case, jsonb_build_object(
    'report_id', v_case,
    'conversation_id', p_conversation_id,
    'reported_user_id', v_other,
    'evidence_count', v_n,
    'category', p_category
  ));

  return v_case;
end $$;

revoke execute on function public.submit_dm_report(uuid, uuid[], text, text) from public, anon;
grant execute on function public.submit_dm_report(uuid, uuid[], text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 5. Moderator surface
-- -----------------------------------------------------------------------------

-- The queue. Metadata and counts only — no body reaches this function, so
-- listing the queue is not an evidence disclosure and is not audited as one.
create or replace function public.admin_dm_report_list(
  p_status text default null, p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb; v_total bigint;
begin
  perform public._admin_guard();

  select count(*) into v_total from public.dm_report_cases c
   where p_status is null or c.status::text = p_status;

  select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_rows from (
    select c.created_at as ts, jsonb_build_object(
      'id', c.id,
      'category', c.category,
      'status', c.status,
      'evidence_count', c.evidence_count,
      'created_at', c.created_at,
      'reporter_id', c.reporter_id,
      'reporter_name', coalesce(rp.full_name, '—'),
      'reported_user_id', c.reported_user_id,
      'reported_name', coalesce(tp.full_name, '—'),
      'assigned_to', c.assigned_to,
      'assigned_name', ap.full_name
    ) x
    from public.dm_report_cases c
    left join public.profiles rp on rp.id = c.reporter_id
    left join public.profiles tp on tp.id = c.reported_user_id
    left join public.profiles ap on ap.id = c.assigned_to
    where p_status is null or c.status::text = p_status
    order by c.created_at desc
    limit v_lim offset v_off
  ) q;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_lim, 'offset', v_off);
end $$;

-- The case. This is the ONLY function in the product that returns a private DM
-- body to a moderator, it returns only the messages the reporter selected, and
-- it writes the audit row BEFORE it reads them — so an error later in the
-- function cannot produce an unlogged view.
--
-- Note it is deliberately VOLATILE, not STABLE: it writes.
create or replace function public.admin_dm_report_detail(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_case jsonb;
  v_evidence jsonb;
  v_history jsonb;
  v_exists boolean;
begin
  perform public._admin_guard();

  select exists (select 1 from public.dm_report_cases where id = p_report_id) into v_exists;
  if not v_exists then
    raise exception 'report not found';
  end if;

  -- Audit first, unconditionally.
  perform public.log_admin_action(
    'dm_report.view_evidence', null, p_report_id, null, null,
    jsonb_build_object('report_id', p_report_id));

  select jsonb_build_object(
    'id', c.id,
    'category', c.category,
    'description', c.description,
    'status', c.status,
    'evidence_count', c.evidence_count,
    'protocol_version', c.protocol_version,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'conversation_id', c.conversation_id,
    'reporter_id', c.reporter_id,
    'reporter_name', coalesce(rp.full_name, '—'),
    'reported_user_id', c.reported_user_id,
    'reported_name', coalesce(tp.full_name, '—'),
    'assigned_to', c.assigned_to,
    'assigned_name', ap.full_name
  ) into v_case
  from public.dm_report_cases c
  left join public.profiles rp on rp.id = c.reporter_id
  left join public.profiles tp on tp.id = c.reported_user_id
  left join public.profiles ap on ap.id = c.assigned_to
  where c.id = p_report_id;

  -- Only rows belonging to THIS case. There is no conversation-scoped read
  -- anywhere in the moderator surface.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'source_message_id', e.source_message_id,
    'sender_id', e.sender_id,
    'sender_name', coalesce(sp.full_name, '—'),
    'recipient_id', e.recipient_id,
    'recipient_name', coalesce(rcp.full_name, '—'),
    'original_created_at', e.original_created_at,
    'body', e.body_snapshot,
    'attachment_path', e.attachment_path,
    'attachment_type', e.attachment_type,
    'shared_post_id', e.shared_post_id,
    'evidence_source', e.evidence_source,
    'evidence_order', e.evidence_order,
    -- Live moderation state of the underlying message, so the case page can
    -- show whether the tombstone has already been applied. Null if the
    -- message row is gone.
    'source_hidden', m.hidden
  ) order by e.evidence_order), '[]'::jsonb) into v_evidence
  from public.dm_report_messages e
  left join public.profiles sp on sp.id = e.sender_id
  left join public.profiles rcp on rcp.id = e.recipient_id
  left join public.messages m on m.id = e.source_message_id
  where e.report_id = p_report_id;

  -- Case history: every audit row written against this case, this view
  -- included. Bodies never enter the audit metadata, so this is safe to show.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'action', l.action,
    'actor_id', l.actor_id,
    'actor_name', coalesce(pr.full_name, '—'),
    'reason', l.reason,
    'metadata', l.metadata,
    'created_at', l.created_at
  ) order by l.created_at desc), '[]'::jsonb) into v_history
  from public.moderation_audit_log l
  left join public.profiles pr on pr.id = l.actor_id
  where l.target_id = p_report_id
    and l.action like 'dm_report.%';

  return jsonb_build_object('case', v_case, 'evidence', v_evidence, 'history', v_history);
end $$;

-- Status + assignment + internal note. Each writes its own audit row.
create or replace function public.admin_dm_report_update(
  p_report_id uuid,
  p_status    text default null,
  p_assign_to uuid default null,
  p_clear_assignee boolean default false,
  p_note      text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
begin
  perform public._admin_guard();

  select to_jsonb(c) into v_before from public.dm_report_cases c where c.id = p_report_id;
  if v_before is null then
    raise exception 'report not found';
  end if;

  if p_status is not null then
    if p_status not in ('pending', 'reviewing', 'actioned', 'dismissed') then
      raise exception 'unknown status: %', p_status;
    end if;
    update public.dm_report_cases
       set status = p_status::public.report_status
     where id = p_report_id;
    perform public.log_admin_action(
      'dm_report.status', null, p_report_id, null, null,
      jsonb_build_object('report_id', p_report_id, 'status', p_status));
  end if;

  if p_clear_assignee then
    update public.dm_report_cases set assigned_to = null where id = p_report_id;
    perform public.log_admin_action(
      'dm_report.unassign', null, p_report_id, null, null,
      jsonb_build_object('report_id', p_report_id));
  elsif p_assign_to is not null then
    if not public.is_admin(p_assign_to) then
      raise exception 'reports can only be assigned to a moderator';
    end if;
    update public.dm_report_cases set assigned_to = p_assign_to where id = p_report_id;
    perform public.log_admin_action(
      'dm_report.assign', null, p_report_id, null, null,
      jsonb_build_object('report_id', p_report_id, 'assigned_to', p_assign_to));
  end if;

  if p_note is not null and btrim(p_note) <> '' then
    if char_length(p_note) > 2000 then
      raise exception 'note must be 2000 characters or fewer';
    end if;
    -- The note is moderator-authored text about the case, stored in `reason`
    -- where the rest of the audit trail keeps its rationale.
    perform public.log_admin_action(
      'dm_report.note', btrim(p_note), p_report_id, null, null,
      jsonb_build_object('report_id', p_report_id));
  end if;
end $$;

-- Report-scoped message tombstone. The `p_message_id must be evidence in
-- p_report_id` check is what keeps this from becoming a general "hide any DM"
-- primitive — which is what migration 0160 just removed.
--
-- Hiding removes the message from both participants' threads (the thread query
-- filters hidden = false). It cannot retract a screenshot, an offline client,
-- a notification already delivered, or a backup. The UI says so.
create or replace function public.admin_dm_report_hide_message(
  p_report_id  uuid,
  p_message_id uuid,
  p_hidden     boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_evidence boolean;
begin
  perform public._admin_guard();

  select exists (
    select 1 from public.dm_report_messages
     where report_id = p_report_id and source_message_id = p_message_id
  ) into v_is_evidence;
  if not v_is_evidence then
    raise exception 'that message is not evidence in this report';
  end if;

  update public.messages set hidden = p_hidden where id = p_message_id;

  perform public.log_admin_action(
    case when p_hidden then 'dm_report.tombstone' else 'dm_report.untombstone' end,
    null, p_report_id, null, null,
    jsonb_build_object('report_id', p_report_id, 'message_id', p_message_id, 'hidden', p_hidden));
end $$;

revoke execute on function public.admin_dm_report_list(text, int, int) from public, anon;
revoke execute on function public.admin_dm_report_detail(uuid) from public, anon;
revoke execute on function public.admin_dm_report_update(uuid, text, uuid, boolean, text) from public, anon;
revoke execute on function public.admin_dm_report_hide_message(uuid, uuid, boolean) from public, anon;

grant execute on function public.admin_dm_report_list(text, int, int) to authenticated;
grant execute on function public.admin_dm_report_detail(uuid) to authenticated;
grant execute on function public.admin_dm_report_update(uuid, text, uuid, boolean, text) to authenticated;
grant execute on function public.admin_dm_report_hide_message(uuid, uuid, boolean) to authenticated;

comment on table public.dm_report_cases is
  'Selective DM report cases. Evidence lives in dm_report_messages and is readable only through admin_dm_report_detail, which audits every call. See migration 0161.';
comment on table public.dm_report_messages is
  'Immutable, reporter-selected DM evidence (1-10 rows per case). Deny-all RLS; no admin read policy by design. See migration 0161.';
