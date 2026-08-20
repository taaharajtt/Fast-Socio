"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UnreadBadge } from "@/components/ui/badges";
import { cn } from "@/lib/utils";
import {
  tabListClass,
  tabTriggerClass,
  TAB_INDICATOR_CLASS,
} from "@/components/ui/tab-style";

export type RouteTab = {
  /** Stable identity for the tab, independent of its URL. */
  key: string;
  href: string;
  label: string;
  badge?: number;
};

/**
 * Segmented pills whose panels are separate routes (UAT-006).
 *
 * A plain <Link> made every switch feel broken: the pill only lit up once the
 * server had responded, so the tap looked like it had been swallowed. Here the
 * highlight moves on tap (optimistic, before navigation resolves) and the panel
 * shows `skeleton` for as long as the transition is pending — so the UI always
 * answers immediately, then fills in.
 *
 * `children` is the server-rendered panel for the *current* route; it is passed
 * down as a prop, so this stays a thin client wrapper around server content.
 */
export function RouteTabs({
  tabs,
  activeKey,
  skeletons,
  children,
  className,
  variant = "pill",
}: {
  tabs: RouteTab[];
  activeKey: string;
  /**
   * Shimmer per tab key, shown in place of `children` while navigating. Keyed by
   * the tab being navigated TO, so the placeholder has the shape of the panel
   * that is about to arrive rather than the one being left.
   */
  skeletons: Record<string, React.ReactNode>;
  children: React.ReactNode;
  className?: string;
  /** "pill" = neutral segmented pills; "underline" = equal-width text tabs
   *  with a purple active rule over a full-width hairline. */
  variant?: "pill" | "underline";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pendingKey, setPendingKey] = useState(activeKey);

  // Only trust the optimistic key while a transition is in flight. Once the
  // route settles — or the user hits Back — `activeKey` is the truth, so there
  // is nothing to resynchronise and no effect to write.
  const shownKey = pending ? pendingKey : activeKey;

  function select(tab: RouteTab, e: React.MouseEvent) {
    // Let modified clicks (new tab, etc.) fall through to the browser.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (tab.key === shownKey) return;
    setPendingKey(tab.key);
    start(() => router.push(tab.href, { scroll: false }));
  }

  const underline = variant === "underline";

  return (
    <>
      <div
        className={cn(
          underline ? tabListClass() : "flex gap-2",
          className
        )}
      >
        {tabs.map((tab) => {
          const active = tab.key === shownKey;
          if (underline) {
            return (
              <Link
                key={tab.key}
                href={tab.href}
                onClick={(e) => select(tab, e)}
                aria-current={active ? "page" : undefined}
                className={tabTriggerClass(active)}
              >
                {tab.label}
                <UnreadBadge count={tab.badge ?? 0} className="h-[18px] min-w-[18px] px-1" />
                {active && <span className={TAB_INDICATOR_CLASS} />}
              </Link>
            );
          }
          return (
            <Link
              key={tab.key}
              href={tab.href}
              onClick={(e) => select(tab, e)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "pressable focus-ring inline-flex items-center justify-center gap-1.5",
                "rounded-full px-4 py-2 text-center text-sm font-semibold",
                active
                  ? "bg-surface-active text-fg"
                  : "bg-transparent text-fg-subtle hover:text-fg-muted"
              )}
            >
              {tab.label}
              {tab.badge ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs",
                    active ? "bg-fg/15 text-fg" : "bg-accent text-white"
                  )}
                >
                  {tab.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {pending ? (skeletons[shownKey] ?? null) : children}
    </>
  );
}
