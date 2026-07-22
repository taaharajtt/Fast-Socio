"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { DISCOVER_TABS, type DiscoverMode } from "@/lib/smart-match/modes";

/**
 * Discover mode switcher — the same underlined-text look as the Ranks page tabs
 * (Leaderboard | Department Rankings), made horizontally scrollable so all six
 * modes fit the mobile column. SOCIO is first and default; selecting it drops
 * the query param. Each mode is a shareable ?mode= URL.
 */
export function DiscoverModeTabs({ current }: { current: DiscoverMode }) {
  const router = useRouter();
  return (
    <div className="mb-4 flex gap-5 overflow-x-auto border-b border-white/[0.08] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {DISCOVER_TABS.map(({ mode, label }) => {
        const active = current === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            onClick={() =>
              router.push(mode === "socio" ? "/discover" : `/discover?mode=${mode}`)
            }
            className={cn(
              "relative shrink-0 whitespace-nowrap pb-3 text-[15px] font-semibold transition-colors",
              active ? "text-fg" : "text-fg-muted hover:text-fg"
            )}
          >
            {label}
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
