-- =============================================================================
-- FAST SOCIO — Fix usernames to the campus roll number (email local-part)
--
-- Product decision: a user's username is no longer a free-form, changeable
-- handle. It is permanently their roll number, i.e. the local-part of their
-- campus email — e.g. i240733@isb.nu.edu.pk  ->  username "i240733". Signups
-- are already restricted to @isb.nu.edu.pk (mig 0031), where the local-part IS
-- the roll number, so this is exact for every real account.
--
-- This migration:
--   1. Adds username_from_email(): the canonical email -> username derivation.
--   2. Drops the 30-day username-change cooldown (mig 0058) — obsolete now that
--      usernames never change.
--   3. Backfills every existing profile's username from its auth email.
--   4. Teaches handle_new_user() to assign the roll-number username at signup.
--   5. Installs an immutability trigger: a username may be set once (null ->
--      value) but never changed thereafter.
--   6. Revokes the `username` column from the client UPDATE allowlist (mig
--      0084), so `authenticated` cannot write it at all. This is the primary,
--      fail-closed guard; the immutability trigger is defense-in-depth.
--
-- Idempotent: safe to re-run.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Canonical derivation. Lower-case the email, take the part before '@',
--    strip anything outside [a-z0-9_], and cap at the 20-char username limit.
-- ---------------------------------------------------------------------------
create or replace function public.username_from_email(p_email text)
returns text
language sql
immutable
as $$
  select left(
    regexp_replace(split_part(lower(coalesce(p_email, '')), '@', 1), '[^a-z0-9_]', '', 'g'),
    20
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Retire the change-cooldown (mig 0058). Usernames are fixed now, so a
--    "once every 30 days" rule is meaningless; drop it before the backfill so
--    it neither blocks nor stamps the bulk update.
-- ---------------------------------------------------------------------------
drop trigger if exists profiles_username_cooldown on public.profiles;
drop function if exists public.enforce_username_cooldown();

-- ---------------------------------------------------------------------------
-- 3. Backfill existing usernames from the campus email.
--
--    Clear first, then reassign. A blanket null pass avoids transient unique
--    collisions: a user's new roll-number username may currently be held by a
--    different user as an old custom handle, and a non-deferrable unique index
--    would reject that mid-statement. Multiple NULLs never collide, and the
--    reassign targets are all distinct, so the two-step is collision-proof.
--    Username is not rendered anywhere but the read-only settings field, so the
--    momentary null is invisible.
--
--    Roll numbers are unique per campus, but a pre-0031 cross-campus account
--    could share a local-part (i240733@isb vs i240733@khi). The row_number
--    suffix guarantees uniqueness against the unique index in that rare case.
-- ---------------------------------------------------------------------------
update public.profiles set username = null;

with ranked as (
  select
    u.id,
    public.username_from_email(u.email) as base,
    row_number() over (
      partition by public.username_from_email(u.email)
      order by u.created_at, u.id
    ) as rn
  from auth.users u
)
update public.profiles p
set username = case
    when rn = 1 then base
    else left(base, 20 - length(rn::text)) || rn::text
  end
from ranked
where ranked.id = p.id
  and length(ranked.base) >= 3;

-- ---------------------------------------------------------------------------
-- 4. Signup: assign the roll-number username when the auth user is created.
--    Roll numbers are effectively unique, but loop-check against the unique
--    index so a collision can never fail the signup insert. Runs SECURITY
--    DEFINER (as owner), so it bypasses the column-level revoke in step 6.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base     text := public.username_from_email(new.email);
  v_username text;
  v_suffix   int := 0;
begin
  -- Degenerate fallback (an email whose local-part sanitizes to < 3 chars): a
  -- stable derived handle so the NOT-empty username invariant always holds.
  if length(v_base) < 3 then
    v_base := left('user' || replace(new.id::text, '-', ''), 20);
  end if;

  v_username := v_base;
  while exists (select 1 from public.profiles where username = v_username) loop
    v_suffix := v_suffix + 1;
    v_username := left(v_base, 20 - length(v_suffix::text)) || v_suffix::text;
  end loop;

  insert into public.profiles (id, full_name, username)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', null),
      v_username
    )
    on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Immutability (defense-in-depth). Allow the first assignment (null ->
--    value) so the signup trigger and any future backfill can populate it;
--    reject every later change.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_username_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.username is not null and new.username is distinct from old.username then
    raise exception 'username is fixed to your roll number and cannot be changed'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_username_immutable on public.profiles;
create trigger profiles_username_immutable
  before update on public.profiles
  for each row execute function public.enforce_username_immutable();

-- ---------------------------------------------------------------------------
-- 6. Primary guard: remove `username` from the client UPDATE allowlist (mig
--    0084). `authenticated`/`anon` can no longer write the column at all; only
--    SECURITY DEFINER paths (handle_new_user) touch it.
-- ---------------------------------------------------------------------------
revoke update (username) on public.profiles from authenticated, anon;
