-- 0137 — fix-042: close the gaps left by fix-006 / migration 0132.
--
-- Round 1 (0132) added eight mirrored subject columns with ON DELETE CASCADE and a
-- read-path guard view. It works — but it never covered the subject the user actually
-- reported: a SOCIETY ANNOUNCEMENT. `create_society_announcement` writes a notification
-- whose data carries `announcement_id`, yet 0132 has no `subject_announcement_id`
-- column, so `delete_society_announcement`'s plain DELETE had nothing to cascade to and
-- `notifications_live` had no predicate to hide it. Same story for `help_responses`
-- (`response_id`), emitted by help_response / help_thanked / help_offer_accepted.
--
-- Measured on production before this migration:
--   29 orphaned society_announcement notifications
--   20 orphaned help_response notifications
--
-- Also adds a read-path guard for a subject that is REMOVED rather than deleted: a
-- `match` notification whose pair is no longer matched (unmatch leaves no row to cascade
-- from, because the notification references the other user, not the match row).
--
-- Note the plain `announcement` type (admin_broadcast) is deliberately NOT given a
-- subject: it denormalises title/body/url and has no backing row to delete, so there is
-- nothing for it to dangle from.

-- 1. Two more real FKs with cascade -------------------------------------------------
alter table public.notifications
  add column if not exists subject_announcement_id uuid
    references public.society_announcements(id) on delete cascade,
  add column if not exists subject_help_response_id uuid
    references public.help_responses(id) on delete cascade;

create index if not exists notifications_subject_announcement_idx
  on public.notifications (subject_announcement_id)
  where subject_announcement_id is not null;

create index if not exists notifications_subject_help_response_idx
  on public.notifications (subject_help_response_id)
  where subject_help_response_id is not null;

-- 2. Teach the linking trigger the two new subjects ---------------------------------
--    Unchanged blocks are reproduced verbatim: this is the LATEST redefinition of the
--    function and replaces 0132's body wholesale.
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

  -- new in 0137
  new.subject_announcement_id :=
    (select a.id from public.society_announcements a
      where a.id = nullif(new.data->>'announcement_id', '')::uuid);

  new.subject_help_response_id :=
    (select r.id from public.help_responses r
      where r.id = nullif(new.data->>'response_id', '')::uuid);

  return new;
end;
$function$;

-- 3. Backfill every existing row through the trigger --------------------------------
update public.notifications set data = data;

-- 4. Remove the orphans this exposes ------------------------------------------------
--    Predicate is the `not exists` form that was run as a SELECT first (per the
--    destructive-action rule): it counted 29 + 20 rows.
delete from public.notifications n
 where (n.type = 'society_announcement'
        and not exists (select 1 from public.society_announcements a
                         where a.id = nullif(n.data->>'announcement_id', '')::uuid))
    or (n.data ? 'response_id'
        and not exists (select 1 from public.help_responses r
                         where r.id = nullif(n.data->>'response_id', '')::uuid));

-- 5. Extend the read-path guard -----------------------------------------------------
--    security_invoker stays on so RLS continues to apply to the caller.
create or replace view public.notifications_live
with (security_invoker = true) as
  select id,
         user_id,
         actor_id,
         type,
         data,
         read_at,
         created_at,
         group_key,
         group_count,
         subject_post_id,
         subject_match_post_id,
         subject_comment_id,
         subject_community_id,
         subject_event_id,
         subject_help_request_id,
         subject_conversation_id,
         subject_message_id,
         subject_announcement_id,
         subject_help_response_id
    from public.notifications n
   where (not data ? 'post_id'        or subject_post_id is not null
                                      or subject_match_post_id is not null)
     and (not data ? 'comment_id'     or subject_comment_id is not null)
     and (not data ? 'community_id'   or subject_community_id is not null)
     and (not data ? 'society_id'     or subject_community_id is not null)
     and (not data ? 'event_id'       or subject_event_id is not null)
     and (not data ? 'request_id'     or subject_help_request_id is not null)
     and (not data ? 'conversation_id' or subject_conversation_id is not null)
     and (not data ? 'message_id'     or subject_message_id is not null)
     -- new in 0137
     and (not data ? 'announcement_id' or subject_announcement_id is not null)
     and (not data ? 'response_id'    or subject_help_response_id is not null)
     -- a soft-deleted message is gone as far as the panel is concerned
     and not exists (select 1 from public.messages m
                      where m.id = n.subject_message_id and m.deleted_at is not null)
     -- an unmatched pair: the subject was REMOVED, so nothing cascaded
     and (n.type <> 'match'
          or exists (
            select 1 from public.matches mt
             where mt.user_low  = least(n.user_id, nullif(n.data->>'user_id', '')::uuid)
               and mt.user_high = greatest(n.user_id, nullif(n.data->>'user_id', '')::uuid)
          ));
