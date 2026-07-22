"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import { VerifiedBadge } from "@/components/ui";
import { communityIcon } from "@/lib/communities/icon";
import { categoryLabel } from "@/lib/societies/constants";
import { followSociety, unfollowSociety } from "@/app/(student)/societies/actions";
import type { SocietyCardVM } from "@/lib/societies/types";

const BANNER_GRADIENT = "linear-gradient(135deg, #4c1d95, #7c3aed)";

export function SocietyCard({ s }: { s: SocietyCardVM }) {
  const [following, setFollowing] = useState(s.isFollowing);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !following;
    setFollowing(next);
    start(async () => {
      if (next) await followSociety(s.id);
      else await unfollowSociety(s.id);
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div
        className="relative h-[96px]"
        style={s.cover_url ? undefined : { background: BANNER_GRADIENT }}
      >
        {s.cover_url && (
          <AppImage src={s.cover_url} alt="" sizes="(max-width: 448px) 100vw, 448px" />
        )}
        <div className="absolute inset-0 bg-black/40" />
        {s.isRecruiting && (
          <span className="absolute right-3 top-2.5 rounded-full bg-success/90 px-2.5 py-1 text-[11px] font-bold text-white">
            Recruiting
          </span>
        )}
        <Link
          href={`/societies/${s.id}`}
          className="absolute bottom-2.5 left-3 flex items-center gap-2"
        >
          <span className="text-2xl leading-none" aria-hidden>
            {communityIcon(s.name)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1">
              <span className="block truncate text-[15px] font-bold text-white">
                {s.name}
              </span>
              {s.isOfficial && <VerifiedBadge size={15} />}
            </span>
            <span className="block text-xs text-white/75">
              {categoryLabel(s.category)} · {s.member_count.toLocaleString()}{" "}
              follower{s.member_count === 1 ? "" : "s"}
            </span>
          </span>
        </Link>
      </div>

      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          {s.description ? (
            <p className="truncate text-[13px] text-fg-muted">{s.description}</p>
          ) : (
            <p className="truncate text-[13px] text-fg-disabled">No bio yet</p>
          )}
          {s.upcomingEvents > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-[12px] font-medium text-accent">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {s.upcomingEvents} upcoming event{s.upcomingEvents === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={following}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all active:scale-95 disabled:opacity-60",
            following ? "bg-white/10 text-fg" : "bg-accent text-white"
          )}
        >
          {!following && <UserPlus className="h-3.5 w-3.5" aria-hidden />}
          {following ? "Following" : "Follow"}
        </button>
      </div>
    </div>
  );
}
