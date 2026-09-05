-- =============================================================================
-- 0188 — Aura integrity, part 3: achievements that can be lost, and the audit.
--
-- Part 2 declared which achievement metrics are reversible and called two
-- functions this migration defines. It also left `check_achievements` paying
-- Aura by direct ledger insert, which would have meant achievement rewards
-- earned no XP and could never be reversed.
--
-- ONE DEFINITION PER METRIC. 0151 computed all seven metrics inside a single
-- CTE, which is fine while only one caller exists — but revocation needs the
-- same arithmetic, and a second copy of it is the drift hazard this repo has
-- been bitten by before (0143, 0115). `achievement_metric_value` is now the one
-- place each metric is defined, and both the earn path and the revoke path call
-- it.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The metrics, once.
-- ---------------------------------------------------------------------------
-- Carried over verbatim in substance from 0151's CTE. `aura_alltime` is
-- accepted as an alias for `aura_current` because 0073 seeded the catalog with
-- the old name and 0151 changed the meaning to the current balance — a row that
-- still says `aura_alltime` must not silently evaluate to 0 here.
create or replace function public.achievement_metric_value(
  p_user   uuid,
  p_metric text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case p_metric
    when 'posts' then
      (select count(*) from public.posts
        where author_id = p_user and not is_anonymous)
    when 'matches' then
      (select count(*) from public.matches
        where user_low = p_user or user_high = p_user)
    when 'communities' then
      (select count(*) from public.community_members where user_id = p_user)
    when 'aura_current' then
      (select coalesce(sum(delta), 0) from public.aura_transactions
        where user_id = p_user)
    when 'aura_alltime' then
      (select coalesce(sum(delta), 0) from public.aura_transactions
        where user_id = p_user)
    when 'interactions' then
      (select count(*) from (
          select case when c.user_low = p_user then c.user_high else c.user_low end
            from public.conversations c
            where exists (
              select 1 from public.messages msg
              where msg.conversation_id = c.id and msg.sender_id = p_user
            ) and p_user in (c.user_low, c.user_high)
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
        ) others)
    -- "Successful event" now means ten people who ACTUALLY TURNED UP, counted
    -- from the immutable check-in evidence rather than from RSVP rows the host
    -- could have manufactured and then deleted. Left PERMANENT once earned
    -- (see achievement_metric_reversible), so no existing host loses a badge to
    -- this change — it only makes future earning honest.
    when 'events_hosted_big' then
      (select count(*) from public.events e
        where e.host_id = p_user
          and e.status = 'approved'
          and (select count(*) from public.event_checkins ec
                where ec.event_id = e.id) >= 10)
    when 'streak' then
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
        ) runs)
    else 0
  end;
$$;

revoke all on function public.achievement_metric_value(uuid, text) from public, anon, authenticated;

create or replace function public.achievement_still_earned(p_user uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.achievement_metric_value(p_user, a.metric) >= a.threshold
       from public.achievements a where a.code = p_code),
    true   -- unknown code: never revoke something this function cannot judge
  );
$$;

revoke all on function public.achievement_still_earned(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The recursion guard, and the two entry points that share it.
-- ---------------------------------------------------------------------------
-- THE LOOP THIS PREVENTS, precisely: 0055 put a trigger on `aura_transactions`
-- that calls check_achievements. check_achievements now pays through
-- aura_award, which INSERTS a ledger row, which fires that trigger again. And
-- `aura_current` is itself a metric, so paying a badge can change whether
-- another badge qualifies — the loop is not hypothetical.
--
-- One transaction-scoped flag, checked by both public entry points and set for
-- the duration of either. The actual work lives in an UNGUARDED inner function
-- so that check_achievements can run the revoke pass while holding the flag —
-- a guard that disabled its own second half would silently stop revoking.
create or replace function public.reconcile_achievements_inner(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select ua.code
      from public.user_achievements ua
      join public.achievements a on a.code = ua.code
     where ua.user_id = p_user
       and public.achievement_metric_reversible(a.metric)
  loop
    if not public.achievement_still_earned(p_user, rec.code) then
      delete from public.user_achievements
       where user_id = p_user and code = rec.code;
      perform public.aura_reverse(
        'achievement:' || p_user::text || ':' || rec.code,
        jsonb_build_object('cause', 'achievement_revoked', 'code', rec.code)
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.reconcile_achievements_inner(uuid) from public, anon, authenticated;

create or replace function public.reconcile_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or current_setting('app.aura_ach_guard', true) = '1' then
    return;
  end if;
  perform set_config('app.aura_ach_guard', '1', true);
  perform public.reconcile_achievements_inner(p_user);
  perform set_config('app.aura_ach_guard', '0', true);
end;
$$;

revoke all on function public.reconcile_achievements(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. check_achievements — award through the grant register, then reconcile.
-- ---------------------------------------------------------------------------
-- Carried forward from 0151: the same catalog-driven evaluation, the same
-- "already earned" guard, the same notification. Two changes:
--   * the reward goes through aura_award on 'achievement:{user}:{code}', so it
--     earns XP, cannot be paid twice, and CAN be reversed;
--   * after evaluating, reversible badges the user no longer qualifies for are
--     revoked and refunded.
-- The recursion guard lives in reconcile_achievements (0187): paying Aura moves
-- `aura_current`, which is itself a metric.
create or replace function public.check_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  if p_user is null or current_setting('app.aura_ach_guard', true) = '1' then
    return;
  end if;
  perform set_config('app.aura_ach_guard', '1', true);

  for rec in
    select a.code, a.aura_reward, a.title, a.image_url
      from public.achievements a
     where not exists (
             select 1 from public.user_achievements ua
              where ua.user_id = p_user and ua.code = a.code
           )
       and a.metric <> 'manual'
       and public.achievement_metric_value(p_user, a.metric) >= a.threshold
  loop
    insert into public.user_achievements (user_id, code)
    values (p_user, rec.code)
    on conflict do nothing;

    if rec.aura_reward > 0 then
      -- Idempotent on (user, code). Re-earning after a legitimate revocation
      -- pays the same amount once more; the previous grant was reversed, so a
      -- cycle nets to zero.
      perform public.aura_award(
        p_user, rec.aura_reward, 'achievement', 'achievement',
        'achievement:' || p_user::text || ':' || rec.code,
        jsonb_build_object('code', rec.code)
      );
    end if;

    perform public.create_notification(
      p_user, null, 'achievement', 'system',
      jsonb_build_object('code', rec.code, 'title', rec.title,
                         'image_url', rec.image_url)
    );
  end loop;

  -- The UNGUARDED inner pass: we already hold the flag, and a guarded call
  -- here would return immediately and never revoke anything.
  perform public.reconcile_achievements_inner(p_user);

  perform set_config('app.aura_ach_guard', '0', true);
end;
$$;

revoke all on function public.check_achievements(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reconcile on the events that can REMOVE qualification.
-- ---------------------------------------------------------------------------
-- The existing triggers (0073/0074) only fire on things that ADD. A user who
-- deletes matches or leaves communities never re-evaluated, which is what made
-- the badge Aura permanent regardless of state.
create or replace function public.trg_reconcile_achievements_pair()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconcile_achievements(old.user_low);
  perform public.reconcile_achievements(old.user_high);
  return null;
end;
$$;

drop trigger if exists matches_reconcile_achievements on public.matches;
create trigger matches_reconcile_achievements
  after delete on public.matches
  for each row execute function public.trg_reconcile_achievements_pair();

create or replace function public.trg_reconcile_achievements_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconcile_achievements(old.user_id);
  return null;
end;
$$;

drop trigger if exists community_members_reconcile_achievements on public.community_members;
create trigger community_members_reconcile_achievements
  after delete on public.community_members
  for each row execute function public.trg_reconcile_achievements_member();

revoke all on function public.trg_reconcile_achievements_pair() from public, anon, authenticated;
revoke all on function public.trg_reconcile_achievements_member() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Typed backfill: give defensible history a real source key.
-- ---------------------------------------------------------------------------
-- 0186 recorded every historical positive ledger row as a `legacy` grant so
-- nobody's XP moved. Where the ledger metadata actually identifies the source,
-- those grants are UPGRADED IN PLACE to a typed key — same row, same amount, so
-- XP is unchanged — which is what lets a future deletion reverse them properly.
--
-- Only rows whose source still EXISTS are upgraded. A grant for a post that is
-- already gone stays `legacy`: inventing a live key for a dead source would
-- make the next reconcile debit for something that was never tracked.
--
-- NOTHING IS DEDUCTED HERE. No ledger row is written, none is deleted, and no
-- historical grant is reversed. Suspicious history is reported by the views in
-- section 5 and left for an operator to act on deliberately.
update public.aura_grants g
   set source_type = 'comment',
       source_key  = 'comment:' || (t.metadata->>'post_id') || ':' || (t.metadata->>'commenter_id')
  from public.aura_transactions t
 where g.grant_tx_id = t.id
   and g.source_type = 'legacy'
   and g.reversed_at is null
   and t.reason = 'comment_received'
   and t.metadata ? 'post_id' and t.metadata ? 'commenter_id'
   and exists (select 1 from public.posts p where p.id = (t.metadata->>'post_id')::uuid)
   and exists (
     select 1 from public.post_comments c
      where c.post_id = (t.metadata->>'post_id')::uuid
        and c.author_id = (t.metadata->>'commenter_id')::uuid
   )
   -- Skip any pair that already has a typed grant (re-run safety).
   and not exists (
     select 1 from public.aura_grants g2
      where g2.source_key = 'comment:' || (t.metadata->>'post_id') || ':' || (t.metadata->>'commenter_id')
        and g2.reversed_at is null and g2.id <> g.id
   );

update public.aura_grants g
   set source_type = 'help',
       source_key  = 'help:' || (t.metadata->>'request_id')
  from public.aura_transactions t
 where g.grant_tx_id = t.id
   and g.source_type = 'legacy'
   and g.reversed_at is null
   and t.reason = 'help_thanked'
   and t.metadata ? 'request_id'
   and exists (select 1 from public.help_requests r where r.id = (t.metadata->>'request_id')::uuid)
   and not exists (
     select 1 from public.aura_grants g2
      where g2.source_key = 'help:' || (t.metadata->>'request_id')
        and g2.reversed_at is null and g2.id <> g.id
   );

update public.aura_grants g
   set source_type = 'profile',
       source_key  = 'profile-completed:' || g.user_id::text
  from public.aura_transactions t
 where g.grant_tx_id = t.id
   and g.source_type = 'legacy'
   and g.reversed_at is null
   and t.reason = 'profile_completed'
   and not exists (
     select 1 from public.aura_grants g2
      where g2.source_key = 'profile-completed:' || g.user_id::text
        and g2.reversed_at is null and g2.id <> g.id
   );

update public.aura_grants g
   set source_type = 'achievement',
       source_key  = 'achievement:' || g.user_id::text || ':' || (t.metadata->>'code')
  from public.aura_transactions t
 where g.grant_tx_id = t.id
   and g.source_type = 'legacy'
   and g.reversed_at is null
   and t.reason = 'achievement'
   and t.metadata ? 'code'
   and exists (
     select 1 from public.user_achievements ua
      where ua.user_id = g.user_id and ua.code = t.metadata->>'code'
   )
   and not exists (
     select 1 from public.aura_grants g2
      where g2.source_key = 'achievement:' || g.user_id::text || ':' || (t.metadata->>'code')
        and g2.reversed_at is null and g2.id <> g.id
   );

-- ---------------------------------------------------------------------------
-- 6. AUDIT — read-only. Nothing here changes a number.
-- ---------------------------------------------------------------------------
-- Everything the brief asks to be able to see, as one view per question, so an
-- operator can review before deciding whether any historical correction is
-- warranted. Admin-readable only.
create or replace view public.aura_audit_findings as
  -- Cached Aura disagreeing with the ledger.
  select 'cache_drift'::text as finding, p.id as user_id, null::uuid as subject_id,
         jsonb_build_object('cached', p.aura_score,
                            'ledger', coalesce(s.total, 0)) as detail
    from public.profiles p
    left join (select user_id, sum(delta) as total
                 from public.aura_transactions group by user_id) s on s.user_id = p.id
   where coalesce(p.aura_score, 0) <> coalesce(s.total, 0)

  union all
  -- XP disagreeing with the new eligible-source definition.
  select 'xp_drift', p.id, null,
         jsonb_build_object('cached_xp', p.xp, 'active_grants', coalesce(g.total, 0))
    from public.profiles p
    left join (select user_id, sum(amount) as total
                 from public.aura_grants where reversed_at is null group by user_id) g
      on g.user_id = p.id
   where coalesce(p.xp, 0) <> coalesce(g.total, 0)

  union all
  -- More than one profile-completion payment.
  select 'duplicate_profile_bonus', t.user_id, null,
         jsonb_build_object('count', count(*))
    from public.aura_transactions t
   where t.reason = 'profile_completed' and t.delta > 0
   group by t.user_id having count(*) > 1

  union all
  -- More than one help reward for one request (0110's per-response bug).
  select 'duplicate_help_reward', null, (t.metadata->>'request_id')::uuid,
         jsonb_build_object('count', count(*), 'total', sum(t.delta))
    from public.aura_transactions t
   where t.reason = 'help_thanked' and t.delta > 0 and t.metadata ? 'request_id'
   group by t.metadata->>'request_id' having count(*) > 1

  union all
  -- Repeated match rewards: more +10s than the pair could legitimately earn.
  select 'repeated_match_rewards', t.user_id, null,
         jsonb_build_object('awards', count(*),
                            'current_matches',
                            (select count(*) from public.matches m
                              where m.user_low = t.user_id or m.user_high = t.user_id))
    from public.aura_transactions t
   where t.reason = 'match' and t.delta > 0
   group by t.user_id
  having count(*) > (select count(*) from public.matches m
                      where m.user_low = t.user_id or m.user_high = t.user_id)

  union all
  -- Event rewards that were RSVP-only: paid, never withdrawn, never checked in.
  select 'rsvp_reward_without_checkin', t.user_id, (t.metadata->>'event_id')::uuid,
         jsonb_build_object('delta', t.delta, 'at', t.created_at)
    from public.aura_transactions t
   where t.reason = 'event_attend' and t.delta > 0
     and coalesce(t.metadata->>'checkin', 'false') <> 'true'
     and t.metadata ? 'event_id'
     and not exists (
       select 1 from public.event_checkins ec
        where ec.event_id = (t.metadata->>'event_id')::uuid and ec.user_id = t.user_id)

  union all
  -- Active grants whose source has vanished (post/help/achievement).
  select 'orphaned_grant', g.user_id, null,
         jsonb_build_object('source_key', g.source_key, 'amount', g.amount)
    from public.aura_grants g
   where g.reversed_at is null
     and (
       (g.source_type = 'post'
         and not exists (select 1 from public.posts p
                          where p.id = nullif(split_part(g.source_key, ':', 2), '')::uuid))
    or (g.source_type = 'help'
         and not exists (select 1 from public.help_requests r
                          where r.id = nullif(split_part(g.source_key, ':', 2), '')::uuid))
    or (g.source_type = 'achievement'
         and not exists (select 1 from public.user_achievements ua
                          where ua.user_id = g.user_id
                            and ua.code = split_part(g.source_key, ':', 3)))
     )

  union all
  -- Achievement rewards no longer supported by a reversible metric.
  select 'achievement_unsupported', ua.user_id, null,
         jsonb_build_object('code', ua.code, 'metric', a.metric)
    from public.user_achievements ua
    join public.achievements a on a.code = ua.code
   where public.achievement_metric_reversible(a.metric)
     and not public.achievement_still_earned(ua.user_id, ua.code)

  union all
  -- High-frequency reward bursts: 20+ automated rewards in an hour.
  select 'reward_burst', t.user_id, null,
         jsonb_build_object('hour', date_trunc('hour', t.created_at),
                            'rewards', count(*))
    from public.aura_transactions t
   where t.delta > 0 and t.reason <> 'admin_adjust'
   group by t.user_id, date_trunc('hour', t.created_at)
  having count(*) >= 20;

alter view public.aura_audit_findings set (security_invoker = true);
revoke all on public.aura_audit_findings from anon, authenticated;

comment on view public.aura_audit_findings is
  'READ-ONLY review of Aura anomalies: cache/XP drift, duplicate profile and help rewards, repeated match rewards, RSVP-only event rewards, orphaned grants, unsupported achievements, reward bursts. Reports only — no cleanup is automatic. See migration 0188.';

-- Post create/delete cycling, which the ledger alone cannot show now that
-- reversals exist. A user with many post reversals in a short window is the
-- signature of farming.
create or replace view public.aura_audit_post_cycling as
  select g.user_id,
         count(*) filter (where g.reversed_at is not null) as reversed_posts,
         count(*)                                          as total_post_grants,
         min(g.granted_at) as first_grant,
         max(coalesce(g.reversed_at, g.granted_at)) as last_activity
    from public.aura_grants g
   where g.source_type = 'post'
   group by g.user_id
  having count(*) filter (where g.reversed_at is not null) >= 5;

alter view public.aura_audit_post_cycling set (security_invoker = true);
revoke all on public.aura_audit_post_cycling from anon, authenticated;

-- =============================================================================
-- VERIFY
--   select finding, count(*) from public.aura_audit_findings group by finding;
--   -- 'cache_drift' and 'xp_drift' must both be 0 rows on a healthy database.
--
--   supabase/tests/aura_integrity.sql exercises every invariant.
-- =============================================================================
