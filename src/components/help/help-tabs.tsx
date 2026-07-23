"use client";

import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { HELP_TABS, type HelpTab } from "@/lib/help/constants";
import { HelpTabSkeleton } from "@/components/help/help-tab-skeleton";

/**
 * SOCIO | ME switcher — a compact, cardless pill segmented control (not an
 * underline), deliberately smaller and quieter than the top-level Profile tabs
 * so it reads as secondary when embedded inside Profile → Help. Active pill is
 * a soft purple fill; inactive is muted text on a transparent/subtle surface.
 *
 * Tapping a pill flips its active state INSTANTLY (local `optimistic` state) —
 * it doesn't wait for the server round-trip — while `children` (the previous
 * tab's server-rendered content, still what's actually in the tree) is swapped
 * for a shimmer skeleton until the new content arrives. `optimistic` re-syncs
 * to the real `active` prop via the render-phase "adjust state when a prop
 * changes" pattern (no effect, so no set-state-in-effect lint trip) — this also
 * covers browser back/forward, which changes `active` without going through
 * `go()`.
 *
 * The hrefs are passed in so the shell stays host-agnostic (today both point at
 * `/help`); it carries no assumption about its route.
 */
export function HelpTabs({
  active,
  socioHref,
  meHref,
  children,
}: {
  active: HelpTab;
  socioHref: string;
  meHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(active);
  const [prevActive, setPrevActive] = useState(active);

  if (active !== prevActive) {
    setPrevActive(active);
    setOptimistic(active);
  }

  function go(key: HelpTab, href: string) {
    if (key === optimistic) return;
    setOptimistic(key);
    startTransition(() => router.push(href, { scroll: false }));
  }

  const showSkeleton = optimistic !== active;

  return (
    <div>
      <div
        role="tablist"
        className="mb-5 flex w-fit gap-1 rounded-full bg-white/[0.04] p-1"
      >
        {HELP_TABS.map((t) => {
          const isActive = optimistic === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => go(t.key, t.key === "socio" ? socioHref : meHref)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide transition-colors",
                isActive
                  ? "bg-accent/15 text-accent"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {showSkeleton ? <HelpTabSkeleton tab={optimistic} /> : children}
    </div>
  );
}
