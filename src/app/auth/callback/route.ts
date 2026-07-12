import { NextResponse } from "next/server";
import { createClientForRedirect } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url-safety";

/**
 * Magic-link callback. Supabase redirects here with a `code` (PKCE) after the
 * user clicks the email link. We exchange it for a session and route into the
 * app — the student layout will send new users to onboarding.
 *
 * The session cookies MUST be written onto the redirect response we return
 * (createClientForRedirect), not the ambient next/headers store: a
 * manually-built NextResponse.redirect does not carry those, so the exchange
 * would succeed on the server yet the browser would stay logged out and bounce
 * back to /login.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Validate to a same-site path — never let `next` redirect off-domain (P2-01).
  const next = safeNextPath(searchParams.get("next"));
  const error = searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error)}`
    );
  }

  if (code) {
    // Build the destination response first so the exchange can set cookies on it.
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = await createClientForRedirect(response);
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      return response;
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
    );
  }

  return NextResponse.redirect(`${origin}/login`);
}
