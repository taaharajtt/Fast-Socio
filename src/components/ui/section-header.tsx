import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The heading above a section of a screen — "Feed", "Campus Help", "Your
 * spaces", "Upcoming Events".
 *
 * These had drifted apart: some were 14px muted grey with a purple glyph, some
 * were 17px bold white, some were purple text. A heading's job is to say where
 * you are in the page, so all of them now read at one weight and one colour and
 * the eye can skip between sections without re-reading (apple.md §16 —
 * consistency and wayfinding).
 *
 * Sized at `type-headline` (17px), NOT at the screen-title size. A section
 * heading has to sit clearly below the screen's own title in the hierarchy; at
 * 21px "Campus Help" competed with "FAST SOCIO" above it and made the Home
 * screen read as three equally-important blocks stacked on each other.
 *
 * `icon` is optional and stays tertiary grey. Neither the heading nor its
 * trailing link spends the brand colour: "See all" is an ordinary secondary
 * action, and colouring every link purple was a large part of why the app read
 * as a purple product.
 */
export function SectionHeader({
  title,
  icon: Icon,
  action,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  /** Trailing link, e.g. { label: "See all", href: "/help" }. */
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div className={cn("mb-2.5 flex items-center justify-between gap-3", className)}>
      <h2 className="type-headline flex min-w-0 items-center gap-2 text-fg">
        {Icon ? (
          <Icon className="h-[18px] w-[18px] shrink-0 text-fg-subtle" aria-hidden />
        ) : null}
        <span className="truncate">{title}</span>
      </h2>
      {action ? (
        <Link
          href={action.href}
          className="pressable focus-ring -mr-1 flex shrink-0 items-center gap-1.5 rounded-lg py-1 pl-2 pr-1 type-callout font-medium text-fg-muted hover:text-fg"
        >
          {action.label}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
