-- 0145 — fix-045: admin broadcast with audience targeting.
--
-- The existing `admin_broadcast(title, body, url, segment, department)` only supports
-- "all" / "verified" plus an optional department. This adds the four audiences the fix
-- asks for — a single user, a semester, a degree, a school — while leaving the original
-- function in place so the current admin UI keeps working.
--
-- THE WHOLE POINT IS THAT ONLY THE ADDRESSED PEOPLE RECEIVE IT, so audience resolution
-- lives in ONE function used by both the preview and the send. The preview cannot drift
-- from what actually goes out, because it is literally the same query.
--
-- Semester is resolved with `public.current_semester(username)` — computed from the roll
-- number. The `profiles.semester` COLUMN IS STALE and must never be used for this: it is
-- null/wrong across the table since mig 0099 moved semester to compute-on-read. Targeting
-- a semester off that column would silently address the wrong people, or nobody.
-- "School" is `profiles.department`; this schema has no `school` column.
--
-- Fail-closed: an unrecognised audience matches NOBODY (`else false`), rather than
-- falling through to everyone.

create or replace function public.admin_audience_ids(p_audience text, p_value text)
returns table(id uuid)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id
    from public.profiles p
   where not p.is_banned
     and p.onboarding_completed
     and p.deactivated_at is null
     and case p_audience
           when 'all'      then true
           when 'user'     then p.id = nullif(btrim(p_value), '')::uuid
           when 'semester' then public.current_semester(p.username)
                                = nullif(btrim(p_value), '')::int
           when 'degree'   then p.degree     = p_value
           when 'school'   then p.department = p_value
           else false
         end;
$function$;

-- Options for the admin pickers, populated from real data rather than a hardcoded list.
create or replace function public.admin_audience_options()
returns table(kind text, value text, n integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  with base as (
    select * from public.profiles
     where not is_banned and onboarding_completed and deactivated_at is null
  )
  select 'degree', degree, count(*)::int
    from base where degree is not null group by degree
  union all
  select 'school', department, count(*)::int
    from base where department is not null group by department
  union all
  select 'semester', public.current_semester(username)::text, count(*)::int
    from base where public.current_semester(username) is not null
   group by public.current_semester(username)
   order by 1, 2;
$function$;

-- Preview: the resolved recipient count, shown before the confirm step.
create or replace function public.admin_broadcast_preview(p_audience text, p_value text)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  perform public._admin_guard_super();
  select count(*) into v_count from public.admin_audience_ids(p_audience, p_value);
  return v_count;
end;
$function$;

-- Send. Re-checks the admin role AND re-resolves the audience at send time, so a preview
-- taken minutes earlier can never be what decides delivery.
create or replace function public.admin_broadcast_targeted(
  p_title    text,
  p_body     text,
  p_url      text  default null,
  p_audience text  default 'all',
  p_value    text  default null
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  perform public._admin_guard_super();

  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;

  if p_audience not in ('all', 'user', 'semester', 'degree', 'school') then
    raise exception 'unknown audience: %', p_audience;
  end if;

  -- Every audience except 'all' needs something to target.
  if p_audience <> 'all' and coalesce(btrim(p_value), '') = '' then
    raise exception 'audience "%" requires a value', p_audience;
  end if;

  -- Validate the value's shape up front so a bad cast cannot half-send.
  if p_audience = 'semester' and btrim(p_value) !~ '^\d{1,2}$' then
    raise exception 'semester must be a number';
  end if;
  if p_audience = 'user' and btrim(p_value)
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'user must be a uuid';
  end if;

  -- Fan out to per-user notification rows (the runbook's stated default), so read state
  -- and fix-042's subject cleanup keep working unchanged.
  with ins as (
    insert into public.notifications (user_id, type, data)
    select a.id, 'announcement',
           jsonb_build_object(
             'title', btrim(p_title),
             'body',  btrim(p_body),
             'url',   coalesce(nullif(btrim(p_url), ''), '/activity')
           )
      from public.admin_audience_ids(p_audience, p_value) a
    returning 1
  )
  select count(*) into v_count from ins;

  perform public.log_admin_action('broadcast', btrim(p_title), null, null, null,
    jsonb_build_object('audience', p_audience, 'value', p_value,
                       'recipients', v_count, 'body', btrim(p_body)));

  return v_count;
end;
$function$;

revoke all on function public.admin_audience_ids(text, text) from public, anon;
revoke all on function public.admin_audience_options() from public, anon;
revoke all on function public.admin_broadcast_preview(text, text) from public, anon;
revoke all on function public.admin_broadcast_targeted(text, text, text, text, text) from public, anon;
grant execute on function public.admin_audience_options() to authenticated;
grant execute on function public.admin_broadcast_preview(text, text) to authenticated;
grant execute on function public.admin_broadcast_targeted(text, text, text, text, text) to authenticated;
