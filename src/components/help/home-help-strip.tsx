import Link from "next/link";
import { HandHeart, ArrowRight, Zap, MessageSquare } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_META } from "@/lib/help/constants";
import { isUrgentRequest, type HelpUrgency } from "@/lib/help/logic";
import { pickHelpPreview } from "@/lib/help/preview";
import type { HelpRequestRow } from "@/lib/help/types";

/**
 * The Home "Campus Help" preview strip — a discovery teaser for the full Campus
 * Help product at /help. Shows a couple of open asks (urgent first, then newest)
 * so students find the utility surface without it becoming a feed category. When
 * nothing is open it renders a compact placeholder card (never a blank strip) so
 * the surface stays discoverable with a direct "Ask for help" entry point.
 *
 * Privacy: reads the anonymity-masked help_request_feed view (author identity is
 * already null for anonymous asks the viewer can't see) and never renders any
 * author here anyway — the card shows only category/title/preview/count. Blocks,
 * bans and reports are enforced by the view's RLS, same as the SOCIO feed.
 */
export async function HomeHelpStrip() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("help_request_feed")
    .select(
      "id, title, body, category, urgency, status, response_count, is_mine, created_at"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(15);

  const rows = pickHelpPreview((data ?? []) as HelpRequestRow[], 3);

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg-muted">
          <HandHeart className="h-4 w-4 text-aura" aria-hidden />
          Campus Help
        </h2>
        <Link href="/help" className="flex items-center gap-0.5 text-xs text-aura">
          See all <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {rows.length === 0 ? (
        <HelpStripEmpty />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rows.map((r) => {
            const cat = CATEGORY_META[r.category];
            const CatIcon = cat?.icon ?? HandHeart;
            const urgent = isUrgentRequest(r.urgency as HelpUrgency);
            return (
              <Link key={r.id} href={`/help/${r.id}`} className="shrink-0">
                <GlassCard className="flex h-full w-48 flex-col p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center gap-1 text-[11px] text-fg-muted">
                      <CatIcon className="h-3.5 w-3.5" aria-hidden />
                      {cat?.short ?? r.category}
                    </span>
                    {urgent && (
                      <span className="ml-auto flex items-center gap-1 rounded-full bg-error px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        <Zap className="h-2.5 w-2.5" aria-hidden /> Urgent
                      </span>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-semibold">
                    {r.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-fg-muted">
                    {r.body}
                  </p>
                  {r.is_mine && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-fg-muted">
                      <MessageSquare className="h-3 w-3" aria-hidden />
                      {r.response_count} response{r.response_count === 1 ? "" : "s"}
                    </p>
                  )}
                </GlassCard>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Placeholder shown when there are no open asks — a compact, single card that
 * states the surface's purpose and drops the student straight into asking. Kept
 * visually consistent with the strip cards (same glass card + icon language).
 */
function HelpStripEmpty() {
  return (
    <GlassCard className="flex items-center gap-3 p-3">
      <span className="gradient-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] shadow-[0_8px_24px_rgba(124,92,255,0.3)]">
        <HandHeart className="h-5 w-5 text-white" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-fg-muted">
          Ask for notes, advice, lost items, sports, events, or quick campus help.
        </p>
      </div>
      <Link
        href="/help?tab=me"
        className="gradient-brand shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold text-white active:scale-95"
      >
        Ask for help
      </Link>
    </GlassCard>
  );
}
