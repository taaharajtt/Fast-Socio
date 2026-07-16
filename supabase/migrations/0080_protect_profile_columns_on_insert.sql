-- =============================================================================
-- FAST SOCIO — Defense-in-depth for VULN-01/02 (privilege escalation / self-unban)
--
-- protect_profile_columns() previously reverted privileged columns only on
-- UPDATE. A direct authenticated INSERT (crafted PostgREST POST) was not
-- covered. While the existing profiles row + PK/FK constraints make this hard to
-- reach in practice, we close the gap explicitly: a self-served INSERT may never
-- seed privileged / cache columns — they are forced to their column defaults.
-- Writes by SECURITY DEFINER functions (handle_new_user runs as `postgres`) are
-- exempt because current_user is the definer, not 'authenticated'.
-- =============================================================================

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.aura_score               := 0;
      new.xp                       := 0;
      new.level                    := 1;
      new.is_admin                 := false;
      new.admin_role               := null;
      new.is_banned                := false;
      new.verified                 := false;
      new.shadow_banned            := false;
      new.posting_restricted_until := null;
      new.suspended_until          := null;
    else
      new.aura_score               := old.aura_score;
      new.admin_role               := old.admin_role;
      new.is_admin                 := old.is_admin;
      new.is_banned                := old.is_banned;
      new.verified                 := old.verified;
      new.xp                       := old.xp;
      new.level                    := old.level;
      new.shadow_banned            := old.shadow_banned;
      new.posting_restricted_until := old.posting_restricted_until;
      new.suspended_until          := old.suspended_until;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before insert or update on public.profiles
  for each row execute function public.protect_profile_columns();
