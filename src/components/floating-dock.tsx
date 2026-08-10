"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, activeNavHref } from "@/lib/nav";
import { AppImage } from "@/components/ui/app-image";
import { useChatBadge } from "@/lib/chat/badge-store";
import { markDockTap, reportDockNavigation } from "@/lib/nav-perf";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation bar — UISpec V3 §2.1. A flush (non-floating) bar pinned to
 * the screen edge: solid app-background, a 1px top hairline, 56px of visible
 * height plus the safe-area inset. Six equal tabs (Home · Discover · Ranks ·
 * Events · Chat · Me). The active tab shows a purple-tinted icon well + purple
 * label; inactive tabs are muted grey.
 *
 * z-40 keeps it below the modal layer (z-50) so sheets cover it. Hidden on the
 * immersive conversation screen (/chat/<id>) so the composer is unobstructed.
 */
export function FloatingDock({
  badges = {},
  avatarUrl,
  viewerId,
  hiddenHrefs = [],
}: {
  /** Unread counts keyed by nav href (e.g. { "/chat": 3 }). */
  badges?: Record<string, number>;
  /** Viewer's avatar — rendered as the "Me" (/profile) tab icon (UAT-005). */
  avatarUrl?: string | null;
  /** Distinguishes your own /profile/<id> from another student's (UAT-011). */
  viewerId?: string;
  /** Nav hrefs to omit when their feature flag is off (Refactor Phase 1). */
  hiddenHrefs?: string[];
}) {
  const pathname = usePathname();
  // The chat count is the one badge that changes while you sit on a screen, so
  // it comes from the realtime store (seeded by, and falling back to, the
  // server-rendered value) rather than waiting for the next navigation.
  const chatBadge = useChatBadge(badges["/chat"] ?? 0);

  // Optimistic active tab. A tab switch still has to reach the server for the
  // new segment, and until it commits `pathname` is the OLD route — so without
  // this the purple highlight sat on the tab you just left for the whole round
  // trip and the dock read as unresponsive. Tapping moves the highlight on the
  // same frame as the press; the real pathname takes over the moment it lands.
  // Stored WITH the pathname it was tapped from, so it can be cleared during
  // render the moment the route actually changes — no effect, no extra commit.
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(
    null
  );
  if (tapped && tapped.from !== pathname) setTapped(null);

  // Dev-only: time from tapping a tab to the new route being committed. Paired
  // with the server-side [perf] phase logs, this is the number this whole
  // exercise is about. Logs a route path and a duration, nothing else.
  useEffect(() => {
    reportDockNavigation(pathname);
  }, [pathname]);

  // Feature-flagged destinations are dropped from the dock entirely so a
  // disabled feature is neither shown nor reachable via the primary nav.
  const items = NAV_ITEMS.filter((n) => !hiddenHrefs.includes(n.href));

  // Immersive conversation screens hide the dock so the composer is
  // unobstructed — 1:1 threads (/chat/<convId>) and community rooms
  // (/chat/c/<communityId>), which are the same screen with a different subject.
  if (/^\/chat\/.+/.test(pathname)) return null;

  const activeHref =
    (tapped?.from === pathname ? tapped.href : null) ??
    activeNavHref(pathname, viewerId);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-bg pb-[var(--safe-bottom)]"
    >
      <div className="mx-auto flex h-[var(--dock-h)] max-w-md items-stretch">
        {items.map(({ href, label, icon: Icon }) => {
          const active = activeHref === href;
          const badge = href === "/chat" ? chatBadge : (badges[href] ?? 0);
          return (
            <Link
              key={href}
              href={href}
              data-tour={`nav:${href}`}
              onClick={() => {
                setTapped({ href, from: pathname });
                markDockTap(href);
              }}
              aria-label={badge ? `${label}, ${badge} unread` : label}
              aria-current={active ? "page" : undefined}
              className="flex flex-1 flex-col items-center justify-center gap-1 transition-transform duration-150 active:scale-90 focus-visible:outline-none"
            >
              <span
                className={cn(
                  "relative flex h-7 w-11 items-center justify-center rounded-xl transition-colors",
                  active && "bg-accent/15"
                )}
              >
                {/* UAT-005: the "Me" tab shows the user's dp instead of a
                    generic person icon. Falls back to the icon if no avatar. */}
                {href === "/profile" && avatarUrl ? (
                  <span
                    className={cn(
                      "relative block h-[24px] w-[24px] overflow-hidden rounded-full ring-2",
                      active ? "ring-accent" : "ring-transparent"
                    )}
                  >
                    <AppImage src={avatarUrl} alt="" sizes="24px" />
                  </span>
                ) : (
                  <Icon
                    className={cn(
                      "h-[22px] w-[22px]",
                      active ? "text-accent" : "text-fg-muted"
                    )}
                    strokeWidth={active ? 2.4 : 1.9}
                    aria-hidden
                  />
                )}
                {badge > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-[11px] leading-none",
                  active ? "font-semibold text-accent" : "text-fg-muted"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
