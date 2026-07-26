-- Privacy fix: notify_help_response() unconditionally passed new.author_id as
-- the actor, leaking an anonymous helper's identity to the request author via
-- the notifications -> profiles join. Mask actor_id when is_anonymous.

create or replace function public.notify_help_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_actor  uuid;
begin
  select author_id into v_author from public.help_requests where id = new.request_id;
  v_actor := case when new.is_anonymous then null else new.author_id end;

  perform public.create_notification(
    v_author, v_actor, 'help_response', 'help',
    jsonb_build_object('request_id', new.request_id, 'response_id', new.id, 'is_anonymous', new.is_anonymous));
  return null;
end;
$$;

-- Backfill: sanitize already-leaked notification rows from anonymous responses.
update public.notifications n
   set actor_id = null
 where n.type = 'help_response'
   and n.actor_id is not null
   and exists (
     select 1 from public.help_responses r
      where r.id = (n.data->>'response_id')::uuid
        and r.is_anonymous = true
   );
