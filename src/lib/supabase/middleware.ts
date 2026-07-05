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

  // Touch the user to trigger a token refresh when needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  const isBannedRoute = pathname.startsWith("/banned");
  const isPublicRoute =
    isAuthRoute ||
    isBannedRoute ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/styleguide");

  // Unauthenticated users may only see public routes.
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated users have no reason to sit on the login screen.
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  // For authenticated users on a protected route, read the moderation/role flags
  // once. Banned users are blocked from the entire app (CR-014); non-admins are
  // kept out of /admin (defense-in-depth behind the /admin layout gate).
  if (user && !isPublicRoute) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin, is_banned")
      .eq("id", user.id)
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
