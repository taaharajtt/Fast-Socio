-- =============================================================================
-- FAST SOCIO — VULN-13: restrict feature_flags / app_settings reads
--
-- Both tables were readable by ANY authenticated user (SELECT policy
-- `using (true)`), leaking rollout state, maintenance config and min_app_version.
-- The app never needs the raw tables client-side:
--   * feature flags are read via flag_enabled()      (SECURITY DEFINER, mig 0050)
--   * maintenance state is the only app_settings read — now behind a SECURITY
--     DEFINER RPC that returns just the public-safe { enabled, message } shape.
-- After this, non-admins can no longer enumerate these tables; super admins keep
-- full access via the existing "super admins manage ..." ALL policies.
-- =============================================================================

create or replace function public.get_maintenance_state()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select jsonb_build_object(
       'enabled', coalesce((value ->> 'enabled')::boolean, false),
       'message', coalesce(value ->> 'message', '')
     )
     from public.app_settings where key = 'maintenance'),
    jsonb_build_object('enabled', false, 'message', '')
  );
$$;

revoke all on function public.get_maintenance_state() from public;
grant execute on function public.get_maintenance_state() to authenticated, anon;

drop policy if exists "feature flags readable by authenticated users" on public.feature_flags;
drop policy if exists "app settings readable by authenticated users" on public.app_settings;
