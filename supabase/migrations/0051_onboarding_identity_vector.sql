-- =============================================================================
-- FAST SOCIO — Refactor Phase 2: Onboarding Identity Vector.
--
-- Additive only. Extends profiles with the structured attributes the Discover
-- compatibility engine (Phase 4) and feed ranking (Phase 3) consume, plus the
-- machinery for a resumable multi-step wizard (onboarding_step) and a cached
-- completeness score with a one-time Aura bonus.
--
-- Nothing existing is dropped. The onboarding action keeps writing the same
-- columns it always did; these are new optional fields alongside them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Identity-vector columns (all optional / defaulted → safe for existing rows)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists display_name      text,
  add column if not exists pronouns          text,
  add column if not exists date_of_birth     date,
  add column if not exists personality       text[] not null default '{}',
  add column if not exists languages         text[] not null default '{}',
  add column if not exists hostel_status     text
    check (hostel_status is null or hostel_status in ('hostelite', 'day_scholar')),
  add column if not exists graduation_year   smallint
    check (graduation_year is null or graduation_year between 2000 and 2100),
  add column if not exists hometown          text,
  add column if not exists relationship_pref text
    check (relationship_pref is null or relationship_pref in
           ('friends', 'dating', 'networking', 'study')),
  -- Discover preferences (who the user wants to see). Applied pre-scoring in P4.
  add column if not exists pref_genders      text[] not null default '{}',
  add column if not exists pref_semester_min smallint,
  add column if not exists pref_semester_max smallint,
  add column if not exists pref_verified_only boolean not null default false,
  -- Resumable wizard: last completed step index; cached completeness %.
  add column if not exists onboarding_step   smallint not null default 0,
  add column if not exists completeness      smallint not null default 0;

-- ---------------------------------------------------------------------------
-- 2. Protect the cached completeness column from direct client writes, exactly
--    like aura_score. Extends the existing guard (keeps its current behaviour).
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    new.aura_score   := old.aura_score;
    new.is_admin     := old.is_admin;
    new.is_banned    := old.is_banned;
    -- completeness is a cache recomputed by award_completion_bonus(); a user
    -- may not set it directly (parity with aura_score).
    new.completeness := old.completeness;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Deterministic completeness score (0–100). Weighted checklist of the
--    fields that make a profile useful to ranking + discovery.
-- ---------------------------------------------------------------------------
create or replace function public.compute_profile_completeness(p_uid uuid)
returns smallint
language sql stable security definer set search_path = public as $$
  select least(100, (
      case when p.avatar_url    is not null then 15 else 0 end
    + case when coalesce(p.full_name, '') <> '' then 10 else 0 end
    + case when coalesce(p.bio, '')       <> '' then 10 else 0 end
    + case when coalesce(p.department, '') <> '' then 10 else 0 end
    + case when p.semester      is not null then 10 else 0 end
    + case when array_length(p.interests, 1)   >= 3 then 15 else 0 end
    + case when array_length(p.personality, 1) >= 1 then 10 else 0 end
    + case when array_length(p.languages, 1)   >= 1 then  5 else 0 end
    + case when coalesce(p.gender, '')    <> '' then  5 else 0 end
    + case when p.graduation_year is not null then  5 else 0 end
    + case when array_length(p.pref_genders, 1) >= 1 then 5 else 0 end
  ))::smallint
  from public.profiles p
  where p.id = p_uid;
$$;

grant execute on function public.compute_profile_completeness(uuid) to authenticated;
revoke execute on function public.compute_profile_completeness(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Recompute + cache completeness for the caller, and award a one-time Aura
--    bonus the first time they cross 90%. Idempotent: the bonus is guarded by
--    the presence of an existing profile_completed ledger row, so re-running is
--    harmless. Returns the fresh completeness value for the client.
-- ---------------------------------------------------------------------------
create or replace function public.award_completion_bonus()
returns smallint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pct smallint;
  v_already boolean;
begin
  if v_uid is null then
    return 0;
  end if;

  v_pct := public.compute_profile_completeness(v_uid);

  update public.profiles set completeness = v_pct where id = v_uid;

  if v_pct >= 90 then
    select exists(
      select 1 from public.aura_transactions
      where user_id = v_uid and reason = 'profile_completed'
    ) into v_already;

    if not v_already then
      insert into public.aura_transactions (user_id, delta, reason, metadata)
      values (v_uid, 25, 'profile_completed',
              jsonb_build_object('completeness', v_pct));
    end if;
  end if;

  return v_pct;
end $$;

grant execute on function public.award_completion_bonus() to authenticated;
revoke execute on function public.award_completion_bonus() from public, anon;
