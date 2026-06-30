import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side rate-limit check backed by the check_rate_limit SQL function
 * (Phase 1 infrastructure). Returns true if the action is allowed (and records
 * it), false if the caller has exceeded the limit in the window.
 *
 * Used by abuse-prone server actions in later phases (likes/passes/message
 * requests in Discover, sends in Chat) before they mutate state.
 */
export async function checkRateLimit(
  action: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_action: action,
    p_max: max,
    p_window: `${windowSeconds} seconds`,
  });
  if (error) {
    // Fail closed: if the limiter errors, do not allow the action.
    return false;
  }
  return data === true;
}

/** Common limits, centralized so phases share one policy table. */
export const RATE_LIMITS = {
  like: { max: 100, windowSeconds: 60 * 60 }, // 100 likes/hour
  pass: { max: 300, windowSeconds: 60 * 60 },
  messageRequest: { max: 20, windowSeconds: 60 * 60 },
  chatSend: { max: 120, windowSeconds: 60 }, // 120 msgs/min
  report: { max: 20, windowSeconds: 24 * 60 * 60 },
} as const;
