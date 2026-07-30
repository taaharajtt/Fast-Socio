-- 0146 — fix-045 follow-up: keep the existing "Verified only" segment reachable.
--
-- 0145 added the four audiences the fix asked for (user / semester / degree /
-- school) but not `verified`, which the current admin UI already offers via the
-- older `admin_broadcast`. Without this, rebuilding the composer on the targeted
-- path would have silently DROPPED an audience admins use today.
--
-- Adding it here means one send path serves every audience, rather than the UI
-- branching between two RPCs depending on what was picked.

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
           when 'verified' then coalesce(p.verified, false)
           when 'user'     then p.id = nullif(btrim(p_value), '')::uuid
           when 'semester' then public.current_semester(p.username)
                                = nullif(btrim(p_value), '')::int
           when 'degree'   then p.degree     = p_value
           when 'school'   then p.department = p_value
           else false
         end;
$function$;

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

  if p_audience not in ('all', 'verified', 'user', 'semester', 'degree', 'school') then
    raise exception 'unknown audience: %', p_audience;
  end if;

  -- 'all' and 'verified' address a whole population; the rest need a target.
  if p_audience not in ('all', 'verified')
     and coalesce(btrim(p_value), '') = '' then
    raise exception 'audience "%" requires a value', p_audience;
  end if;

  if p_audience = 'semester' and btrim(p_value) !~ '^\d{1,2}$' then
    raise exception 'semester must be a number';
  end if;
  if p_audience = 'user' and btrim(p_value)
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'user must be a uuid';
  end if;

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
