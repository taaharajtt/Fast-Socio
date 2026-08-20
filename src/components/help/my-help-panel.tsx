import Link from "next/link";
import { Plus, Inbox, CircleDot, CheckCircle2, HandHeart } from "lucide-react";
import { HelpCard } from "@/components/help/help-card";
import { groupMyRequests } from "@/lib/help/logic";
import { cn } from "@/lib/utils";
import type { HelpRequestRow } from "@/lib/help/types";

/**
 * The ME tab: your own help area. A prominent "Ask for help" button, then your
 * asks grouped into what needs attention (open with responses), still-open, and
 * your resolved history — no extra sub-tabs, just compact sections.
 */
export function MyHelpPanel({ rows }: { rows: HelpRequestRow[] }) {
  const { active, withResponses, resolved } = groupMyRequests(rows);
  const withResponseIds = new Set(withResponses.map((r) => r.id));
  const activeQuiet = active.filter((r) => !withResponseIds.has(r.id));

  return (
    <div>
      {/*
        "Ask for help" was a full-width purple pill roughly a sixth of the
        viewport tall, sitting above content — on a tab whose actual subject is
        the asks you have already made, the compose button WAS the screen. It is
        now a compact action on the header line: still the first thing in the
        reading order, still an obvious primary (it is the only light-filled
        control here), but sized to what it is.
      */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-title">Your asks</h2>
        <Link
          href="/help/new"
          className="pressable focus-ring flex shrink-0 items-center gap-1.5 rounded-[10px] bg-emphasis px-3.5 py-2 text-sm font-semibold text-emphasis-fg"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Ask for help
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="py-14 text-center">
          <HandHeart className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden />
          <p className="type-headline mt-3 text-fg">You haven&apos;t asked yet</p>
          <p className="type-callout mt-1 text-fg-muted">
            Stuck on something? Post it and let campus help you out.
          </p>
        </div>
      ) : (
        <>
          {withResponses.length > 0 && (
            <Section
              icon={<Inbox className="h-4 w-4 text-fg-subtle" aria-hidden />}
              title="Responses received"
              hint="Reply to a helper, or pick the one who solved it."
              rows={withResponses}
            />
          )}
          {activeQuiet.length > 0 && (
            <Section
              icon={<CircleDot className="h-4 w-4 text-success" aria-hidden />}
              title="Active"
              rows={activeQuiet}
            />
          )}
          {resolved.length > 0 && (
            <Section
              icon={<CheckCircle2 className="h-4 w-4 text-fg-subtle" aria-hidden />}
              title="Resolved & history"
              rows={resolved}
              muted
            />
          )}
        </>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  rows,
  muted,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  rows: HelpRequestRow[];
  /** Resolved & history: dims the cards so they read as inactive. */
  muted?: boolean;
}) {
  return (
    <section className="stack-section">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="type-label text-fg-subtle">{title}</h3>
        <span className="type-label text-fg-disabled">{rows.length}</span>
      </div>
      {hint && <p className="type-caption mt-1 text-fg-subtle">{hint}</p>}
      <div className={cn(muted && "opacity-80")}>
        {rows.map((req) => (
          <HelpCard key={req.id} req={req} />
        ))}
      </div>
    </section>
  );
}
