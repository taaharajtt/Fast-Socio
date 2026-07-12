import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/url-safety";

/**
 * Token-hash confirmation (the standard @supabase/ssr flow). Complements the
 * PKCE `code` path in /auth/callback: handles links that carry `token_hash` +
 * `type` — e.g. admin-generated magic links and email confirmations. Verifying
 * establishes the session on the app's own cookies (no client code_verifier
 * needed), then routes into the app.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Validate to a same-site path — never let `next` redirect off-domain (P2-01).
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  return NextResponse.redirect(`${origin}/login`);
}
