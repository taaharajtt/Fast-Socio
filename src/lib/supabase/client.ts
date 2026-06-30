import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components. Uses only the public anon key; all
 * privileged access is gated by Row-Level Security on the database.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
