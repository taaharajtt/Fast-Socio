-- Public profiles showed an inaccurate match count: 0 or 1 regardless of the
-- real total. Root cause is `public.matches` RLS ("users read their own
-- matches", user_low = auth.uid() or user_high = auth.uid()) — a query run AS
-- the viewer for `matches where user_low = target or user_high = target` can
-- only return rows that ALSO satisfy the viewer being a participant, so the
-- intersection is just the (at most one) match between the viewer and the
-- target, never the target's real total.
--
-- Fix: a SECURITY DEFINER function that returns only an aggregate count for a
-- given user, bypassing RLS. This exposes strictly less than what the profile
-- page already renders today (a bare integer, no counterpart identities), and
-- matches count has never been gated by a privacy toggle on this profile page.
set check_function_bodies = off;

create or replace function public.get_match_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.matches
  where user_low = p_user_id or user_high = p_user_id;
$$;

grant execute on function public.get_match_count(uuid) to authenticated;
