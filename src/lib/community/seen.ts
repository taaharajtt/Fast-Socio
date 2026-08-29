import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Stamping the Community badge's "seen" marks (migration 0170).
 *
 * BOTH RUN INSIDE `after()`, AND THAT IS THE WHOLE DESIGN. The stamp must land
 * *after* the page it belongs to has been rendered and sent, for the same
 * reason `markActivityRead` defers on the Notifications panel: if the mark were
 * written before or during the render, the surface would clear the very items
 * that brought the student to it and they would arrive at a screen with no
 * indication of what was new. Deferring means THIS visit still shows the new
 * things, and the badge is gone by the next navigation.
 *
 * It also keeps the write off the response path entirely, so a page that gained
 * a seen-stamp did not gain a round trip before its first byte.
 *
 * Failures are swallowed. A missed stamp costs a badge that clears one visit
 * late; a thrown error would take down the page that was only trying to record
 * that it had been read.
 */

/**
 * The Community hub was opened. Clears the hub-level items — newly created
 * communities, memberships you were approved into, approvals of your own
 * community or event — and the events mark, because /communities is where
 * events are listed.
 *
 * Deliberately does NOT clear anything that lives inside a specific space: a
 * join request waiting in a community you never opened is still waiting.
 */
export function markCommunityHubSeen(): void {
  after(async () => {
    try {
      const supabase = await createClient();
      await supabase.rpc("touch_community_seen");
    } catch {
      // See above: a missed stamp is a badge that clears one visit late.
    }
  });
}

/**
 * One space was opened. Clears only that space's items — its review queue, its
 * join requests, its broadcasts — so reading one society cannot silence
 * another's, which is the failure a single global timestamp would have had.
 */
export function markCommunitySpaceSeen(communityId: string): void {
  after(async () => {
    try {
      const supabase = await createClient();
      await supabase.rpc("touch_community_space_seen", {
        p_community: communityId,
      });
    } catch {
      // See above.
    }
  });
}
