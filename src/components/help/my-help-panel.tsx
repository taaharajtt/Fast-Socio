import Link from "next/link";
import { Plus, Inbox, CircleDot, CheckCircle2, HandHeart } from "lucide-react";
import { HelpCard } from "@/components/help/help-card";
import { groupMyRequests } from "@/lib/help/logic";
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
    <div className="space-y-6">
      <Link
        href="/help/new"
        className="gradient-brand flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(124,92,255,0.35)] active:scale-[0.98]"
      >
        <Plus className="h-5 w-5" aria-hidden />
        Ask for help
      </Link>

      {rows.length === 0 ? (
        <div className="glass rounded-[14px] px-5 py-10 text-center">
          <HandHeart className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-3 font-semibold text-fg">You haven&apos;t asked yet</p>
          <p className="mt-1 text-sm text-fg-muted">
            Stuck on something? Post it and let campus help you out.
          </p>
        </div>
      ) : (
        <>
          {withResponses.length > 0 && (
            <Section
              icon={<Inbox className="h-4 w-4 text-aura" aria-hidden />}
              title="Responses received"
              hint="Approve a helper to open a chat, or pick the one who solved it."
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
              icon={<CheckCircle2 className="h-4 w-4 text-fg-muted" aria-hidden />}
              title="Resolved & history"
              rows={resolved}
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
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  rows: HelpRequestRow[];
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <span className="text-xs text-fg-muted">{rows.length}</span>
      </div>
      {hint && <p className="mb-2.5 text-xs text-fg-muted">{hint}</p>}
      <div className="space-y-3">
        {rows.map((req) => (
          <HelpCard key={req.id} req={req} />
        ))}
      </div>
    </section>
  );
}
