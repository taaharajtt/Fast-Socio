"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { fetchCommunityBadge } from "@/lib/community/badge-count";
import {
  loadCommunityUpdates,
  type UpdatesData,
} from "@/lib/community/updates-data";

/**
 * The Community Updates screen's server side.
 *
 * Every mutation here is a thin call onto migration 0183's RPCs, which are
 * SECURITY INVOKER: the UPDATE policy on `notifications` ("your own rows only")
 * is the authorization, so a forged id matches no row and returns false rather
 * than touching anyone else's update. Nothing accepts a recipient from the
 * client — there is no parameter that could carry one.
 */

/**
 * Mark ONE update read. Called when the student deliberately opens it.
 *
 * Idempotent: the RPC's `read_at is null` guard means a double tap, a retried
 * navigation or two devices opening the same row all end with one timestamp and
 * a `false` for the loser. Returns the authoritative badge count afterwards so
 * the caller never has to decrement anything itself.
 */
export async function markCommunityUpdateRead(
  id: string
): Promise<{ ok: boolean; unread: number }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, unread: 0 };

  const { error } = await supabase.rpc("mark_community_update_read", {
    p_id: id,
  });
  const badge = await fetchCommunityBadge(supabase);
  return { ok: !error, unread: badge.total };
}

/**
 * Mark every currently-accessible Community update read.
 *
 * "Accessible" is the RPC's word, not this file's: it clears only rows the
 * `community_updates` view still shows the caller, so an item hidden by the
 * liveness rules (a queue they no longer manage) is left alone and returns
 * correctly if that access comes back.
 */
export async function markAllCommunityUpdatesRead(): Promise<{
  ok: boolean;
  unread: number;
}> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, unread: 0 };

  const { error } = await supabase.rpc("mark_community_updates_read");
  // Re-read rather than assuming zero: an update can arrive between the write
  // and this line, and the badge must reflect what is actually there.
  const badge = await fetchCommunityBadge(supabase);
  if (!error) revalidatePath("/communities/updates");
  return { ok: !error, unread: badge.total };
}

/** Next page of updates. The unread count comes with it and is a full count,
 *  never a tally of what has been loaded. */
export async function loadMoreCommunityUpdates(
  cursor: string
): Promise<UpdatesData> {
  return loadCommunityUpdates(cursor);
}

/**
 * The authoritative unread count, for the realtime island to reconcile against.
 *
 * This is the ONLY way the client badge is allowed to change. See
 * `lib/community/badge-store.ts` for why an event-derived increment cannot stay
 * correct here.
 */
export async function refreshCommunityBadge(): Promise<number> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return 0;
  const badge = await fetchCommunityBadge(supabase);
  return badge.total;
}
