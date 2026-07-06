"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation dock — Figma "Glasmorphism PWA" treatment: a near-solid dark
 * bar (not a translucent pill) with a heavy blur and top shadow, full width with
 * a phone-width cap. Each tab shows an icon + label; the active tab uses the
 * magenta accent (#C850C0) with a soft glow and a tinted icon well.
 * Route set is unchanged — this is a visual re-skin only.
 */
export function FloatingDock() {
  const pathname = usePathname();

  // Hidden on immersive conversation screens (/chat/<id>) so the composer is
  // unobstructed; the /chat list itself keeps the dock.
  if (/^\/chat\/.+/.test(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-md items-center justify-around rounded-[26px] border border-white/10 bg-[rgba(10,11,20,0.88)] px-1 py-2.5 shadow-[0_-2px_40px_rgba(0,0,0,0.5)] backdrop-blur-[32px]">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className="flex flex-col items-center gap-0.5 px-2 py-1 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-90 focus-visible:outline-none"
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-200",
                  active && "bg-[rgba(200,80,192,0.18)]"
                )}
              >
                <Icon
                  className={cn(
                    "h-[21px] w-[21px]",
                    active
                      ? "text-accent drop-shadow-[0_0_8px_rgba(200,80,192,0.7)]"
                      : "text-white/40"
                  )}
                  strokeWidth={active ? 2.4 : 2}
                  aria-hidden
                />
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold",
                  active ? "text-accent" : "text-white/30"
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
