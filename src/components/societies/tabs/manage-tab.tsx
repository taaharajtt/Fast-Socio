import { DoorOpen, Megaphone, ShieldCheck, UserCog, Users } from "lucide-react";
import { ReviewPostRow, type PendingPost } from "@/components/communities/review-post-row";
import { JoinRequestQueue } from "@/components/communities/join-request-queue";
import { MemberAccessList } from "@/components/communities/member-access-list";
import { MemberRoleList } from "@/components/societies/member-role-list";
import { SocietyProfileEditor } from "@/components/societies/society-profile-editor";
import {
  assignableRoles,
  canEditProfile,
  isOfficerRole,
  type Viewer,
} from "@/lib/societies/logic";
import type { CommunityMemberVM } from "@/components/communities/member-row";
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
 * The society control panel — one tab, two permission tiers.
 *
 * Every officer, moderators included, gets the working queues: who is let in,
 * what gets published, who stays. Only president-and-up (and the owner, who
 * outranks them all) additionally sees officer appointments and the society's
 * own identity. Those two sections are not merely hidden from a moderator:
 * assign_society_role() and upsert_society_profile() both refuse a rank below
 * 90 server-side (migs 0103 and 0120), so the panel and the database agree.
 */
export function ManageTab({
  society,
  pendingPosts,
  joinRequests,
  officers,
  members,
  viewer,
}: {
  society: SocietyRow;
  pendingPosts: PendingPost[];
  joinRequests: JoinRequestVM[];
  officers: OfficerVM[];
  /** Ordinary members — removable. Officers are managed above, not kicked here. */
  members: CommunityMemberVM[];
  viewer: Viewer;
}) {
  const canAppoint = assignableRoles(viewer).length > 0;
  const canEditIdentity = canEditProfile(viewer);
  // Officers cannot appoint (fix-024) but still need the roster visible so they
  // can step down from their own role.
  const showOfficers = canAppoint || isOfficerRole(viewer.role);

  return (
    <div className="space-y-3">
      <Section
        icon={<DoorOpen className="h-4 w-4" aria-hidden />}
        title="Join requests"
        desc="Approve to let them into the chat; followers already read broadcasts."
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
        title="Members"
        desc="Removing someone revokes their chat access; they stay a follower."
      >
        <MemberAccessList communityId={society.id} members={members} />
      </Section>

      {showOfficers && (
        <Section
          icon={<UserCog className="h-4 w-4" aria-hidden />}
          title="Officers"
          desc={
            canAppoint
              ? "Only you, as owner, can appoint or remove officers."
              : "You can step down from your own role at any time."
          }
        >
          <MemberRoleList societyId={society.id} officers={officers} viewer={viewer} />
        </Section>
      )}

      {canEditIdentity && (
        <Section
          icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
          title="Society profile"
          desc="Category, bio, banner, recruiting and links."
        >
          <SocietyProfileEditor society={society} />
        </Section>
      )}
    </div>
  );
}
