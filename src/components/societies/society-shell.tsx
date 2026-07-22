import Link from "next/link";
import { ChevronLeft, Settings2 } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { VerifiedBadge } from "@/components/ui";
import { RouteTabs, type RouteTab } from "@/components/ui/route-tabs";
import { SkeletonRows } from "@/components/ui/skeleton";
import { communityIcon } from "@/lib/communities/icon";
import { categoryLabel } from "@/lib/societies/constants";
import { canManageSociety } from "@/lib/societies/logic";
import { FollowSocietyButton } from "@/components/societies/follow-society-button";
import { SocietyReportButton } from "@/components/societies/society-report-button";
import type { SocietyContext } from "@/lib/societies/load";
import type { SocietyTab } from "@/lib/societies/constants";

const GRADIENT = "linear-gradient(135deg, #4c1d95, #7c3aed)";

/**
 * Shared chrome for every society profile sub-route: the banner hero (cover,
 * logo, name, verification, follow) and the tab bar. Each route renders its own
 * panel as `children`.
 */
export function SocietyShell({
  ctx,
  active,
  children,
}: {
  ctx: SocietyContext;
  active: SocietyTab;
  children: React.ReactNode;
}) {
  const { society: s, viewer } = ctx;
  const canManage = canManageSociety(viewer);
  const base = `/societies/${s.id}`;

  const tabs: RouteTab[] = [
    { key: "overview", href: base, label: "Overview" },
    { key: "events", href: `${base}/events`, label: "Events" },
    { key: "announcements", href: `${base}/announcements`, label: "News" },
    { key: "members", href: `${base}/members`, label: "Members" },
    { key: "recruitment", href: `${base}/recruitment`, label: "Recruit" },
  ];
  const skeletons: Record<string, React.ReactNode> = {
    overview: <SkeletonRows count={3} />,
    events: <SkeletonRows count={3} />,
    announcements: <SkeletonRows count={3} />,
    members: <SkeletonRows count={4} />,
    recruitment: <SkeletonRows count={2} />,
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="relative h-[200px] w-full overflow-hidden">
        {s.cover_url ? (
          <AppImage
            src={s.cover_url}
            alt=""
            sizes="(max-width: 448px) 100vw, 448px"
          />
        ) : (
          <div className="h-full w-full" style={{ background: GRADIENT }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

        <Link
          href="/societies"
          aria-label="Back"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>

        <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex items-center gap-2">
          {canManage && (
            <Link
              href={`${base}/manage`}
              aria-label="Manage society"
              className="flex h-9 items-center gap-1.5 rounded-full bg-black/40 px-3 text-sm font-semibold text-white"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              Manage
            </Link>
          )}
          <SocietyReportButton societyId={s.id} />
        </div>

        <div className="absolute inset-x-4 bottom-3 flex items-end gap-3">
          <span className="text-3xl leading-none" aria-hidden>
            {communityIcon(s.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-[18px] font-bold text-white">{s.name}</h1>
              {s.is_official && <VerifiedBadge size={16} />}
            </div>
            <p className="text-[13px] text-white/75">
              {categoryLabel(s.society_category)} ·{" "}
              {s.member_count.toLocaleString()} follower
              {s.member_count === 1 ? "" : "s"}
            </p>
          </div>
          <FollowSocietyButton
            societyId={s.id}
            isFollowing={viewer.isFollowing}
            isOwner={viewer.isOwner}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4">
        <RouteTabs
          tabs={tabs}
          activeKey={active}
          variant="underline"
          skeletons={skeletons}
        >
          <div className="pt-4">{children}</div>
        </RouteTabs>
      </div>
    </main>
  );
}
