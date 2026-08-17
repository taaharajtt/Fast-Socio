-- =============================================================================
-- FAST SOCIO — Install-funnel instrumentation (audit P3-1)
--
-- WHY
-- The install funnel was rebuilt on the strength of an argument: that the CTA
-- was never reaching people, that Instagram's webview was the dead end, that
-- Chromium's event was being lost to a hydration race. Every one of those is
-- now fixed by construction — but "fixed by construction" is a claim, and
-- nothing in the product can currently tell us whether installs actually went
-- up, which surface produced them, or which platform still fails silently.
-- Without counters the next round of work would be guesswork dressed up as
-- judgement.
--
-- WHAT THIS DELIBERATELY IS NOT
-- This is not analytics about people. It records NO user id, NO session, NO IP,
-- NO user-agent string and no timestamp finer than the day. A row says only
-- "on this date, this many browsers of this rough platform reached this step of
-- this surface". You cannot ask it what any individual student did, because it
-- does not know — and it must stay that way. FAST SOCIO is a private campus app
-- where the population is small enough that a per-user install log would be
-- genuinely identifying (see the F16 mass-PII thread in the security work).
--
-- WHY A FIXED-CARDINALITY TABLE
-- The write path has to be callable by ANONYMOUS visitors: half the funnel now
-- lives on /login and /signup, which is the entire point of the P0-2 work. An
-- anonymous, unauthenticated write endpoint is an abuse surface, so the design
-- removes the thing worth abusing. Every column is constrained to a short
-- allow-list, so the table's maximum size is
--
--     days x 8 events x 5 platforms x 5 surfaces
--
-- — about 200 rows per day no matter how much traffic or how much malice
-- arrives, and nothing an attacker sends is ever stored as text. The worst a
-- flood can do is make a counter wrong, which is a wrong number, not an
-- outage and not a leak. Counters are advisory; treat a sudden spike as
-- suspect rather than as truth.
-- =============================================================================

create table if not exists public.pwa_install_stats (
  -- UTC so a day boundary means one thing regardless of where the server runs.
  day date not null default (now() at time zone 'utc')::date,

  -- The funnel step. Named for what happened, not for a component.
  event text not null check (event in (
    'standalone_launch',  -- opened from the home screen: the outcome we want
    'event_available',    -- Chromium banked a beforeinstallprompt
    'cta_shown',          -- an install ask actually rendered
    'cta_tapped',         -- the user acted on it
    'outcome_accepted',   -- native dialog accepted
    'outcome_dismissed',  -- native dialog declined
    'app_installed',      -- appinstalled fired
    'ask_snoozed'         -- "not now" / "got it"
  )),

  -- Coarse on purpose: enough to answer "does iOS still fail?", not enough to
  -- fingerprint a device. No versions, no models, no raw UA.
  platform text not null check (platform in (
    'android', 'ios', 'desktop', 'other', 'unknown'
  )),

  -- Which part of the funnel. 'handoff' is the Instagram/in-app-browser
  -- interstitial, and splitting it out is how we find out whether the webview
  -- escape hatch is working at all.
  surface text not null check (surface in (
    'banner', 'onboarding', 'settings', 'handoff', 'launch'
  )),

  hits bigint not null default 0,

  primary key (day, event, platform, surface)
);

comment on table public.pwa_install_stats is
  'Aggregate-only counters for the PWA install funnel. Contains no user id, no '
  'session, no IP and no user-agent. Written exclusively by '
  'record_pwa_install_event(); direct access is blocked by RLS.';

-- RLS on with NO policies: the table is unreachable to `anon` and
-- `authenticated` in both directions. The SECURITY DEFINER writer below is the
-- only way in, and admin reads go through the admin console's own definer-based
-- browser, which bypasses RLS as it does for every other table. This is what
-- stops the write endpoint from doubling as a read endpoint — otherwise any
-- visitor could enumerate our install numbers.
alter table public.pwa_install_stats enable row level security;

-- =============================================================================
-- The only writer.
--
-- Note what is absent: no auth.uid(), no current_setting('request.jwt...'),
-- nothing that could attach an identity to a row even by accident. A future
-- edit that adds one changes the privacy properties of this table and must be
-- treated as such.
--
-- Unknown labels return quietly instead of raising. This is fire-and-forget
-- telemetry called from the UI: a client on an older bundle sending a label a
-- newer migration removed must lose a count, never surface an error into
-- someone's login screen.
-- =============================================================================
create or replace function public.record_pwa_install_event(
  p_event text,
  p_platform text,
  p_surface text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event not in (
    'standalone_launch', 'event_available', 'cta_shown', 'cta_tapped',
    'outcome_accepted', 'outcome_dismissed', 'app_installed', 'ask_snoozed'
  ) then
    return;
  end if;
  if p_platform not in ('android', 'ios', 'desktop', 'other', 'unknown') then
    return;
  end if;
  if p_surface not in ('banner', 'onboarding', 'settings', 'handoff', 'launch') then
    return;
  end if;

  insert into public.pwa_install_stats as s (day, event, platform, surface, hits)
  values ((now() at time zone 'utc')::date, p_event, p_platform, p_surface, 1)
  on conflict (day, event, platform, surface)
    do update set hits = s.hits + 1;
end;
$$;

comment on function public.record_pwa_install_event(text, text, text) is
  'Increments one aggregate install-funnel counter. Callable anonymously by '
  'design (the funnel runs on signed-out routes). Stores no identity.';

-- Anonymous execute is required, not an oversight: /login and /signup are where
-- the funnel now does its most important work. The function''s reach is one
-- bounded counter, so this grant hands out nothing else.
revoke all on function public.record_pwa_install_event(text, text, text) from public;
grant execute on function public.record_pwa_install_event(text, text, text)
  to anon, authenticated;
