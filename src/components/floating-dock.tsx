"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Floating Glass Dock (UI Spec §4): floats above content with a margin from the
 * bottom edge (not flush), frosted blur, and a subtle border — VisionOS / Apple
 * Music / Arc inspired. The active tab is shown by an Aura Purple fill + glow on
 * the icon, not a full-bar color change. Sits above the iOS safe-area inset.
 */
export function FloatingDock() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="glass-strong pointer-events-auto flex items-center gap-1 rounded-[var(--radius-pill)] p-1.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-12 w-12 items-center justify-center rounded-full " +
                  "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
                  "active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura/60",
                active
                  ? "bg-aura text-white shadow-[0_0_20px_rgba(124,92,255,0.55)]"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              <Icon
                className="h-[22px] w-[22px]"
                strokeWidth={active ? 2.4 : 2}
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
