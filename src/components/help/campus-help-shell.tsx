import { HandHeart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { HelpTabs } from "@/components/help/help-tabs";
import type { SocioFilters } from "@/components/help/help-filters";
import { HelpCard } from "@/components/help/help-card";
import { MyHelpPanel } from "@/components/help/my-help-panel";
import { compareSocio, type HelpUrgency } from "@/lib/help/logic";
import type { HelpTab } from "@/lib/help/constants";
import { HELP_REQUEST_COLUMNS, type HelpRequestRow } from "@/lib/help/types";
import { ilikeContains, orIlike } from "@/lib/postgrest/search";

/**
 * The complete Campus Help experience — the internal SOCIO | ME tabs, the SOCIO
 * public feed (urgent-boosted, unfiltered), and the ME personal area (ask /
 * manage / approve / history). It is its own product surface at `/help`,
 * discovered from the Home preview strip; it is intentionally chrome-free (the
 * page supplies its own header) and host-agnostic.
 *
 * `filters` is accepted (and defaulted) so callers built before the SOCIO
 * Filters control was removed keep compiling unchanged; SOCIO no longer reads
 * or exposes any filter UI.
 *
 * All navigation (SOCIO⇄ME) is URL-driven; the hosting page supplies the hrefs
 * (today `/help?tab=me`), so the shell carries no assumption about its route
 * and could be hosted elsewhere without divergence.
 */
export async function CampusHelpShell({
  helpTab,
  socioHref,
  meHref,
  filters = { category: "", department: "", semester: "", course: "", q: "" },
}: {
  helpTab: HelpTab;
  socioHref: string;
  meHref: string;
  filters?: SocioFilters;
}) {
  const supabase = await createClient();
  const content =
    helpTab === "me" ? (
      <MeSection supabase={supabase} />
    ) : (
      <SocioSection supabase={supabase} filters={filters} />
    );

  return (
    <HelpTabs active={helpTab} socioHref={socioHref} meHref={meHref}>
      {content}
    </HelpTabs>
  );
}

/**
 * SOCIO — the public help feed: other people's open asks, urgent boosted,
 * unfiltered. `filters` stays as a plumbing parameter (server-side query args
 * only) so `getSocioRequests`-shaped callers aren't forced to change; nothing
 * in this file renders a filter control anymore.
 */
async function SocioSection({
  supabase,
  filters = { category: "", department: "", semester: "", course: "", q: "" },
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  filters?: SocioFilters;
}) {
  const { category, department, semester, course, q } = filters;

  let query = supabase
    .from("help_request_feed")
    .select(HELP_REQUEST_COLUMNS)
    .eq("status", "open")
    .eq("is_mine", false);

  if (category) query = query.eq("category", category);
  if (semester) query = query.eq("semester", Number(semester));

  // Each helper returns null when the escaped term is empty, and the filter is
  // then skipped entirely. The previous inline version built `%%` in that case,
  // which is an ilike that matches every row — a filter the user asked for but
  // that silently did nothing.
  const departmentPattern = ilikeContains(department);
  if (departmentPattern) query = query.ilike("department", departmentPattern);

  const coursePattern = ilikeContains(course);
  if (coursePattern) query = query.ilike("course_code", coursePattern);

  const search = orIlike(["title", "body"], q);
  if (search) query = query.or(search);

  const { data } = await query
    .order("created_at", { ascending: false })
    .limit(60);

  // Urgent unresolved asks float to the top, then newest.
  const rows = [...((data ?? []) as unknown as HelpRequestRow[])].sort((a, b) =>
    compareSocio(
      { urgency: a.urgency as HelpUrgency, created_at: a.created_at },
      { urgency: b.urgency as HelpUrgency, created_at: b.created_at }
    )
  );

  return (
    <>
      {rows.length === 0 ? (
        <div className="glass rounded-[14px] px-5 py-10 text-center">
          <HandHeart className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-3 font-semibold text-fg">Nothing to help with yet</p>
          <p className="mt-1 text-sm text-fg-muted">
            When someone needs a hand it shows up here. Switch to ME to ask.
          </p>
        </div>
      ) : (
        <div>
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
    .select(HELP_REQUEST_COLUMNS)
    .eq("is_mine", true)
    .order("created_at", { ascending: false })
    .limit(100);

  return <MyHelpPanel rows={(data ?? []) as unknown as HelpRequestRow[]} />;
}
