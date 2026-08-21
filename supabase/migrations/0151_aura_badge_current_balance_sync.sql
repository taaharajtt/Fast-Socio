-- =============================================================================
-- FAST SOCIO — "Aura Follows You" badge: bind it to the CURRENT Aura balance.
--
-- Invariant enforced by this migration:
--     user_achievements row ('aura_follows_you') EXISTS
--       IF AND ONLY IF profiles.aura_score >= 1000
--
-- Why it was broken:
--   * Mig 0073 gave the badge metric 'aura_alltime' = sum of POSITIVE ledger
--     deltas, i.e. lifetime Aura earned. Deductions (admin penalties, unlikes,
--     any negative txn) never took it back, so a user at 120 Aura could still
--     wear a badge that claims 1,000.
--   * check_achievements() is grant-only: it has no revoke path at all, and it
--     early-exits once every badge is owned.
--
-- How it is fixed:
--   * profiles.aura_score IS the current balance. It is a cache maintained by
--     recompute_aura_score() (mig 0001 -> 0005 -> 0028), an AFTER trigger on
--     aura_transactions, and aura_transactions is the ONLY way Aura moves
--     (award triggers, admin_adjust_aura, admin_bulk_aura, achievement rewards).
--     No client can write aura_score: it is outside the column allowlist of
--     mig 0084 and reverted by protect_profile_columns().
--   * So the single choke point for EVERY aura mutation, gain or deduction, is
--     an UPDATE of profiles.aura_score. We hang the reconciliation there:
--     a row-level trigger that grants or revokes the badge in the same
--     transaction as the balance change. Frontend state cannot desync because
--     no code path reaches the balance without passing through this trigger.
--   * check_achievements() is realigned to the same rule (metric
--     'aura_current') so the two agents can never disagree.
--
-- Idempotence:
--   * Grant is `on conflict do nothing`; revoke only deletes when a row exists;
--     the sync function no-ops (zero writes, zero notifications) when the badge
--     state already matches the balance.
--   * The +100 Aura reward is paid ONCE per user, ever — a re-grant after a
--     dip below the threshold does not pay again, which also stops any
--     grant -> reward -> balance-change -> grant oscillation from minting Aura.
--   * The reward insert re-enters the trigger exactly one level deep and that
--     re-entry is a no-op (badge already present, balance still >= 1000).
--
-- Nothing about the badge artwork, catalog ordering, other badges, or any other
-- Aura logic is touched.
--
-- Safe to re-run.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Catalog: the badge now measures the CURRENT balance, not lifetime earned.
-- ---------------------------------------------------------------------------
update public.achievements
   set metric      = 'aura_current',
       description = 'Hold 1,000 Aura points.'
 where code = 'aura_follows_you';

-- Threshold is already 1000; assert it rather than assume it.
update public.achievements
   set threshold = 1000
 where code = 'aura_follows_you' and threshold <> 1000;

-- ---------------------------------------------------------------------------
-- 2. sync_aura_badge(user): make the badge match the current balance.
--    Grants when >= 1000, revokes when < 1000, writes nothing otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.sync_aura_badge(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code      constant text := 'aura_follows_you';
  v_threshold integer;
  v_balance   integer;
  v_has       boolean;
  v_reward    integer;
  v_title     text;
  v_image     text;
  v_paid      boolean;
begin
  if p_user is null then
    return;
  end if;

  select threshold, aura_reward, title, image_url
    into v_threshold, v_reward, v_title, v_image
    from public.achievements
   where code = v_code;

  if not found then
    return; -- catalog row absent (badge disabled) — nothing to enforce.
  end if;

  select aura_score into v_balance from public.profiles where id = p_user;
  if v_balance is null then
    return; -- profile gone (deleted); the cascade already removed the badge.
  end if;

  v_has := exists (
    select 1 from public.user_achievements
     where user_id = p_user and code = v_code
  );

  if v_balance >= v_threshold then
    if v_has then
      return;                                    -- already correct: no write.
    end if;

    insert into public.user_achievements (user_id, code)
      values (p_user, v_code)
      on conflict do nothing;

    -- Pay the reward only the first time this user ever earns the badge.
    v_paid := exists (
      select 1 from public.aura_transactions
       where user_id = p_user
         and reason  = 'achievement'
         and metadata ->> 'code' = v_code
    );

    if coalesce(v_reward, 0) > 0 and not v_paid then
      insert into public.aura_transactions (user_id, delta, reason, metadata)
        values (p_user, v_reward, 'achievement',
                jsonb_build_object('code', v_code));
    end if;

    perform public.create_notification(
      p_user, null, 'achievement', 'system',
      jsonb_build_object('code', v_code, 'title', v_title, 'image_url', v_image)
    );
  else
    if not v_has then
      return;                                    -- already correct: no write.
    end if;

    delete from public.user_achievements
     where user_id = p_user and code = v_code;
  end if;
end;
$$;

revoke all on function public.sync_aura_badge(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trigger on the balance itself — fires for EVERY gain and EVERY deduction,
--    whatever produced it (award triggers, admin adjust/bulk, achievement
--    rewards, ledger deletes, manual owner-level fixes).
-- ---------------------------------------------------------------------------
create or replace function public.trg_sync_aura_badge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_aura_badge(new.id);
  return null;
end;
$$;

-- Two triggers rather than one: a WHEN clause on a combined INSERT-OR-UPDATE
-- trigger cannot safely reference OLD (it is NULL on INSERT).
drop trigger if exists profiles_sync_aura_badge on public.profiles;
create trigger profiles_sync_aura_badge
  after update of aura_score on public.profiles
  for each row
  when (new.aura_score is distinct from old.aura_score)
  execute function public.trg_sync_aura_badge();

drop trigger if exists profiles_sync_aura_badge_insert on public.profiles;
create trigger profiles_sync_aura_badge_insert
  after insert on public.profiles
  for each row
  when (coalesce(new.aura_score, 0) >= 1000)
  execute function public.trg_sync_aura_badge();

-- ---------------------------------------------------------------------------
-- 4. Realign the one-time checker so it can never grant this badge on the old
--    lifetime rule. Only the aura metric block changes; every other badge in
--    mig 0073 keeps its exact behaviour.
-- ---------------------------------------------------------------------------
create or replace function public.check_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  -- Fast exit once everything is earned (this runs on hot paths like messages).
  if not exists (
    select 1 from public.achievements a
    where not exists (
      select 1 from public.user_achievements ua
      where ua.user_id = p_user and ua.code = a.code
    )
  ) then
    return;
  end if;

  for rec in
    with m as (
      select
        (select count(*) from public.posts
          where author_id = p_user and not is_anonymous)                          as posts,
        (select count(*) from public.matches
          where user_low = p_user or user_high = p_user)                          as matches,
        (select count(*) from public.community_members
          where user_id = p_user)                                                 as communities,
        -- CURRENT balance straight from the ledger (deductions included), so it
        -- reflects the just-inserted row regardless of trigger order.
        (select coalesce(sum(delta), 0) from public.aura_transactions
          where user_id = p_user)                                                 as aura_current,
        -- Distinct people interacted with: DM counterparts you actually messaged,
        -- authors of posts you commented on (feed + community posts), and authors
        -- of comments you replied to.
        (select count(*) from (
            select case when c.user_low = p_user then c.user_high else c.user_low end
              from public.conversations c
              where exists (
                select 1 from public.messages msg
                where msg.conversation_id = c.id and msg.sender_id = p_user
              )
              and p_user in (c.user_low, c.user_high)
            union
            select p.author_id
              from public.post_comments pc
              join public.posts p on p.id = pc.post_id
              where pc.author_id = p_user and p.author_id <> p_user
            union
            select parent.author_id
              from public.post_comments pc
              join public.post_comments parent on parent.id = pc.parent_id
              where pc.author_id = p_user and parent.author_id <> p_user
          ) others)                                                                as interactions,
        -- "Successful event": an approved event you host that reaches 10+ RSVPs.
        (select count(*) from public.events e
          where e.host_id = p_user
            and e.status = 'approved'
            and (select count(*) from public.event_attendees ea
                  where ea.event_id = e.id) >= 10)                                 as events_hosted_big,
        -- Longest run of consecutive days (Pakistan time) with any Aura-earning
        -- contribution (gaps-and-islands over distinct activity dates).
        (select coalesce(max(run), 0) from (
            select count(*) as run
            from (
              select d, d - (row_number() over (order by d))::int as grp
              from (
                select distinct (created_at at time zone 'Asia/Karachi')::date as d
                from public.aura_transactions
                where user_id = p_user and delta > 0
              ) days
            ) islands
            group by grp
          ) runs)                                                                  as streak
    )
    insert into public.user_achievements (user_id, code)
    select p_user, a.code
    from public.achievements a, m
    where not exists (
        select 1 from public.user_achievements ua
        where ua.user_id = p_user and ua.code = a.code
      )
      and (case a.metric
             when 'posts'             then m.posts
             when 'matches'           then m.matches
             when 'communities'       then m.communities
             when 'aura_current'      then m.aura_current
             when 'interactions'      then m.interactions
             when 'events_hosted_big' then m.events_hosted_big
             when 'streak'            then m.streak
             else 0
           end) >= a.threshold
    returning code
  loop
    declare
      v_reward integer;
      v_title  text;
      v_image  text;
      v_paid   boolean;
    begin
      select aura_reward, title, image_url into v_reward, v_title, v_image
        from public.achievements where code = rec.code;

      -- Never pay the same badge's reward twice (a badge can now be revoked and
      -- re-earned; the rest are grant-only so this is a no-op for them).
      v_paid := exists (
        select 1 from public.aura_transactions
         where user_id = p_user
           and reason  = 'achievement'
           and metadata ->> 'code' = rec.code
      );

      if v_reward > 0 and not v_paid then
        insert into public.aura_transactions (user_id, delta, reason, metadata)
          values (p_user, v_reward, 'achievement',
                  jsonb_build_object('code', rec.code));
      end if;

      perform public.create_notification(
        p_user, null, 'achievement', 'system',
        jsonb_build_object('code', rec.code, 'title', v_title, 'image_url', v_image)
      );
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. ONE-TIME reconciliation for every existing user.
--    * Revokes the badge from everyone currently below 1000 (the users the old
--      lifetime rule wrongly promoted, and anyone who has since been deducted).
--    * Grants it to everyone at/above 1000 who does not have it.
--    Written as two set-based statements so the backfill does not fire the
--    reward/notification path for corrections; the grant side then pays any
--    genuinely-unpaid reward through sync_aura_badge in a second pass, which is
--    a no-op for rows already reconciled above.
-- ---------------------------------------------------------------------------
delete from public.user_achievements ua
 using public.profiles p
 where ua.code = 'aura_follows_you'
   and p.id = ua.user_id
   and coalesce(p.aura_score, 0) < 1000;

do $$
declare
  u uuid;
begin
  for u in
    select p.id
      from public.profiles p
     where coalesce(p.aura_score, 0) >= 1000
       and not exists (
         select 1 from public.user_achievements ua
          where ua.user_id = p.id and ua.code = 'aura_follows_you'
       )
  loop
    perform public.sync_aura_badge(u);
  end loop;
end;
$$;

-- Drift guard: if the aura_score cache itself ever drifted from the ledger, the
-- reconciliation above would have used a wrong balance. Re-derive any drifted
-- caches; each corrected row fires the new trigger and self-heals its badge.
update public.profiles p
   set aura_score = coalesce(
     (select sum(a.delta) from public.aura_transactions a where a.user_id = p.id), 0)
 where p.aura_score is distinct from coalesce(
     (select sum(a.delta) from public.aura_transactions a where a.user_id = p.id), 0);
