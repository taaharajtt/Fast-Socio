import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  interpretRateLimitRpc,
  isAllowed,
  type RateLimitResult,
} from "@/lib/rate-limit-policy";

export {
  RATE_LIMITS,
  DISCOVER_SWIPE_BURST,
  isAllowed,
  limitedMessage,
  interpretRateLimitRpc,
  type RateLimitResult,
  type RateLimitPolicy,
} from "@/lib/rate-limit-policy";

/**
 * Server-side rate-limit check backed by SQL, returning a STRUCTURED result.
 *
 * The three outcomes are distinct on purpose:
 *   - `allowed`  — recorded, proceed.
 *   - `limited`  — the caller really has used their quota; `retryAfterSeconds`
 *                  says when a slot frees, so the UI can be specific.
 *   - `error`    — the limiter could not be consulted at all (RPC, network or
 *                  database failure). This is an INFRASTRUCTURE problem and
 *                  must never be reported to the user as "slow down".
 *
 * Backed by `check_rate_limit_burst` (migration 0159), which takes a
 * transaction-scoped advisory lock on (user, action) before counting, so
 * parallel requests cannot each read "19 events" and all insert a 20th.
 */
export async function checkRateLimitResult(
  action: string,
  max: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_rate_limit_burst", {
    p_action: action,
    p_max: max,
    p_window: `${windowSeconds} seconds`,
  });
  return interpretRateLimitRpc(data, error);
}

/**
 * Fail-closed boolean check. Unchanged behaviour for the abuse-prone callers
 * that only need allow/deny — reports, message requests, post/comment creation,
 * chat sends, community and society writes. A limiter failure still denies:
 * for those actions a broken limiter must not become an open door.
 *
 * Prefer `checkRateLimitResult` where the user-facing message matters.
 */
export async function checkRateLimit(
  action: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  return isAllowed(await checkRateLimitResult(action, max, windowSeconds));
}
