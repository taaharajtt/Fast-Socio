import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reusable one-click demo login (no email, no expiry hassle). Signs the visitor
 * into the shared demo STUDENT account by minting an admin magic-link token
 * server-side and immediately verifying it to set the session cookies.
 *
 * DEMO CONVENIENCE — this is a public auto-login for a single, non-admin demo
 * account. Remove this route before a real launch.
 */
const DEMO_EMAIL = "demo-user@nu.edu.pk";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: DEMO_EMAIL,
  });

  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    return NextResponse.redirect(`${origin}/login?error=demo_unavailable`);
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(verifyError.message)}`
    );
  }

  return NextResponse.redirect(`${origin}/home`);
}
