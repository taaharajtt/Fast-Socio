-- =============================================================================
-- FAST SOCIO — Incremental denormalized counters (audit fix P4-03)
--
-- The counter triggers recomputed the whole aggregate on every write
-- (like_count = count(*), aura_score = sum(delta), …). That is O(n) per write,
-- so a viral post recounts ALL its likes on every new like — O(n^2) overall.
-- Switch to incremental +1/-1 (the standard large-scale approach): a single
-- row UPDATE per event, serialized by the row lock, so it stays correct under
-- concurrency. greatest(...,0) floors any transient drift. The counters are
-- currently consistent (the recount was authoritative), so incremental takes
-- over from a correct baseline — no backfill needed.
-- =============================================================================

set check_function_bodies = off;

-- ---- post likes -----------------------------------------------------------
create or replace function public.sync_like_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end; $$;

-- ---- post comments --------------------------------------------------------
create or replace function public.sync_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end; $$;

-- ---- community members -----------------------------------------------------
create or replace function public.sync_member_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.communities set member_count = member_count + 1 where id = new.community_id;
  elsif tg_op = 'DELETE' then
    update public.communities set member_count = greatest(member_count - 1, 0) where id = old.community_id;
  end if;
  return null;
end; $$;

-- ---- event attendees -------------------------------------------------------
create or replace function public.sync_attendee_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.events set attendee_count = attendee_count + 1 where id = new.event_id;
  elsif tg_op = 'DELETE' then
    update public.events set attendee_count = greatest(attendee_count - 1, 0) where id = old.event_id;
  end if;
  return null;
end; $$;

-- ---- aura score (sum of ledger deltas) ------------------------------------
-- Applies just the change instead of re-summing the whole ledger. Still runs as
-- SECURITY DEFINER (owner), so protect_profile_columns (now guarded on
-- current_user, see 0022) does NOT revert the write.
create or replace function public.recompute_aura_score()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set aura_score = aura_score + new.delta where id = new.user_id;
  elsif tg_op = 'DELETE' then
    update public.profiles set aura_score = aura_score - old.delta where id = old.user_id;
  elsif tg_op = 'UPDATE' then
    if new.user_id = old.user_id then
      update public.profiles set aura_score = aura_score + (new.delta - old.delta) where id = new.user_id;
    else
      update public.profiles set aura_score = aura_score - old.delta where id = old.user_id;
      update public.profiles set aura_score = aura_score + new.delta where id = new.user_id;
    end if;
  end if;
  return null;
end; $$;

-- Maintenance: reconcile any counter drift (e.g. after a bulk data fix). Not run
-- automatically — call manually if needed.
create or replace function public.reconcile_counters()
returns void language sql security definer set search_path = public as $$
  update public.posts p set
    like_count    = (select count(*) from public.post_likes    where post_id = p.id),
    comment_count = (select count(*) from public.post_comments where post_id = p.id);
  update public.communities c set
    member_count = (select count(*) from public.community_members where community_id = c.id);
  update public.events e set
    attendee_count = (select count(*) from public.event_attendees where event_id = e.id);
$$;
