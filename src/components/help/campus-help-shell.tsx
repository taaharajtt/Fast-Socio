import { HandHeart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { HelpTabs } from "@/components/help/help-tabs";
import { HelpFilters, type SocioFilters } from "@/components/help/help-filters";
import { HelpCard } from "@/components/help/help-card";
import { MyHelpPanel } from "@/components/help/my-help-panel";
import { compareSocio, type HelpUrgency } from "@/lib/help/logic";
import type { HelpTab } from "@/lib/help/constants";
import type { HelpRequestRow } from "@/lib/help/types";

/** Neutralize characters that would break PostgREST's or()/ilike grammar. */
function safeLike(input: string): string {
  return input.replace(/[,()*%\\]/g, " ").trim();
}

/**
 * The complete Campus Help experience — the internal SOCIO | ME tabs, the SOCIO
 * public feed (urgent-boosted) with its top-right Filters, and the ME personal
 * area (ask / manage / approve / history). It is intentionally chrome-free (no
 * page title) so it can be mounted BOTH as the standalone `/help` route and
 * embedded inside Profile → Help without divergence.
 *
 * All navigation (SOCIO⇄ME, filters) is URL-driven; the hosting page supplies
 * the hrefs + filter target so the same shell works under either route's param
 * scheme (`/help?tab=me` vs `/profile?tab=help&h=me`).
 */
export async function CampusHelpShell({
  helpTab,
  socioHref,
  meHref,
  filters,
  filterBasePath,
  filterKeep,
}: {
  helpTab: HelpTab;
  socioHref: string;
  meHref: string;
  filters: SocioFilters;
  filterBasePath: string;
  filterKeep: Record<string, string>;
}) {
  const supabase = await createClient();

  return (
    <div>
      <HelpTabs active={helpTab} socioHref={socioHref} meHref={meHref} />
      {helpTab === "me" ? (
        <MeSection supabase={supabase} />
      ) : (
        <SocioSection
          supabase={supabase}
          filters={filters}
          filterBasePath={filterBasePath}
          filterKeep={filterKeep}
        />
      )}
    </div>
  );
}

/** SOCIO — the public help feed: other people's open asks, urgent boosted. */
async function SocioSection({
  supabase,
  filters,
  filterBasePath,
  filterKeep,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  filters: SocioFilters;
  filterBasePath: string;
  filterKeep: Record<string, string>;
}) {
  const { category, department, semester, course, q } = filters;

  let query = supabase
    .from("help_request_feed")
    .select("*")
    .eq("status", "open")
    .eq("is_mine", false);

  if (category) query = query.eq("category", category);
  if (department) query = query.ilike("department", `%${safeLike(department)}%`);
  if (semester) query = query.eq("semester", Number(semester));
  if (course) query = query.ilike("course_code", `%${safeLike(course)}%`);
  if (q) {
    const s = safeLike(q);
    if (s) query = query.or(`title.ilike.%${s}%,body.ilike.%${s}%`);
  }

  const { data } = await query
    .order("created_at", { ascending: false })
    .limit(60);

  // Urgent unresolved asks float to the top, then newest.
  const rows = [...((data ?? []) as HelpRequestRow[])].sort((a, b) =>
    compareSocio(
      { urgency: a.urgency as HelpUrgency, created_at: a.created_at },
      { urgency: b.urgency as HelpUrgency, created_at: b.created_at }
    )
  );

  return (
    <>
      <div className="-mt-1 mb-4">
        <HelpFilters filters={filters} basePath={filterBasePath} keep={filterKeep} />
      </div>

      {rows.length === 0 ? (
        <div className="glass rounded-[14px] px-5 py-10 text-center">
          <HandHeart className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-3 font-semibold text-fg">Nothing to help with yet</p>
          <p className="mt-1 text-sm text-fg-muted">
            When someone needs a hand it shows up here. Switch to ME to ask.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((req) => (
            <HelpCard key={req.id} req={req} />
          ))}
        </div>
      )}
    </>
  );
}

/** ME — your own asks, responses received, and history. */
async function MeSection({
  supabase,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data } = await supabase
    .from("help_request_feed")
    .select("*")
    .eq("is_mine", true)
    .order("created_at", { ascending: false })
    .limit(100);

  return <MyHelpPanel rows={(data ?? []) as HelpRequestRow[]} />;
}
