import { DoorOpen, Megaphone, ShieldCheck, Users } from "lucide-react";
import { ReviewPostRow, type PendingPost } from "@/components/communities/review-post-row";
import { JoinRequestQueue } from "@/components/communities/join-request-queue";
import { MemberRoleList } from "@/components/societies/member-role-list";
import { SocietyProfileEditor } from "@/components/societies/society-profile-editor";
import type { Viewer } from "@/lib/societies/logic";
import type { JoinRequestVM } from "@/lib/communities/relationship";
import type { OfficerVM, SocietyRow } from "@/lib/societies/types";

function Section({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[16px] bg-bg-elevated p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-fg-muted">{icon}</span>
        <div>
          <h2 className="text-sm font-bold text-fg">{title}</h2>
          {desc && <p className="text-xs text-fg-muted">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Owner/moderator control panel: pending member-post review (Zone 1), officer
 * appointments, and the society profile editor.
 */
export function ManageTab({
  society,
  pendingPosts,
  joinRequests,
  officers,
  viewer,
}: {
  society: SocietyRow;
  pendingPosts: PendingPost[];
  joinRequests: JoinRequestVM[];
  officers: OfficerVM[];
  viewer: Viewer;
}) {
  return (
    <div className="space-y-3">
      <Section
        icon={<DoorOpen className="h-4 w-4" aria-hidden />}
        title="Join requests"
        desc="Approve to let them chat; followers can already read broadcasts."
      >
        <JoinRequestQueue communityId={society.id} requests={joinRequests} />
      </Section>

      <Section
        icon={<Megaphone className="h-4 w-4" aria-hidden />}
        title="Pending member posts"
        desc="Approve or reject submissions awaiting review."
      >
        {pendingPosts.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing awaiting review.</p>
        ) : (
          <div className="space-y-3">
            {pendingPosts.map((p) => (
              <ReviewPostRow key={p.id} post={p} />
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={<Users className="h-4 w-4" aria-hidden />}
        title="Officer appointments"
        desc="Appoint officers; you can’t grant a role at or above your own."
      >
        <MemberRoleList societyId={society.id} officers={officers} viewer={viewer} />
      </Section>

      <Section
        icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
        title="Society profile"
        desc="Category, bio, banner, recruiting and links."
      >
        <SocietyProfileEditor society={society} />
      </Section>
    </div>
  );
}
