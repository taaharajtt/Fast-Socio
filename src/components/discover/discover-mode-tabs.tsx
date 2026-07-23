"use client";

import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { DISCOVER_TABS, type DiscoverMode } from "@/lib/smart-match/modes";
import { DiscoverTabSkeleton } from "@/components/discover/discover-tab-skeleton";

/**
 * Discover mode switcher — the same underlined-text look as the Ranks page tabs
 * (Leaderboard | Department Rankings), made horizontally scrollable so all six
 * modes fit the mobile column. SOCIO is first and default; selecting it drops
 * the query param. Each mode is a shareable ?mode= URL.
 *
 * Tapping a tab flips the underline INSTANTLY (local `optimistic` state) rather
 * than waiting on the server round-trip; `children` (the previous mode's
 * server-rendered content) is swapped for a shimmer skeleton until the new
 * content arrives. `optimistic` re-syncs to the real `current` prop via the
 * render-phase "adjust state when a prop changes" pattern (no effect — avoids
 * the set-state-in-effect lint trap), which also covers browser back/forward.
 */
export function DiscoverModeTabs({
  current,
  children,
}: {
  current: DiscoverMode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(current);
  const [prevCurrent, setPrevCurrent] = useState(current);

  if (current !== prevCurrent) {
    setPrevCurrent(current);
    setOptimistic(current);
  }

  function go(mode: DiscoverMode) {
    if (mode === optimistic) return;
    setOptimistic(mode);
    startTransition(() =>
      router.push(mode === "socio" ? "/discover" : `/discover?mode=${mode}`)
    );
  }

  const showSkeleton = optimistic !== current;

  return (
    <div>
      <div className="mb-4 flex gap-5 overflow-x-auto border-b border-white/[0.08] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DISCOVER_TABS.map(({ mode, label }) => {
          const active = optimistic === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              onClick={() => go(mode)}
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
      {showSkeleton ? <DiscoverTabSkeleton mode={optimistic} /> : children}
    </div>
  );
}
