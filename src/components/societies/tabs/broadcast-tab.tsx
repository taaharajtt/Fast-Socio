import Link from "next/link";
import { MessageCircle, Radio } from "lucide-react";
import { AnnouncementComposer } from "@/components/societies/announcement-composer";
import { AnnouncementCard } from "@/components/societies/announcement-card";
import type { AnnouncementRow } from "@/lib/societies/types";

/**
 * Official notices from the society — one-way, and the only feed on this page.
 * Members also get the single hand-off into the society's conversation, which
 * lives in Chat rather than in a tab here.
 */
export function BroadcastTab({
  societyId,
  announcements,
  canPost,
  canManage,
  isMember,
}: {
  societyId: string;
  announcements: AnnouncementRow[];
  canPost: boolean;
  canManage: boolean;
  /** Joined members can open the society's thread in the Chat area. */
  isMember: boolean;
}) {
  return (
    <div className="space-y-3">
      {isMember && (
        <Link
          href={`/chat/c/${societyId}`}
          className="flex items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-fg active:scale-95"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          Open chat
        </Link>
      )}

      {canPost && <AnnouncementComposer societyId={societyId} />}

      {announcements.length === 0 ? (
        <div className="rounded-[14px] bg-card px-5 py-10 text-center">
          <Radio className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-3 font-semibold text-fg">
            No broadcast announcements published yet
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            {canPost
              ? "Broadcast times, deadlines and updates to your followers."
              : "Follow the society to catch its updates here."}
          </p>
        </div>
      ) : (
        announcements.map((a) => (
          <AnnouncementCard key={a.id} a={a} canManage={canManage} />
        ))
      )}
    </div>
  );
}
