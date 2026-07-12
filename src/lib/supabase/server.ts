import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

/**
 * Supabase client for a redirecting Route Handler (the auth callbacks). Writes
 * the refreshed session cookies DIRECTLY onto the given response.
 *
 * Why this exists: a Route Handler that establishes a session and then returns a
 * freshly-constructed `NextResponse.redirect(...)` does NOT carry the cookies
 * written through `next/headers` `cookies()` — those mutations aren't merged
 * into a response object you build yourself. The result was that the magic-link
 * exchange succeeded server-side (Supabase returned a session) but the
 * `Set-Cookie` never reached the browser, so the next request looked
 * unauthenticated and the user was bounced back to /login. Attaching the cookies
 * to the exact response we return fixes it. Callers must return THAT response.
 */
export async function createClientForRedirect(response: NextResponse) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
}

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 * Reads/writes the session via Next's cookie store. The `setAll` try/catch is
 * required because Server Components cannot set cookies — the middleware
 * (see src/lib/supabase/middleware.ts) refreshes the session there instead.
 *
 * NOTE: for a Route Handler that returns its OWN redirect response, use
 * `createClientForRedirect` instead — see the note there.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware refreshes.
          }
        },
      },
    }
  );
}
