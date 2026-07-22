import Link from "next/link";
import { HandHeart, ArrowRight } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_META } from "@/lib/help/constants";
import { compareSocio, isUrgentRequest, type HelpUrgency } from "@/lib/help/logic";
import type { HelpRequestRow } from "@/lib/help/types";

/**
 * A compact "Campus Help" strip for the Home feed: a few open requests (most
 * urgent first) so students discover the utility surface without it becoming the
 * feed. Renders nothing when there's nothing open to help with.
 */
export async function HomeHelpStrip() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("help_request_feed")
    .select(
      "id, title, category, urgency, status, response_count, is_mine, created_at"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(15);

  const rows = ((data ?? []) as HelpRequestRow[])
    .filter((r) => !r.is_mine)
    .sort((a, b) =>
      compareSocio(
        { urgency: a.urgency as HelpUrgency, created_at: a.created_at },
        { urgency: b.urgency as HelpUrgency, created_at: b.created_at }
      )
    )
    .slice(0, 6);

  if (rows.length === 0) return null;

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
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {rows.map((r) => {
          const cat = CATEGORY_META[r.category];
          const CatIcon = cat?.icon ?? HandHeart;
          return (
            <Link key={r.id} href={`/help/${r.id}`} className="shrink-0">
              <GlassCard className="flex w-44 flex-col p-3">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] text-fg-muted">
                    <CatIcon className="h-3.5 w-3.5" aria-hidden />
                    {cat?.short ?? r.category}
                  </span>
                  {isUrgentRequest(r.urgency as HelpUrgency) && (
                    <GlassChip tone="error" className="ml-auto py-0.5">
                      Urgent
                    </GlassChip>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold">{r.title}</p>
                <p className="mt-1 text-[11px] text-fg-muted">
                  {r.response_count} response{r.response_count === 1 ? "" : "s"}
                </p>
              </GlassCard>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
