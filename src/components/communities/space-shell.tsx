"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type SpaceShellTab = {
  key: string;
  label: string;
  badge?: number;
  content: React.ReactNode;
  /**
   * The tab owns the remaining viewport height and scrolls internally (chat).
   * The shell then locks its own height so the hero and tab bar never move and
   * the page itself does not scroll — only the tab's feed does.
   */
  fill?: boolean;
};

/** Above this many tabs the row scrolls instead of squeezing (owner/mod view). */
const EQUAL_WIDTH_MAX = 4;

/**
 * Shared chrome for every "space" surface — society, chat room, event.
 *
 * The `hero` (cover, name, Follow/Join) and the tab bar stay mounted and
 * visually frozen while `active` changes: each tab's content is server-fetched
 * up front by the page and handed in as `tabs[].content`, so switching is a
 * pure client state change — the indicator moves on the same frame as the tap,
 * nothing re-renders above the bar, and there is no network round trip.
 *
 * Tab bar layout: up to four tabs share the width equally; a fifth (Manage)
 * would clip them, so the row becomes horizontally scrollable instead.
 */
export function SpaceShell({
  hero,
  tabs,
}: {
  hero: React.ReactNode;
  tabs: SpaceShellTab[];
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];
  const fill = Boolean(activeTab?.fill);
  const scrolls = tabs.length > EQUAL_WIDTH_MAX;

  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-md flex-col",
        // 5rem = the dock clearance the student layout reserves (pb-20); --kb is
        // the iOS keyboard overlap (use-keyboard-inset).
        fill
          ? "h-[calc(100dvh-5rem-var(--kb,0px))] overflow-hidden"
          : "flex-1"
      )}
    >
      {hero}

      <div
        className={cn(
          "flex flex-col px-4 pt-4",
          fill ? "min-h-0 flex-1" : "flex-1 pb-4"
        )}
      >
        <div
          role="tablist"
          className={cn(
            "flex shrink-0 border-b border-white/[0.08]",
            scrolls && "no-scrollbar overflow-x-auto overscroll-x-contain"
          )}
        >
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab?.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(tab.key)}
                className={cn(
                  "relative flex items-center justify-center gap-1.5 whitespace-nowrap pb-3 text-center text-[15px] font-semibold transition-colors",
                  scrolls ? "shrink-0 px-4" : "flex-1",
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

        <div
          className={cn(
            fill ? "flex min-h-0 flex-1 flex-col" : "min-h-[300px] pt-4"
          )}
        >
          {activeTab?.content}
        </div>
      </div>
    </main>
  );
}
