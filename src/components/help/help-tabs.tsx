import Link from "next/link";
import { cn } from "@/lib/utils";
import { HELP_TABS, type HelpTab } from "@/lib/help/constants";

/**
 * SOCIO | ME switcher — a compact, cardless pill segmented control (not an
 * underline), deliberately smaller and quieter than the top-level Profile tabs
 * so it reads as secondary when embedded inside Profile → Help. Active pill is
 * a soft purple fill; inactive is muted text on a transparent/subtle surface.
 * These are real links so the server component re-queries per tab and the URL
 * stays shareable; SOCIO is the default.
 *
 * The hrefs are passed in so the same shell works at `/help` and embedded inside
 * `/profile?tab=help` (which uses a different param scheme) without divergence.
 */
export function HelpTabs({
  active,
  socioHref,
  meHref,
}: {
  active: HelpTab;
  socioHref: string;
  meHref: string;
}) {
  return (
    <div
      role="tablist"
      className="mb-5 flex w-fit gap-1 rounded-full bg-white/[0.04] p-1"
    >
      {HELP_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.key === "socio" ? socioHref : meHref}
            role="tab"
            aria-selected={isActive}
            scroll={false}
            className={cn(
              "rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide transition-colors",
              isActive
                ? "bg-accent/15 text-accent"
                : "text-fg-muted hover:text-fg"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
