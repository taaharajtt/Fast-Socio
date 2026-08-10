import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { GlassChip } from "@/components/ui";
import { FollowJoinButtons } from "@/components/communities/follow-join-buttons";
import { SocialProof } from "@/components/communities/social-proof";
import { SpaceShell, type SpaceShellTab } from "@/components/communities/space-shell";
import type { JoinState } from "@/app/(student)/communities/actions";
import type { SocialProofVM } from "@/lib/communities/social-proof";

export type ChatRoomShellTab = SpaceShellTab;

const GRADIENT = "linear-gradient(135deg, #4c1d95, #7c3aed)";

/**
 * A casual chat room's stable chrome — the simpler sibling of SocietyShell: one
 * owner, no officers, and only Overview / Members (plus Manage for the owner).
 */
export function ChatRoomShell({
  community,
  proof,
  isFollowing,
  joinStatus,
  isOwner,
  pending,
  tabs,
}: {
  proof: SocialProofVM;
  community: {
    id: string;
    name: string;
    avatar_url: string | null;
    cover_url: string | null;
    member_count: number;
  };
  isFollowing: boolean;
  joinStatus: JoinState;
  isOwner: boolean;
  pending: boolean;
  tabs: ChatRoomShellTab[];
}) {
  const cover = community.cover_url ?? community.avatar_url;

  const hero = (
    <>
      <div className="px-4 pt-2">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[20px]">
          {cover ? (
            <AppImage
              src={cover}
              alt=""
              sizes="(max-width: 448px) 100vw, 448px"
              priority
            />
          ) : (
            <div className="h-full w-full" style={{ background: GRADIENT }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/25" />

          <Link
            href="/communities"
            aria-label="Back"
            className="absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>
          {isOwner && (
            <Link
              href={`/communities/${community.id}/edit`}
              aria-label="Edit chat room"
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </Link>
          )}

          {!pending && (
            <div className="absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-2">
              <SocialProof proof={proof} label="in this room" />
              <FollowJoinButtons
                communityId={community.id}
                isFollowing={isFollowing}
                joinStatus={joinStatus}
                isOwner={isOwner}
                size="sm"
              />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[20px] font-bold text-fg">{community.name}</h1>
          {pending && <GlassChip tone="warning">pending</GlassChip>}
        </div>
        <p className="text-[13px] text-fg-muted">
          {community.member_count.toLocaleString()} member
          {community.member_count === 1 ? "" : "s"}
        </p>
      </div>
    </>
  );

  if (pending) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {hero}
        <p className="px-4 pt-8 text-center text-sm text-fg-muted">
          This chat room is awaiting admin approval.
        </p>
      </main>
    );
  }

  return <SpaceShell hero={hero} tabs={tabs} />;
}
