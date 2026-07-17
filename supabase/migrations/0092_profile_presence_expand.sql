-- =============================================================================
-- FAST SOCIO — F16 part 2: make `show_online` real (expand)
--
-- THE PROBLEM
-- `show_online` is a lie in two different ways:
--
--  1. API bypass. profiles SELECT is `using (true)` and last_seen_at is just a
--     column, so `GET /rest/v1/profiles?select=id,last_seen_at` returns live
--     presence for every user regardless of their setting. Verified on live
--     2026-07-17: 27 users have last_seen_at, and 1 of them has show_online
--     = false and leaks anyway.
--
--  2. The app doesn't even honour it. src/app/(student)/chat/page.tsx and
--     chat/[id]/page.tsx render the online dot straight off last_seen_at with
--     no show_online check — only profile/[id]/page.tsx checks. So a user who
--     switches presence off still shows as online in chat. That is a plain bug,
--     independent of any attacker.
--
-- For a campus dating app, "is this person online right now, and when were they
-- last active" is a stalking signal. A toggle that claims to control it and
-- doesn't is worse than having no toggle.
--
-- WHY NOT JUST HIDE THE COLUMN
-- RLS is row-aware but column-blind; column grants are the reverse. Neither can
-- say "show last_seen_at only when its owner allows it". A column-level revoke
-- would hide it from everyone including its owner, and a SECURITY DEFINER view
-- would have to bypass profiles' RLS to read it — trading a known leak for a
-- new bypass surface.
--
-- THE FIX — the same move as 0089
-- Move presence into its own row. Once "your last_seen_at" is a ROW rather than
-- a column, the visibility rule is expressible as an ordinary RLS policy, and
-- Postgres enforces it for every caller: app, PostgREST, curl, anything.
--
-- It also fails closed and fixes bug (2) for free: if you have presence off,
-- your row is invisible, the app gets nothing back, and isOnline(null) is
-- false — offline. No client-side check to forget.
--
-- Clients get SELECT only. last_seen_at was never client-writable (it is not in
-- 0084's UPDATE allowlist) and stays that way: touch_last_seen() is SECURITY
-- DEFINER and owns every write.
--
-- Expand only. profiles.last_seen_at stays until 0093 so the app deploy can
-- land in between.
-- =============================================================================
set check_function_bodies = off;

create table if not exists public.profile_presence (
  id           uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz
);

alter table public.profile_presence enable row level security;

-- The whole feature, as one policy: you always see your own presence; you see
-- someone else's only if they publish it. `(select auth.uid())` for the 0032
-- InitPlan hoist.
drop policy if exists "presence visible when shared" on public.profile_presence;
create policy "presence visible when shared" on public.profile_presence
  for select using (
    id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = public.profile_presence.id
        and p.show_online
    )
  );

-- No insert/update/delete policy and no write grant: touch_last_seen() is
-- definer and is the only writer. A client cannot forge or clear presence.
revoke all on public.profile_presence from anon, authenticated;
grant select on public.profile_presence to authenticated;

insert into public.profile_presence (id, last_seen_at)
select p.id, p.last_seen_at from public.profiles p
on conflict (id) do nothing;

-- Repoint the heartbeat. Same definer, same contract, new destination.
-- The `where auth.uid() is not null` guard keeps an unauthenticated call from
-- attempting a null-id insert.
create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.profile_presence (id, last_seen_at)
  select auth.uid(), now()
  where auth.uid() is not null
  on conflict (id) do update set last_seen_at = now();
$function$;
