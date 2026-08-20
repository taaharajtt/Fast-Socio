import { cn } from "@/lib/utils";

/**
 * The masthead of a top-level screen: identity mark, title, optional subtitle,
 * and one optional trailing control.
 *
 * The four screens that have one had drifted to four different title sizes
 * (28px on Ranks, 22px on Community and Campus Help, 18px on Discover) and
 * three different subtitle sizes, so moving between tabs felt like moving
 * between apps. They now share one ramp — `type-display` title, `type-callout`
 * subtitle — which is the cheapest possible way to make the tabs read as one
 * product.
 *
 * There is no longer a coloured section mark beside the title. A filled purple
 * tile sat next to a 32px heading that already named the screen, so the header
 * had two competing anchors and one of them was pure decoration — and it put
 * brand colour at the top of four screens for no informational gain. The
 * heading alone is the anchor now.
 *
 * The trailing slot is top-aligned rather than centred so the control keeps its
 * position whether or not the screen has a subtitle.
 */
export function ScreenHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** Trailing control — a button or link, rendered as given. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="min-w-0">
          <h1 className="type-display truncate">{title}</h1>
          {subtitle ? (
            <p className="type-callout mt-1 text-fg-muted">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </header>
  );
}
