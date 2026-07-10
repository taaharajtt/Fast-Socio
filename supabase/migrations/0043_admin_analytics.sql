-- M10: analytics for the console overview — a 14-day activity series plus a
-- rate-limit abuse monitor (last 24h). Moderator-tier read.
-- (Applied to the live DB as migration 0043_admin_analytics.)
create or replace function public.admin_analytics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_series jsonb; v_abuse jsonb;
begin
  perform public._admin_guard();

  with days as (
    select generate_series((current_date - interval '13 days')::date, current_date, interval '1 day')::date d
  )
  select jsonb_agg(jsonb_build_object(
    'd', to_char(d, 'MM-DD'),
    'signups', (select count(*) from profiles where created_at::date = d),
    'posts',   (select count(*) from posts where created_at::date = d),
    'matches', (select count(*) from matches where created_at::date = d),
    'messages',(select count(*) from messages where created_at::date = d)
  ) order by d) into v_series from days;

  select coalesce(jsonb_agg(x order by (x->>'count')::int desc), '[]'::jsonb) into v_abuse from (
    select jsonb_build_object('user', coalesce(pr.full_name, '—'), 'action', rl.action, 'count', count(*)) x
    from rate_limit_events rl
    left join profiles pr on pr.id = rl.user_id
    where rl.created_at > now() - interval '24 hours'
    group by pr.full_name, rl.action
    having count(*) >= 5
    limit 10
  ) q;

  return jsonb_build_object('series', coalesce(v_series, '[]'::jsonb), 'abuse', v_abuse);
end $$;

grant execute on function public.admin_analytics() to authenticated;
