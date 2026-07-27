import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { VerifiedBadge } from "@/components/ui";
import { categoryLabel } from "@/lib/societies/constants";
import { SocietyReportButton } from "@/components/societies/society-report-button";
import { FollowJoinButtons } from "@/components/communities/follow-join-buttons";
import { SocialProof } from "@/components/communities/social-proof";
import { SpaceShell, type SpaceShellTab } from "@/components/communities/space-shell";
import type { SocietyContext } from "@/lib/societies/load";
import type { SocialProofVM } from "@/lib/communities/social-proof";

export type SocietyShellTab = SpaceShellTab;

const GRADIENT = "linear-gradient(135deg, #4c1d95, #7c3aed)";

/**
 * A society profile's stable chrome: the 16:9 cover with Follow/Join, the
 * society name, and the tab bar. Everything below the bar is swapped by
 * SpaceShell without touching this header.
 */
export function SocietyShell({
  ctx,
  proof,
  tabs,
}: {
  ctx: SocietyContext;
  proof: SocialProofVM;
  tabs: SocietyShellTab[];
}) {
  const { society: s, viewer } = ctx;

  const hero = (
    <>
      <div className="px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[20px]">
          {s.cover_url ? (
            <AppImage src={s.cover_url} alt="" sizes="(max-width: 448px) 100vw, 448px" />
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
          <div className="absolute right-3 top-3 z-10">
            <SocietyReportButton societyId={s.id} />
          </div>

          <div className="absolute inset-x-3 bottom-3 z-10 flex items-end justify-between gap-2">
            <SocialProof proof={proof} label="in this society" />
            <FollowJoinButtons
              communityId={s.id}
              isFollowing={viewer.isFollowing}
              joinStatus={viewer.joinStatus}
              isOwner={viewer.isOwner}
              size="sm"
            />
          </div>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="flex items-center gap-1.5">
          <h1 className="truncate text-[20px] font-bold text-fg">{s.name}</h1>
          {s.is_official && <VerifiedBadge size={16} />}
        </div>
        <p className="text-[13px] text-fg-muted">
          {categoryLabel(s.society_category)} ·{" "}
          {(s.follower_count ?? s.member_count).toLocaleString()} follower
          {(s.follower_count ?? s.member_count) === 1 ? "" : "s"}
        </p>
      </div>
    </>
  );

  return <SpaceShell hero={hero} tabs={tabs} />;
}
