-- 0144 — fix-056: a real matches list, and your matches' matches (one hop only).
--
-- WHERE THE ONE-HOP RULE IS ENFORCED.
-- `matches` has RLS enabled with a single SELECT policy, `user_low = auth.uid() or
-- user_high = auth.uid()` — a user can only ever read rows they are part of. So a
-- second-degree list is impossible to obtain by direct query, and hand-crafting a
-- PostgREST request against `matches` cannot walk the graph. These definer RPCs are the
-- only path that can return someone else's matches, which makes the `exists(...)` guard
-- inside `get_matches_of` the actual enforcement, with RLS as the backstop for every
-- other route. Same shape as fix-043: the definer function is the boundary, and the base
-- table stays stricter than the feature.
--
-- Asking for the matches of someone you are NOT matched with returns an EMPTY SET rather
-- than raising. A raise would confirm that the target exists and has matches; an empty
-- list is indistinguishable from "they have none", which is the safer answer.

-- The match percentage as a callable function, so the matches page and any future
-- surface share one definition. This is the same formula as migration 0140 and
-- `src/lib/discover/match-score.ts`:
--   interests 7 x min(s,6) + 8 x e/(e+6) (e = max(s-6,0)), opposite gender 15,
--   same semester 13, DIFFERENT school 12, same batch 10, clamped to 5..99, fail-closed
--   on any unknown. 0140's deck keeps the formula inlined for per-row performance;
--   if you change one, change all three.
create or replace function public.match_percentage(p_a uuid, p_b uuid)
returns smallint
language sql
stable security definer
set search_path to 'public'
as $function$
  with a as (
    select interests,
           lower(nullif(btrim(gender), ''))   as g,
           department                          as d,
           public.current_semester(username)   as sem,
           public.roll_batch_year(username)    as b
      from public.profiles where id = p_a
  ), z as (
    select interests,
           lower(nullif(btrim(gender), ''))   as g,
           department                          as d,
           public.current_semester(username)   as sem,
           public.roll_batch_year(username)    as b
      from public.profiles where id = p_b
  ), s as (
    select coalesce(array_length(
             array(select unnest(a.interests) intersect select unnest(z.interests)), 1
           ), 0) as n
      from a, z
  )
  select least(99, greatest(5, round(
      7 * least(s.n, 6)
    + 8.0 * greatest(s.n - 6, 0) / (greatest(s.n - 6, 0) + 6)
    + (case when a.g in ('male','female') and z.g in ('male','female') and a.g <> z.g
            then 15 else 0 end)
    + (case when a.sem is not null and z.sem is not null and a.sem = z.sem
            then 13 else 0 end)
    + (case when a.d is not null and z.d is not null and a.d <> z.d
            then 12 else 0 end)
    + (case when a.b is not null and z.b is not null and a.b = z.b
            then 10 else 0 end)
  )))::smallint
  from a, z, s;
$function$;

-- First degree: the viewer's own matches, with the percentage between them.
create or replace function public.get_my_matches()
returns table(
  id uuid, full_name text, username text, avatar_url text, gender text,
  department text, verified boolean, match_percentage smallint,
  matched_at timestamptz
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, p.username, p.avatar_url, p.gender,
         p.department, coalesce(p.verified, false),
         public.match_percentage((select auth.uid()), p.id),
         m.created_at
    from public.matches m
    join public.profiles p
      on p.id = case when m.user_low = (select auth.uid()) then m.user_high else m.user_low end
   where ((select auth.uid()) in (m.user_low, m.user_high))
     and p.deactivated_at is null
     and not p.is_banned
   order by m.created_at desc;
$function$;

-- Second degree: the matches of someone the viewer has matched with. One hop only.
-- NOTE the deliberate absence of `match_percentage` — the score between those two people
-- is not the viewer's to see (the runbook's stated privacy default).
create or replace function public.get_matches_of(p_user uuid)
returns table(
  id uuid, full_name text, username text, avatar_url text, gender text,
  department text, verified boolean, matched_at timestamptz
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, p.username, p.avatar_url, p.gender,
         p.department, coalesce(p.verified, false), m.created_at
    from public.matches m
    join public.profiles p
      on p.id = case when m.user_low = p_user then m.user_high else m.user_low end
   where (p_user in (m.user_low, m.user_high))
     -- the viewer never appears in their own second-degree list
     and p.id <> (select auth.uid())
     and p.deactivated_at is null
     and not p.is_banned
     -- THE ONE HOP: the caller must themselves be matched with p_user
     and exists (
       select 1 from public.matches g
        where g.user_low  = least((select auth.uid()), p_user)
          and g.user_high = greatest((select auth.uid()), p_user)
     )
   order by m.created_at desc;
$function$;

revoke all on function public.get_my_matches() from public;
revoke all on function public.get_matches_of(uuid) from public;
revoke all on function public.match_percentage(uuid, uuid) from public;
grant execute on function public.get_my_matches() to authenticated;
grant execute on function public.get_matches_of(uuid) to authenticated;
grant execute on function public.match_percentage(uuid, uuid) to authenticated;
