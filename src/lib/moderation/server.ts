import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * If the current user is under a posting restriction or suspension (Phase 9),
 * return a user-facing reason; otherwise null. Degrades to null (allowed) if the
 * columns don't exist yet (pre-migration) so nothing regresses.
 */
export async function postingBlockReason(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("suspended_until, posting_restricted_until")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;

  const now = Date.now();
  const suspended = data.suspended_until
    ? new Date(data.suspended_until).getTime()
    : 0;
  if (suspended > now)
    return "Your account is suspended. You can't post right now.";

  const restricted = data.posting_restricted_until
    ? new Date(data.posting_restricted_until).getTime()
    : 0;
  if (restricted > now)
    return "You're temporarily restricted from posting. Try again later.";

  return null;
}
