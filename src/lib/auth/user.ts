import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The authenticated user's id, verified LOCALLY from the session JWT.
 *
 * This project signs tokens with an asymmetric ES256 key, so getClaims()
 * validates the signature in-process against a module-cached JWKS — no Auth API
 * round-trip. `auth.getUser()` by contrast calls the Auth server on every
 * invocation; with a page + layout + actions each doing it, those round trips
 * were the single biggest contributor to slow navigations (2.5–3.5s TTFB).
 *
 * Request-memoized with React `cache` so a layout + page sharing a request
 * verify once. Middleware (src/proxy.ts) has already gated the route, and RLS
 * remains the authority on every query — this id is only used to scope queries
 * the same way `user.id` was.
 */
export const getAuthUserId = cache(async (): Promise<string | null> => {
  const { data } = await getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

/**
 * The authenticated user's email, from the same locally-verified claims.
 *
 * Supabase puts `email` in the access token, so a screen that only needs to
 * SHOW the signed-in address (Settings → Account) does not need `getUser()` and
 * its Auth API round trip. Anything that acts on the email — changing it,
 * re-verifying it — must still go through the Auth API, which is authoritative.
 */
export const getAuthEmail = cache(async (): Promise<string | null> => {
  const { data } = await getClaims();
  return (data?.claims?.email as string | undefined) ?? null;
});

/** Shared claim read, so id + email cost one verification per request. */
const getClaims = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getClaims();
});
