import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and keeps the auth
 * cookies in sync between the request and response. Auth route-gating is added
 * in Phase 1 once login exists; for now this only maintains the session.
 *
 * IMPORTANT (per @supabase/ssr docs): always return the `supabaseResponse`
 * object as-is so the refreshed cookies are not dropped.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // No-op until Supabase env is configured, so the app runs before keys are set.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Verify the JWT locally and refresh the session cookie when needed. This
  // project signs tokens with an asymmetric ES256 key, so getClaims() validates
  // the signature in-process — no Auth API round-trip on this per-request hot
  // path (getUser() would call the network on every navigation).
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;

  const { pathname } = request.nextUrl;
  // Logged-out auth screens: an authenticated user has no reason to be on these,
  // so they get bounced to /home. NOTE: /set-password is deliberately NOT here —
  // it is reached WITH a session (from a signup magic link or a recovery link)
  // and must stay accessible to authenticated users.
  const isLoggedOutRoute =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password";
  const isBannedRoute = pathname.startsWith("/banned");
  const isPublicRoute =
    isLoggedOutRoute ||
    // Public so an expired link shows the "request a new one" state instead of
    // bouncing to /login; authenticated link-holders see the set-password form.
    pathname === "/set-password" ||
    isBannedRoute ||
    pathname.startsWith("/auth/") ||
    // Sentry verification endpoint — throws a test error, hard-gated off in
    // production (see the route). Public so the capture check works on a
    // preview deploy without needing to authenticate first.
    pathname === "/api/sentry-check" ||
    // Liveness probe for the self-hosted deployment. Must answer 200 without a
    // session or the container healthcheck sees the /login redirect and starts
    // killing healthy containers. Exposes nothing (see the route).
    pathname === "/api/health" ||
    pathname.startsWith("/styleguide") ||
    // Public informational pages — must render for signed-out visitors, not
    // bounce them to /login. See src/app/(public)/.
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/about" ||
    pathname === "/support";

  // Unauthenticated users may only see public routes.
  if (!userId && !isPublicRoute) {
    // API routes answer fetch(), not navigation. Redirecting one to /login
    // sends back a 200 page of HTML, so the caller's `res.ok` is true and it
    // fails later on JSON parsing with something unrelated to the real cause.
    // A 401 lets the client say "your session expired" — which matters most
    // for /api/storage/*, where an expired session mid-upload would otherwise
    // surface as an inscrutable upload failure.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated users have no reason to sit on a logged-out auth screen.
  if (userId && isLoggedOutRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  // Router PREFETCHES are exempted from the profile read below (perf audit 2.1).
  //
  // Header names are Next's own constants (client/components/app-router-headers:
  // `next-router-prefetch` for a full prefetch, `next-router-segment-prefetch`
  // for a per-segment one). Header lookup is case-insensitive.
  //
  // Why this is safe, and not merely cheap:
  //   * A prefetch commits no navigation and renders nothing the user acts on.
  //     The REAL navigation that follows is a separate request and runs the full
  //     gate below, unchanged.
  //   * Under Cache Components every student route is a Partial Prerender (◐ in
  //     the build output), so what a prefetch returns is the STATIC SHELL — the
  //     dock, the glow, the loading fallbacks. That shell is identical for every
  //     student by construction: the (student) layout is deliberately non-async
  //     precisely so nothing user-specific can reach it. There is no per-user
  //     data in a prefetch response to leak.
  //   * The only fully-static (○) routes are public ones (/login, /signup,
  //     /terms, ...) which never reach this branch anyway.
  //
  // Worst case for a banned user is that they prefetch an empty shell and then
  // get redirected to /banned the moment they actually tap — which is what the
  // loading state already looks like.
  //
  // This is the single biggest win in the audit: prefetches were 7,619 of 15,042
  // requests in 24h, and each was paying a Frankfurt round trip here for flags
  // it would never use.
  const isPrefetch =
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.has("next-router-segment-prefetch");

  // For authenticated users on a protected route, read the moderation/role flags
  // once. Banned users are blocked from the entire app (CR-014); non-admins are
  // kept out of /admin (defense-in-depth behind the /admin layout gate).
  if (userId && !isPublicRoute && !isPrefetch) {
    const { data: profile } = await supabase
      .from("profiles")
      // onboarding_completed rides along on a row we were already reading. The
      // student layout used to do this gate itself, which forced it to await a
      // profile query before it could render ANY of the app shell. Doing it
      // here costs nothing extra and lets that layout become a static shell.
      .select("is_admin, is_banned, onboarding_completed")
      .eq("id", userId)
      .single();

    if (profile?.is_banned) {
      const url = request.nextUrl.clone();
      url.pathname = "/banned";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/admin") && !profile?.is_admin) {
      const url = request.nextUrl.clone();
      url.pathname = "/home";
      return NextResponse.redirect(url);
    }

    // Unfinished signups are parked in the profile wizard. /admin is exempt
    // (an admin console user was never gated on onboarding), as are the
    // wizard itself, the maintenance interstitial and API routes.
    const skipsOnboardingGate =
      pathname.startsWith("/onboarding") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/api/") ||
      pathname === "/maintenance";
    if (!profile?.onboarding_completed && !skipsOnboardingGate) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // ...and the inverse: someone who has finished the wizard has no reason to
    // be back in it. Handled here for the same reason — it lets the onboarding
    // layout render without awaiting a query of its own.
    if (profile?.onboarding_completed && pathname.startsWith("/onboarding")) {
      const url = request.nextUrl.clone();
      url.pathname = "/home";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
