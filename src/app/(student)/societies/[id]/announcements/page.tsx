import { Megaphone } from "lucide-react";
import { SocietyShell } from "@/components/societies/society-shell";
import { AnnouncementComposer } from "@/components/societies/announcement-composer";
import { AnnouncementCard } from "@/components/societies/announcement-card";
import { getSocietyContext } from "@/lib/societies/load";
import { getSocietyAnnouncements } from "@/lib/societies/queries";
import { canManageSociety, canPostAnnouncement } from "@/lib/societies/logic";

export default async function SocietyAnnouncementsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getSocietyContext(id);
  const announcements = await getSocietyAnnouncements(id, 50);
  const canManage = canManageSociety(ctx.viewer);
  const canPost = canPostAnnouncement(ctx.viewer);

  return (
    <SocietyShell ctx={ctx} active="announcements">
      <div className="space-y-3">
        {canPost && <AnnouncementComposer societyId={id} />}

        {announcements.length === 0 ? (
          <div className="rounded-[14px] bg-card px-5 py-10 text-center">
            <Megaphone className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
            <p className="mt-3 font-semibold text-fg">No announcements yet</p>
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
    </SocietyShell>
  );
}
