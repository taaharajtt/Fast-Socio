-- 0148: guard the admin audience helpers
--
-- admin_audience_ids() and admin_audience_options() are SECURITY DEFINER and
-- executable by `authenticated`, but neither checked the caller. Any logged-in
-- student could therefore enumerate the entire active user set — verified live:
-- a non-admin session received 147 profile ids — and read the demographic
-- aggregates behind the broadcast composer.
--
-- Not a privilege-escalation path (roles are protected by column-level grants,
-- the protect_profile_columns trigger, and _admin_guard_super in every
-- privileged RPC), but it is exactly the mass-enumeration class the earlier
-- audit left open, and it defeats a user's choice not to be discoverable.
--
-- Cause: both were introduced as plain SQL functions (0145/0146), where the
-- `perform public._admin_guard()` idiom used by every other admin_* function
-- is not available. They are converted to plpgsql for no reason other than to
-- let the guard RAISE, matching the rest of the admin surface. A WHERE-clause
-- check would silently return an empty set instead, hiding the authorization
-- failure from both the caller and the logs.
--
-- Query bodies, volatility, SECURITY DEFINER and search_path are unchanged, so
-- admin behaviour is identical (verified: 147 ids / 18 rows / 5 verified both
-- before and after).

CREATE OR REPLACE FUNCTION public.admin_audience_ids(p_audience text, p_value text)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._admin_guard();
  return query
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
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_audience_options()
 RETURNS TABLE(kind text, value text, n integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._admin_guard();
  return query
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
end;
$function$;
