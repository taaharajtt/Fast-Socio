import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cookie-free, session-less Supabase client for use inside `use cache` scopes.
 *
 * Why this exists: a cached scope cannot read cookies (Next throws), so the
 * request-scoped `createClient()` from ./server is unusable there. This client
 * carries the anon key and NO user session, so PostgREST sees `role = anon`.
 *
 * That constraint is the safety property, not a limitation to work around:
 * anything reachable through this client is data any anonymous caller could
 * already read, which is exactly the data that is safe to share across users in
 * a global cache. It is the deliberate opposite of ./admin — never reach for
 * the service-role client to make a cached read "work", because that would
 * cache RLS-bypassing rows and hand one user another user's data.
 *
 * Only use it for genuinely global reads (e.g. SECURITY DEFINER RPCs that
 * return the same rows for every caller). Per-viewer data must stay outside the
 * cached scope and be passed in as an argument.
 */
export function createAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
