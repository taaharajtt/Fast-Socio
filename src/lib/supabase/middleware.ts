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
  // Logged-out auth screens: an authenticated user has no reason to be here, so
  // they get bounced to /home. /reset-password is deliberately excluded — it is
  // reached WITH a (recovery) session and must stay accessible while signed in.
  const isLoggedOutRoute =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password";
  const isBannedRoute = pathname.startsWith("/banned");
  const isPublicRoute =
    isLoggedOutRoute ||
    pathname === "/reset-password" ||
    isBannedRoute ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/styleguide");

  // Unauthenticated users may only see public routes.
  if (!userId && !isPublicRoute) {
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

  // For authenticated users on a protected route, read the moderation/role flags
  // once. Banned users are blocked from the entire app (CR-014); non-admins are
  // kept out of /admin (defense-in-depth behind the /admin layout gate).
  if (userId && !isPublicRoute) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin, is_banned")
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
  }

  return supabaseResponse;
}
