import { Radio } from "lucide-react";
import { AnnouncementComposer } from "@/components/societies/announcement-composer";
import { AnnouncementCard } from "@/components/societies/announcement-card";
import type { AnnouncementRow } from "@/lib/societies/types";

export function BroadcastTab({
  societyId,
  announcements,
  canPost,
  canManage,
}: {
  societyId: string;
  announcements: AnnouncementRow[];
  canPost: boolean;
  canManage: boolean;
}) {
  return (
    <div className="space-y-3">
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
