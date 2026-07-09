"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import { AppImage } from "@/components/ui/app-image";
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
}: {
  /** Unread counts keyed by nav href (e.g. { "/chat": 3 }). */
  badges?: Record<string, number>;
  /** Viewer's avatar — rendered as the "Me" (/profile) tab icon (UAT-005). */
  avatarUrl?: string | null;
}) {
  const pathname = usePathname();

  if (/^\/chat\/.+/.test(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-bg pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex h-14 max-w-md items-stretch">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const badge = badges[href] ?? 0;
          return (
            <Link
              key={href}
              href={href}
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
