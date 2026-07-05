-- =============================================================================
-- FAST SOCIO — Admin ban / restore (CR-014 / UAT-014)
-- The admin dashboard could display is_banned but had no way to set it. This
-- adds an audited SECURITY DEFINER function to ban/restore a user, mirroring
-- admin_adjust_aura. Login enforcement is handled in the app middleware.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.admin_set_ban(
  p_user_id uuid,
  p_banned boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;
  if admin_id = p_user_id then
    raise exception 'cannot ban yourself';
  end if;

  update public.profiles
     set is_banned = p_banned
   where id = p_user_id;

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (
      admin_id,
      case when p_banned then 'ban_user' else 'restore_user' end,
      'profile',
      p_user_id,
      nullif(trim(p_reason), '')
    );
end;
$$;

revoke all on function public.admin_set_ban(uuid, boolean, text) from public;
grant execute on function public.admin_set_ban(uuid, boolean, text) to authenticated;
