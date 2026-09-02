import { AnnouncementThread } from "@/components/societies/announcement-thread";
import type { AnnouncementRow } from "@/lib/societies/types";

/**
 * The society's broadcast channel.
 *
 * No longer one-way: UAT-04 turns this into a role-aware SHARED channel — a
 * member may post, reply, react and post anonymously; a moderator also works
 * the membership queue; a president may reveal an anonymous author and manage
 * events; the owner may do all of that plus move officer roles around. Every
 * one of those rules is enforced by an RPC and mirrored here only for what to
 * render.
 *
 * This wrapper stays a plain (non-async) server component so the Cache
 * Components shell above it doesn't collapse.
 */
export function BroadcastTab({
  societyId,
  announcements,
  canPost,
  canManage,
  canPostAnonymously = false,
  canReveal = false,
}: {
  societyId: string;
  announcements: AnnouncementRow[];
  canPost: boolean;
  canManage: boolean;
  /** UAT-04 capability flags, resolved server-side from `society_capabilities`. */
  canPostAnonymously?: boolean;
  canReveal?: boolean;
}) {
  return (
    <AnnouncementThread
      societyId={societyId}
      announcements={announcements}
      canPost={canPost}
      canManage={canManage}
      canPostAnonymously={canPostAnonymously}
      canReveal={canReveal}
    />
  );
}
