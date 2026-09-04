import Link from "next/link";
import { AlertTriangle, DoorOpen, Pencil, Users } from "lucide-react";
import { DeleteChatRoom } from "@/components/communities/delete-chat-room";
import { JoinRequestQueue } from "@/components/communities/join-request-queue";
import { MemberAccessList } from "@/components/communities/member-access-list";
import { CommunityRenameControl } from "@/components/communities/community-rename-control";
import type { CommunityMemberVM } from "@/components/communities/member-row";
import type { JoinRequestVM } from "@/lib/communities/relationship";

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
 * Owner-only controls for a chat room. A room has a single owner and no
 * officer tier, so this is the society Manage tab minus role management:
 * who gets in, who stays, and the room's own details.
 */
export function RoomManageTab({
  communityId,
  name,
  isOwner,
  joinRequests,
  members,
}: {
  communityId: string;
  /** The room's current name: shown for rename, typed back to confirm deletion. */
  name: string;
  isOwner: boolean;
  joinRequests: JoinRequestVM[];
  members: CommunityMemberVM[];
}) {
  return (
    <div className="space-y-3">
      <Section
        icon={<DoorOpen className="h-4 w-4" aria-hidden />}
        title="Join requests"
        desc="Approve to let them send messages; followers can already spectate."
      >
        <JoinRequestQueue communityId={communityId} requests={joinRequests} />
      </Section>

      <Section
        icon={<Users className="h-4 w-4" aria-hidden />}
        title="Members"
        desc="Removing someone revokes chat access; they stay a follower."
      >
        <MemberAccessList communityId={communityId} members={members} />
      </Section>

      {isOwner && (
        <Section
          icon={<Pencil className="h-4 w-4" aria-hidden />}
          title="Room details"
          desc="Name, description and cover photo."
        >
          {/* Rename in place — the common edit, one tap, no page change. The
              full editor below still covers description and cover photo. */}
          <div className="mb-3 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-fg">{name}</span>
            <CommunityRenameControl
              communityId={communityId}
              name={name}
              label="chat room name"
            />
          </div>
          <Link
            href={`/communities/${communityId}/edit`}
            className="inline-block rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-fg"
          >
            Edit chat room
          </Link>
        </Section>
      )}

      {/* Danger Zone last, and owner-only — a moderator never sees it
          (fix-030, consistent with fix-031's owner-only rule). */}
      {isOwner && (
        <section className="rounded-[16px] border border-error/30 bg-error/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-error">
              <AlertTriangle className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-bold text-error">Danger zone</h2>
              <p className="text-xs text-fg-muted">
                Deleting the room removes its messages and members for everyone.
                This can&apos;t be undone.
              </p>
            </div>
          </div>
          <DeleteChatRoom communityId={communityId} name={name} />
        </section>
      )}
    </div>
  );
}
