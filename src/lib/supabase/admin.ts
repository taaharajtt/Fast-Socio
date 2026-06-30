import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for privileged server-side operations that must
 * bypass RLS (e.g. deleting an auth user). NEVER import this into client code —
 * the secret key must never reach the browser. Guarded by `server-only`.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
