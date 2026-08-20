import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The masthead for a secondary screen — one you arrived at from somewhere else,
 * so it needs a way back.
 *
 * Back controls had been drifting into their own shapes per screen: a 36px
 * `glass` disc here, a 40px `bg-fill` disc there, a floating black circle over
 * a cover photo somewhere else — and on the narrow screens a long title would
 * run under whatever sat at the other end of the row.
 *
 * This is the one implementation. The back control is a bare glyph rather than
 * a filled disc, because a disc turns a "leave" affordance into one of the
 * heaviest objects on the page; it keeps a 44px touch target via padding, and
 * a negative margin pulls the glyph back to the page gutter so the title still
 * starts on the same vertical line as the content below it.
 *
 * `title` truncates and `trailing` never shrinks, so the two can't collide.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  trailing,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** Omit for a screen with no parent (a root tab). */
  backHref?: string;
  backLabel?: string;
  /** Optional control at the far end (report, menu, …). */
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start gap-2", className)}>
      {backHref ? (
        <Link
          href={backHref}
          aria-label={backLabel}
          className="pressable focus-ring -ml-2.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="type-display truncate">{title}</h1>
        {subtitle ? (
          <p className="type-callout mt-1 text-fg-muted">{subtitle}</p>
        ) : null}
      </div>
      {trailing ? <div className="-mt-1 shrink-0">{trailing}</div> : null}
    </header>
  );
}

/**
 * A labelled group of settings-style rows.
 *
 * The group is introduced by an uppercase eyebrow and separated from its
 * neighbours by space — not by drawing a rounded rectangle around it. Settings
 * had eight stacked cards, which made a list of eleven links read as eleven
 * containers; the page itself is the container now.
 */
export function SettingsGroup({
  label,
  children,
  className,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  /** "danger" tints only the label, for a destructive group. */
  tone?: "default" | "danger";
}) {
  return (
    <section className={cn("stack-section", className)}>
      <h2
        className={cn(
          "type-label mb-1",
          tone === "danger" ? "text-error" : "text-fg-subtle"
        )}
      >
        {label}
      </h2>
      {children}
    </section>
  );
}

/** One tappable settings row: glyph, label, chevron. */
export function SettingsRow({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  /** Right-aligned current value, e.g. "Normal". */
  detail?: string;
}) {
  return (
    <Link
      href={href}
      className="pressable-subtle focus-ring -mx-2 flex items-center gap-3 rounded-[10px] px-2 py-3.5"
    >
      {Icon ? <Icon className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden /> : null}
      <span className="type-body min-w-0 flex-1 truncate">{label}</span>
      {detail ? (
        <span className="type-callout shrink-0 text-fg-subtle">{detail}</span>
      ) : null}
      <ChevronRightGlyph />
    </Link>
  );
}

function ChevronRightGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-fg-disabled"
      fill="none"
      aria-hidden
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
