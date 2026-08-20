"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  tabListClass,
  tabTriggerClass,
  TAB_INDICATOR_CLASS,
} from "@/components/ui/tab-style";

export type SpaceShellTab = {
  key: string;
  label: string;
  badge?: number;
  content: React.ReactNode;
};

/** Above this many tabs the row scrolls instead of squeezing. */
const EQUAL_WIDTH_MAX = 4;

/**
 * Shared chrome for every "space" profile — society, chat room, event.
 *
 * The `hero` (cover, name, Follow/Join) and the tab bar stay mounted and
 * visually frozen while `active` changes: each tab's content is server-fetched
 * up front by the page and handed in as `tabs[].content`, so switching is a
 * pure client state change — the indicator moves on the same frame as the tap,
 * nothing re-renders above the bar, and there is no network round trip.
 *
 * Tab bar layout: up to four tabs share the width equally, which covers every
 * space today (Broadcast/Events/Members/Manage at most). A fifth would clip
 * them, so the row becomes horizontally scrollable instead.
 *
 * No tab hosts a conversation any more — chat lives in /chat — so the shell
 * scrolls normally with the page rather than locking to the viewport.
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

  // Deep links open a specific tab: a "asked to join your community"
  // notification must land on Manage, not Overview (fix-005). Read after mount
  // from `window.location` rather than `useSearchParams`, so this stays out of
  // the prerender path and needs no extra Suspense boundary under PPR.
  const keys = tabs.map((t) => t.key).join(",");
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("tab");
    // A one-shot sync from the URL on mount. It cannot be a state initialiser
    // or a during-render adjustment because `window` does not exist while this
    // is prerendered, and it deliberately is not `useSearchParams`, which would
    // need a Suspense boundary under Cache Components. One extra render on
    // mount is the intended cost.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (want && keys.split(",").includes(want)) setActive(want);
  }, [keys]);
  const scrolls = tabs.length > EQUAL_WIDTH_MAX;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {hero}

      <div className="flex flex-1 flex-col px-4 pb-4 pt-4">
        <div
          role="tablist"
          className={cn(
            tabListClass(), "shrink-0",
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
                  tabTriggerClass(isActive, !scrolls),
                  "whitespace-nowrap",
                  scrolls && "shrink-0 px-4"
                )}
              >
                {tab.label}
                {tab.badge ? (
                  <span className="rounded-full bg-accent px-1.5 text-xs text-white">
                    {tab.badge}
                  </span>
                ) : null}
                {isActive && (
                  <span className={TAB_INDICATOR_CLASS} />
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
