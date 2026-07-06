import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url-safety";

/**
 * Magic-link callback. Supabase redirects here with a `code` (PKCE) after the
 * user clicks the email link. We exchange it for a session (cookies are set by
 * the ssr server client) and route into the app — the student layout will send
 * new users to onboarding.
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
    const supabase = await createClient();
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
    );
  }

  return NextResponse.redirect(`${origin}/login`);
}
