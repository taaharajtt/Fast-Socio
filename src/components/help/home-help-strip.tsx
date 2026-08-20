import Link from "next/link";
import { HandHeart, Zap, MessageSquare } from "lucide-react";
import { GlassCard, SectionHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_META } from "@/lib/help/constants";
import { isUrgentRequest, type HelpUrgency } from "@/lib/help/logic";
import { pickHelpPreview } from "@/lib/help/preview";
import type { HelpRequestRow } from "@/lib/help/types";

/**
 * The Home "Campus Help" preview strip — a discovery teaser for the full Campus
 * Help product at /help. Shows a few open asks (urgent first, then newest) so
 * students find the utility surface without it becoming a feed category.
 *
 * Asks are SQUARE tiles on a horizontal rail rather than one wide banner. A
 * banner presents a single ask as though it were the section, which is the
 * wrong claim — Campus Help is a place with many open asks, and a rail says
 * that just by existing. The square is what makes it browsable: at 168px two
 * tiles fit on a 390px screen with the third visibly cut off, so the row reads
 * as scrollable without a chevron or a hint (apple.md §16 — the
 * layout should mean something).
 *
 * Every tile is the same size whether one ask is open or six, so the section
 * never changes shape as the campus does. The EMPTY state is the deliberate
 * exception: it is a wide card, because a square holding one line of invitation
 * copy is a square holding mostly nothing.
 *
 * Privacy: reads the anonymity-masked help_request_feed view (author identity is
 * already null for anonymous asks the viewer can't see) and never renders any
 * author here anyway — the tile shows only category/title/preview/count. Blocks,
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

  const rows = pickHelpPreview((data ?? []) as HelpRequestRow[], 6);

  return (
    <section className="mt-4">
      <SectionHeader
        title="Campus Help"
        action={{ label: "See all", href: "/help" }}
      />

      {rows.length === 0 ? (
        <HelpStripEmpty />
      ) : (
        // Full-bleed rail: the negative margin cancels the feed's gutter so
        // tiles scroll off the true screen edge rather than stopping short of
        // it, while `scroll-px-4` keeps snapped tiles aligned to that gutter.
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 scroll-px-4">
          {rows.map((r) => {
            const cat = CATEGORY_META[r.category];
            const CatIcon = cat?.icon ?? HandHeart;
            const urgent = isUrgentRequest(r.urgency as HelpUrgency);
            return (
              <Link
                key={r.id}
                href={`/help/${r.id}`}
                className="pressable-subtle focus-ring w-[168px] shrink-0 snap-start rounded-[14px]"
              >
                <GlassCard className="flex aspect-square flex-col p-3.5">
                  <div className="flex items-start gap-1.5">
                    <span className="type-caption flex min-w-0 items-center gap-1.5 text-fg-muted">
                      <CatIcon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">
                        {cat?.short ?? r.category}
                      </span>
                    </span>
                    {urgent && (
                      // Red, not gold: this bolt means time pressure, which is
                      // a different idea from the Aura bolt everywhere else.
                      <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-error px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        <Zap className="h-2.5 w-2.5" aria-hidden /> Urgent
                      </span>
                    )}
                  </div>

                  {/* The title carries the tile; the body is context under it.
                      Both are clamped so a long ask can never change the tile's
                      height and break the row. */}
                  <p className="type-callout mt-2 line-clamp-3 font-semibold leading-snug">
                    {r.title}
                  </p>
                  <p className="type-caption mt-1 line-clamp-2 text-fg-muted">
                    {r.body}
                  </p>

                  {r.is_mine && (
                    <p className="type-caption mt-auto flex items-center gap-1.5 pt-1 text-fg-muted">
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                      {r.response_count}
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
 * Shown when there are no open asks. Deliberately NOT square: there is one
 * sentence to say and one action to offer, and a square built around that
 * would be a box with a hole in it. A wide card states the surface's purpose
 * and drops the student straight into asking.
 */
function HelpStripEmpty() {
  return (
    <GlassCard className="flex items-center gap-3 p-3.5">
      <HandHeart className="h-7 w-7 shrink-0 text-fg-muted" strokeWidth={1.5} aria-hidden />
      <p className="min-w-0 flex-1 type-caption leading-snug text-fg-muted">
        Ask for notes, advice, lost items, sports, events, or quick campus help.
      </p>
      {/* An outlined accent pill, not a filled one: this is an invitation on a
          discovery strip, not the primary action of the screen. */}
      <Link
        href="/help?tab=me"
        className="pressable focus-ring shrink-0 rounded-full border border-accent/60 px-3.5 py-2 type-caption font-semibold text-accent"
      >
        Ask for help
      </Link>
    </GlassCard>
  );
}
