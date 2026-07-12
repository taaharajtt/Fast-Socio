import { NextResponse } from "next/server";
import { createClientForRedirect } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoLoginEnabled } from "@/lib/auth/gates";

/**
 * Reusable one-click demo login (no email, no expiry hassle). Signs the visitor
 * into the shared demo STUDENT account by minting an admin magic-link token
 * server-side and immediately verifying it to set the session cookies.
 *
 * DEMO CONVENIENCE — a public auto-login for a single, non-admin demo account.
 * Hard-gated off in production (P1-03) unless ALLOW_DEMO_LOGIN=true is set, so a
 * real deployment cannot hand out authenticated sessions to anonymous visitors.
 */
const DEMO_EMAIL = "demo-user@nu.edu.pk";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  // Never expose an unauthenticated session-minting endpoint in production.
  // Hard NODE_ENV gate first (launch audit Phase 0.2, matching /auth/dev-login)
  // so a forgotten ALLOW_DEMO_LOGIN env var alone can never open this in prod;
  // the env-var gate still applies outside production.
  if (process.env.NODE_ENV === "production" || !isDemoLoginEnabled()) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: DEMO_EMAIL,
  });

  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    return NextResponse.redirect(`${origin}/login?error=demo_unavailable`);
  }

  const response = NextResponse.redirect(`${origin}/home`);
  const supabase = await createClientForRedirect(response);
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(verifyError.message)}`
    );
  }

  return response;
}
