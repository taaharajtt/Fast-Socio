-- =============================================================================
-- FAST SOCIO — backfill profiles/notification_preferences for orphaned auth users
--
-- Six auth.users rows had no matching public.profiles row. Such a user can sign
-- in, but the onboarding wizard
-- saves with `update profiles ... where id = auth.uid()`, which matches ZERO
-- rows — so `onboarding_completed` never sticks and they bounce back to
-- /onboarding forever ("stuck in account creation").
--
-- handle_new_user()/on_auth_user_created are correctly attached today, so this
-- is a repair of historical rows, not a trigger fix. Idempotent: safe to re-run.
-- The durable guard is app-side — onboarding now UPSERTs, so a missing row
-- self-heals instead of looping.
-- =============================================================================

insert into public.profiles (id, full_name)
select u.id, nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

insert into public.notification_preferences (user_id)
select u.id
from auth.users u
left join public.notification_preferences np on np.user_id = u.id
where np.user_id is null
on conflict (user_id) do nothing;
