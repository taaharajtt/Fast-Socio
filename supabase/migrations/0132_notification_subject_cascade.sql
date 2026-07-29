-- 0132 — fix-006: a notification dies with its subject.
--
-- notifications.data is loose jsonb with no referential integrity, so deleting a
-- post/comment/community/event/help request left its notifications behind,
-- rendering forever and inflating the unread badge. Production held 267 such
-- orphans before this ran.
--
-- Approach: real foreign keys with ON DELETE CASCADE. The subject id stays in
-- `data` (every reader already depends on it); these columns are a typed mirror
-- maintained by a trigger, so Postgres — not application code — is what removes
-- a dead notification.
--
-- `post_id` is polymorphic in `data`: for smart_match_* types it names a
-- smart_match_posts row, for everything else a posts row. Hence two columns.

alter table public.notifications
  add column if not exists subject_post_id         uuid references public.posts(id)              on delete cascade,
  add column if not exists subject_match_post_id   uuid references public.smart_match_posts(id)  on delete cascade,
  add column if not exists subject_comment_id      uuid references public.post_comments(id)      on delete cascade,
  add column if not exists subject_community_id    uuid references public.communities(id)        on delete cascade,
  add column if not exists subject_event_id        uuid references public.events(id)             on delete cascade,
  add column if not exists subject_help_request_id uuid references public.help_requests(id)      on delete cascade,
  add column if not exists subject_conversation_id uuid references public.conversations(id)      on delete cascade,
  add column if not exists subject_message_id      uuid references public.messages(id)           on delete cascade;

-- Cascade deletes scan by the referencing column; without these each subject
-- delete would seq-scan notifications.
create index if not exists notifications_subject_post_idx         on public.notifications (subject_post_id)         where subject_post_id is not null;
create index if not exists notifications_subject_match_post_idx   on public.notifications (subject_match_post_id)   where subject_match_post_id is not null;
create index if not exists notifications_subject_comment_idx      on public.notifications (subject_comment_id)      where subject_comment_id is not null;
create index if not exists notifications_subject_community_idx    on public.notifications (subject_community_id)    where subject_community_id is not null;
create index if not exists notifications_subject_event_idx        on public.notifications (subject_event_id)        where subject_event_id is not null;
create index if not exists notifications_subject_help_request_idx on public.notifications (subject_help_request_id) where subject_help_request_id is not null;
create index if not exists notifications_subject_conversation_idx on public.notifications (subject_conversation_id) where subject_conversation_id is not null;
create index if not exists notifications_subject_message_idx      on public.notifications (subject_message_id)      where subject_message_id is not null;

-- ---------------------------------------------------------------------------
-- Keep the typed columns in step with `data` on every write.
-- ---------------------------------------------------------------------------
-- A subject that is ALREADY gone resolves to null rather than raising, so a
-- late-firing notifier can never abort the transaction that spawned it; the
-- read-side view below hides the result either way.
create or replace function public.notifications_link_subject()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_post uuid := nullif(new.data->>'post_id', '')::uuid;
begin
  if new.type like 'smart\_match\_%' then
    new.subject_match_post_id :=
      (select p.id from public.smart_match_posts p where p.id = v_post);
  else
    new.subject_post_id :=
      (select p.id from public.posts p where p.id = v_post);
  end if;

  new.subject_comment_id :=
    (select c.id from public.post_comments c
      where c.id = nullif(new.data->>'comment_id', '')::uuid);

  -- society_id and community_id both name a row in `communities`.
  new.subject_community_id :=
    (select c.id from public.communities c
      where c.id = coalesce(
        nullif(new.data->>'community_id', '')::uuid,
        nullif(new.data->>'society_id', '')::uuid
      ));

  new.subject_event_id :=
    (select e.id from public.events e
      where e.id = nullif(new.data->>'event_id', '')::uuid);

  new.subject_help_request_id :=
    (select h.id from public.help_requests h
      where h.id = nullif(new.data->>'request_id', '')::uuid);

  new.subject_conversation_id :=
    (select c.id from public.conversations c
      where c.id = nullif(new.data->>'conversation_id', '')::uuid);

  new.subject_message_id :=
    (select m.id from public.messages m
      where m.id = nullif(new.data->>'message_id', '')::uuid);

  return new;
end;
$function$;

drop trigger if exists notifications_link_subject_trg on public.notifications;
create trigger notifications_link_subject_trg
  before insert or update of data, type on public.notifications
  for each row execute function public.notifications_link_subject();

-- ---------------------------------------------------------------------------
-- Backfill every existing row through the same logic.
-- ---------------------------------------------------------------------------
update public.notifications set data = data;

-- ---------------------------------------------------------------------------
-- Remove the orphans that accumulated before the constraints existed: rows
-- whose `data` names a subject that no longer resolves. Every DELETE below is
-- qualified; the matching SELECT counts were run first (post 180, match_post 31,
-- comment 1, community 29, event 14, help 4, conversation 8, message 0).
-- ---------------------------------------------------------------------------
delete from public.notifications n
 where (n.data ? 'post_id'
          and n.subject_post_id is null and n.subject_match_post_id is null)
    or (n.data ? 'comment_id'      and n.subject_comment_id is null)
    or (n.data ? 'community_id'    and n.subject_community_id is null)
    or (n.data ? 'society_id'      and n.subject_community_id is null)
    or (n.data ? 'event_id'        and n.subject_event_id is null)
    or (n.data ? 'request_id'      and n.subject_help_request_id is null)
    or (n.data ? 'conversation_id' and n.subject_conversation_id is null)
    or (n.data ? 'message_id'      and n.subject_message_id is null);

-- ---------------------------------------------------------------------------
-- Defensive read path. Cascades make an orphan impossible going forward, but
-- every reader goes through this view so that one slipping through — or a
-- SOFT-deleted subject, which no cascade can catch — still never renders and
-- never counts toward the bell badge.
-- ---------------------------------------------------------------------------
create or replace view public.notifications_live
with (security_invoker = true)
as
select n.*
  from public.notifications n
 where (not (n.data ? 'post_id')
          or n.subject_post_id is not null
          or n.subject_match_post_id is not null)
   and (not (n.data ? 'comment_id')      or n.subject_comment_id is not null)
   and (not (n.data ? 'community_id')    or n.subject_community_id is not null)
   and (not (n.data ? 'society_id')      or n.subject_community_id is not null)
   and (not (n.data ? 'event_id')        or n.subject_event_id is not null)
   and (not (n.data ? 'request_id')      or n.subject_help_request_id is not null)
   and (not (n.data ? 'conversation_id') or n.subject_conversation_id is not null)
   and (not (n.data ? 'message_id')      or n.subject_message_id is not null)
   -- The only soft delete among the subjects.
   and not exists (
     select 1 from public.messages m
      where m.id = n.subject_message_id and m.deleted_at is not null
   );

grant select on public.notifications_live to authenticated;
