"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { VerifiedBadge } from "@/components/ui";
import { communityIcon } from "@/lib/communities/icon";
import { categoryLabel } from "@/lib/societies/constants";
import { FollowSocietyButton } from "@/components/societies/follow-society-button";
import { SocietyReportButton } from "@/components/societies/society-report-button";
import { cn } from "@/lib/utils";
import type { SocietyContext } from "@/lib/societies/load";

export type SocietyShellTab = {
  key: string;
  label: string;
  badge?: number;
  content: React.ReactNode;
};

const GRADIENT = "linear-gradient(135deg, #4c1d95, #7c3aed)";

/**
 * Stable chrome for a society profile: the banner hero (cover, logo, name,
 * verification, follow) and the subtab bar stay mounted and visually frozen
 * while `activeTab` switches — every tab's content is server-fetched up front
 * (see /societies/[id]/page.tsx) and handed in as `tabs[].content`, so
 * switching tabs is a pure client state change with zero network round trip
 * and zero layout shift.
 */
export function SocietyShell({
  ctx,
  tabs,
}: {
  ctx: SocietyContext;
  tabs: SocietyShellTab[];
}) {
  const { society: s, viewer } = ctx;
  const [active, setActive] = useState(tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

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
          href="/communities"
          aria-label="Back"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>

        <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10">
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
        <div className="flex border-b border-white/[0.08]">
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab?.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActive(tab.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex flex-1 items-center justify-center gap-1.5 pb-3 text-center text-[15px] font-semibold transition-colors",
                  isActive ? "text-fg" : "text-fg-muted hover:text-fg"
                )}
              >
                {tab.label}
                {tab.badge ? (
                  <span className="gradient-brand rounded-full px-1.5 text-xs text-white">
                    {tab.badge}
                  </span>
                ) : null}
                {isActive && (
                  <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent" />
                )}
              </button>
            );
          })}
        </div>

        <div className="min-h-[300px] pt-4">{activeTab?.content}</div>
      </div>
    </main>
  );
}
