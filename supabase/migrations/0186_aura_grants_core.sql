-- =============================================================================
-- 0186 — Aura integrity, part 1: a source identity for every automated reward.
--
-- THE INVARIANT THIS EXISTS TO ENFORCE
--
--   Aura represents currently valid or legitimately completed activity. No
--   sequence of create/delete, match/unmatch, RSVP/withdraw, select/reselect or
--   retry may leave a user with more Aura, XP or badges than doing the thing
--   once, honestly, would have.
--
-- WHAT WAS ACTUALLY BROKEN (audited across every effective definition, not the
-- first migration that mentions each function):
--
--   post_created      +2 on insert (0008). NOTHING reverses it. Post, collect,
--                     delete, repeat — unbounded.
--   comment_received  0181 fixed the per-(post,commenter) rule and the delete
--                     path, but deleting the POST cascades the grant rows away
--                     before anything reconciles, so the author keeps Aura for
--                     comments that no longer exist.
--   match             +10 each on match insert (latest: 0185). unmatch_user()
--                     reverses nothing AND clears both swipes, so the same pair
--                     can rematch and be paid again, forever.
--   event_attend      +15 on RSVP (0010), -15 on withdrawal — but XP counts
--                     only POSITIVE ledger rows, so the XP and any level
--                     survive the refund. Check-in pays a further +5 (0101)
--                     that nothing ever reverses.
--   help_thanked      +15 keyed on RESPONSE id (0110). One request can hold
--                     many responses, and the owner may select each in turn.
--   profile_completed `select exists(...)` then insert (0051) — a plain race.
--   achievement       paid once per code (0151) but never revoked when the
--                     qualifying state disappears; the metrics are counted from
--                     live rows that the user can delete.
--
-- ---------------------------------------------------------------------------
-- THE MODEL
--
-- `aura_transactions` stays exactly what it is: an append-only, financial-style
-- ledger. Nothing here deletes or rewrites a ledger row, and
-- profiles.aura_score remains SUM(delta) maintained by 0028's incremental
-- trigger.
--
-- What was missing is the OTHER half of a ledger: the notion of a live
-- position. `aura_grants` is that — one row per logical reward, carrying the
-- source that justifies it and whether it is still active. The ledger records
-- the movements; the grant table records what is currently owed.
--
--     award    insert a grant + append a positive ledger row   (no-op if the
--              source already has an active grant)
--     reverse  mark the grant reversed + append the exact negative
--              (no-op if there is no active grant — NEVER a second deduction)
--
-- One partial unique index on `source_key where reversed_at is null` is the
-- whole concurrency story. Not `select exists` then insert: the index makes a
-- second active grant for the same source unrepresentable, so simultaneous
-- first comments, double check-in scans and racing profile saves all collapse
-- to one paid reward without any advisory lock.
--
-- ---------------------------------------------------------------------------
-- XP STOPS BEING "SUM OF POSITIVE LEDGER ROWS"
--
-- That definition is what made every reversal a laundering opportunity: refund
-- the Aura, keep the XP and the level. XP is now the sum of ACTIVE GRANTS, so a
-- reversal removes its own XP contribution by construction and cycling nets to
-- zero in both currencies.
--
-- Deliberate consequences, each chosen:
--   * A negative admin adjustment does NOT erase XP. Penalties are an Aura
--     matter; stripping levels for a moderation deduction would punish twice
--     and is not what admin_adjust_aura is for.
--   * A POSITIVE admin adjustment does grant XP (it is a real award), through a
--     permanent, never-auto-reversed grant.
--   * A ledger row with no grant behind it contributes no XP at all. That is
--     the point: only rewards with a source that can be checked are eligible.
--
-- NOBODY'S XP MOVES ON DEPLOY. Every existing positive ledger row is backfilled
-- as a `legacy` grant of the same amount, so the sum is identical the moment
-- this lands. Legacy grants are permanent — history is not retroactively
-- judged, and no Aura is deducted from anyone by this migration.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. aura_grants — the private register of live rewards.
-- ---------------------------------------------------------------------------
-- PRIVATE. RLS on, NO policies, no grants to anon/authenticated. A student
-- cannot read it (it would expose, among other things, which anonymous post
-- earned whom what), and certainly cannot write it. Every mutation goes through
-- the two definer helpers below, which are themselves revoked from every client
-- role — there is no "award Aura" RPC anywhere in this design.
create table if not exists public.aura_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  reason       public.aura_reason not null,
  -- What KIND of thing justifies this reward ('post', 'comment', 'match',
  -- 'event_checkin', 'help', 'profile', 'achievement', 'admin', 'legacy').
  source_type  text not null,
  -- The canonical logical key, e.g. 'post:<uuid>' or 'match:<lo>:<hi>:<user>'.
  -- Uniqueness is enforced on this while the grant is active.
  source_key   text not null,
  amount       integer not null check (amount > 0),
  metadata     jsonb not null default '{}'::jsonb,
  granted_at   timestamptz not null default now(),
  reversed_at  timestamptz,
  -- The ledger rows on both sides, so an auditor can walk grant -> movement.
  grant_tx_id   uuid references public.aura_transactions (id) on delete set null,
  reverse_tx_id uuid references public.aura_transactions (id) on delete set null
);

-- THE constraint. At most one ACTIVE grant per logical source, enforced by the
-- database rather than by a read-then-write in application code.
create unique index if not exists aura_grants_active_source_uidx
  on public.aura_grants (source_key)
  where reversed_at is null;

create index if not exists aura_grants_user_active_idx
  on public.aura_grants (user_id) where reversed_at is null;
create index if not exists aura_grants_source_type_idx
  on public.aura_grants (source_type, granted_at desc);

alter table public.aura_grants enable row level security;
revoke all on public.aura_grants from anon, authenticated;

comment on table public.aura_grants is
  'PRIVATE. One row per logical automated Aura reward, with the source that justifies it and whether it is still active. XP is the sum of active grants. RLS on with NO policies and no client grants; written only by aura_award()/aura_reverse(). See migration 0186.';

-- ---------------------------------------------------------------------------
-- 2. aura_award / aura_reverse — the only way an automated reward moves.
-- ---------------------------------------------------------------------------
-- Neither takes a delta from anywhere a client can reach: the amount is passed
-- by the trigger or RPC that knows the product rule, and both functions are
-- revoked from public, anon and authenticated. There is deliberately no generic
-- "give user X n Aura" entry point.
--
-- aura_award is IDEMPOTENT on the source key. Awarding an already-active source
-- returns false and writes nothing — not a second ledger row, not a duplicate
-- grant. That is what makes retries, double-fired triggers and concurrent
-- requests safe.
create or replace function public.aura_award(
  p_user        uuid,
  p_amount      integer,
  p_reason      public.aura_reason,
  p_source_type text,
  p_source_key  text,
  p_metadata    jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant uuid;
  v_tx    uuid;
begin
  if p_user is null or p_source_key is null or coalesce(p_amount, 0) <= 0 then
    return false;
  end if;

  -- The unique index does the work: a concurrent duplicate loses here rather
  -- than after a racy existence check.
  insert into public.aura_grants
    (user_id, reason, source_type, source_key, amount, metadata)
  values
    (p_user, p_reason, p_source_type, p_source_key, p_amount,
     coalesce(p_metadata, '{}'::jsonb))
  on conflict (source_key) where reversed_at is null do nothing
  returning id into v_grant;

  if v_grant is null then
    return false;   -- already active. No movement, no error.
  end if;

  insert into public.aura_transactions (user_id, delta, reason, metadata)
  values (p_user, p_amount, p_reason,
          coalesce(p_metadata, '{}'::jsonb)
            || jsonb_build_object('source_key', p_source_key,
                                  'grant_id', v_grant))
  returning id into v_tx;

  update public.aura_grants set grant_tx_id = v_tx where id = v_grant;
  return true;
end;
$$;

-- aura_reverse is idempotent in the other direction: reversing a source with no
-- active grant is a NO-OP, never a second deduction. That is the property that
-- makes cascade deletes, retried deletions and double-fired triggers safe.
create or replace function public.aura_reverse(
  p_source_key text,
  p_metadata   jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant  uuid;
  v_user   uuid;
  v_amount integer;
  v_reason public.aura_reason;
  v_tx     uuid;
begin
  if p_source_key is null then
    return false;
  end if;

  -- Claim the grant atomically. If another transaction reversed it first, this
  -- updates zero rows and we stop — no ledger movement.
  update public.aura_grants
     set reversed_at = now()
   where source_key = p_source_key
     and reversed_at is null
  returning id, user_id, amount, reason into v_grant, v_user, v_amount, v_reason;

  if v_grant is null then
    return false;
  end if;

  insert into public.aura_transactions (user_id, delta, reason, metadata)
  values (v_user, -v_amount, v_reason,
          coalesce(p_metadata, '{}'::jsonb)
            || jsonb_build_object('source_key', p_source_key,
                                  'grant_id', v_grant,
                                  'reversal', true))
  returning id into v_tx;

  update public.aura_grants set reverse_tx_id = v_tx where id = v_grant;
  return true;
end;
$$;

comment on function public.aura_award(uuid, integer, public.aura_reason, text, text, jsonb) is
  'Award an automated reward for a logical source, once. No-op if that source already has an active grant. Definer, never client-callable. See migration 0186.';
comment on function public.aura_reverse(text, jsonb) is
  'Reverse the active grant for a logical source, once. No-op if there is none — never a second deduction. Definer, never client-callable. See migration 0186.';

revoke all on function public.aura_award(uuid, integer, public.aura_reason, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.aura_reverse(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. XP = sum of ACTIVE grants.
-- ---------------------------------------------------------------------------
-- Replaces 0055's "sum every positive ledger row", which is the bug that let a
-- refunded RSVP keep its XP and its level.
--
-- LEVEL-UP NOTIFICATIONS ARE DEDUPED BY LEVEL. Reversal-and-re-award cycles
-- cross the same boundary repeatedly, and 0055 would have sent "You reached
-- level 4!" every time. A level only announces itself once per user, ever.
create or replace function public.recompute_xp_for(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_xp    integer;
  new_level integer;
  old_level integer;
begin
  if p_user is null then
    return;
  end if;

  select coalesce(level, 1) into old_level from public.profiles where id = p_user;

  select coalesce(sum(amount), 0)::int into new_xp
    from public.aura_grants
   where user_id = p_user and reversed_at is null;

  new_level := public.xp_level(new_xp);

  update public.profiles
     set xp = new_xp, level = new_level
   where id = p_user;

  if new_level > coalesce(old_level, 1)
     and not exists (
       select 1 from public.notifications
        where user_id = p_user
          and type = 'level_up'
          and data->>'level' = new_level::text
     ) then
    perform public.create_notification(
      p_user, null, 'level_up', 'system',
      jsonb_build_object('level', new_level)
    );
  end if;
end;
$$;

revoke all on function public.recompute_xp_for(uuid) from public, anon, authenticated;

create or replace function public.trg_recompute_xp_from_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_xp_for(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;

drop trigger if exists aura_grants_recompute_xp on public.aura_grants;
create trigger aura_grants_recompute_xp
  after insert or update or delete on public.aura_grants
  for each row execute function public.trg_recompute_xp_from_grant();

revoke all on function public.trg_recompute_xp_from_grant() from public, anon, authenticated;

-- The ledger no longer drives XP. 0055's trigger is dropped rather than left
-- firing a superseded rule — two definitions of XP is exactly the drift this
-- migration exists to remove. `recompute_aura_score` on the same table is
-- UNTOUCHED: profiles.aura_score is still SUM(delta), maintained incrementally.
drop trigger if exists aura_transactions_recompute_xp on public.aura_transactions;

-- ---------------------------------------------------------------------------
-- 4. Backfill: preserve history exactly, judge nothing retroactively.
-- ---------------------------------------------------------------------------
-- One `legacy` grant per existing POSITIVE ledger row, of the same amount. XP
-- therefore comes out of this migration bit-identical to what it was, and no
-- user loses Aura, XP, a level or a badge on deploy.
--
-- Legacy grants are PERMANENT by design. Nothing in part 2 reverses a
-- source_type of 'legacy', because these rows have no reliable source id to
-- check against — 0008's post_created rows, for instance, never recorded which
-- post they were for. Suspicious history is REPORTED (part 3's audit views),
-- never silently deducted.
--
-- Keyed on the ledger row's own id, so re-running this migration cannot
-- double-grant and the unique index proves it.
-- THE TRIGGER IS DISABLED FOR THE BACKFILL, and this is a correctness measure,
-- not an optimisation.
--
-- recompute_xp_for compares the level it computes against the level currently
-- on the profile, and announces an increase. Inserting a user's grants one row
-- at a time walks their XP up from zero, so the second row would see "level 2 >
-- level 1" and fire a level-up notification, the third "3 > 2", and so on —
-- a notification storm, sent to every user, for levels they reached months ago.
-- (The per-level dedup added above catches most of it, but only for levels a
-- user has already been notified about; anyone who levelled up before 0055's
-- silent backfill would be spammed.)
--
-- With the trigger off, profiles.level stays exactly where it is throughout,
-- and the single settle at the end computes the same XP the user already had —
-- so no level changes, and nothing is announced.
alter table public.aura_grants disable trigger aura_grants_recompute_xp;

insert into public.aura_grants
  (user_id, reason, source_type, source_key, amount, metadata, granted_at, grant_tx_id)
select t.user_id, t.reason, 'legacy', 'legacy:' || t.id::text, t.delta,
       jsonb_build_object('backfilled', true), t.created_at, t.id
  from public.aura_transactions t
 where t.delta > 0
on conflict (source_key) where reversed_at is null do nothing;

alter table public.aura_grants enable trigger aura_grants_recompute_xp;

-- Settle every profile once, in one pass. XP lands on the same number it held
-- before this migration (the legacy grants reproduce the old "sum of positive
-- ledger rows" exactly), so no level moves and no notification is sent.
do $$
declare u uuid;
begin
  for u in select distinct user_id from public.aura_grants loop
    perform public.recompute_xp_for(u);
  end loop;
end $$;

-- =============================================================================
-- VERIFY
--   -- XP must equal the sum of active grants, for everyone:
--   select count(*) from public.profiles p
--    where coalesce(p.xp,0) <> coalesce(
--      (select sum(amount) from public.aura_grants g
--        where g.user_id = p.id and g.reversed_at is null), 0);
--   -- must be 0.
--
--   -- The cache must still equal the ledger:
--   select count(*) from public.profiles p
--    where coalesce(p.aura_score,0) <> coalesce(
--      (select sum(delta) from public.aura_transactions t where t.user_id = p.id), 0);
--   -- must be 0.
--
-- ROLLBACK
--   Re-run 0055's recompute_xp_level + its trigger on aura_transactions, then:
--     drop trigger if exists aura_grants_recompute_xp on public.aura_grants;
--     drop function if exists public.trg_recompute_xp_from_grant();
--     drop function if exists public.recompute_xp_for(uuid);
--     drop function if exists public.aura_reverse(text, jsonb);
--     drop function if exists public.aura_award(uuid, integer, public.aura_reason, text, text, jsonb);
--     drop table if exists public.aura_grants;
--   No ledger row is created or destroyed by this migration, so a rollback
--   loses only the grant register, not anybody's Aura.
-- =============================================================================
