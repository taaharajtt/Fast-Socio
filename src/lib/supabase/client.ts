import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components. Uses only the public anon key; all
 * privileged access is gated by Row-Level Security on the database.
 *
 * Memoized: the whole tab shares ONE client instance (and therefore one
 * Realtime WebSocket + one auth-refresh loop) instead of every component
 * spinning up its own. This also makes `removeChannel` cleanups reliable, since
 * every caller operates on the same channel registry.
 */
function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Concrete (non-generic) return type so consumers keep the exact same typing
// they had when createClient() called createBrowserClient() directly.
let browserClient: ReturnType<typeof makeClient> | undefined;

export function createClient() {
  return (browserClient ??= makeClient());
}
