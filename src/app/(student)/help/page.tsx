import { ScreenHeader } from "@/components/ui";
import { CampusHelpShell } from "@/components/help/campus-help-shell";
import type { SocioFilters } from "@/components/help/help-filters";
import { isHelpCategory } from "@/lib/help/logic";
import { isHelpTab, DEFAULT_HELP_TAB } from "@/lib/help/constants";

export const metadata = { title: "Campus Help · FAST SOCIO" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const rawTab = one(sp.tab);
  const helpTab = isHelpTab(rawTab) ? rawTab : DEFAULT_HELP_TAB;

  const filters: SocioFilters = {
    category: isHelpCategory(one(sp.category)) ? one(sp.category) : "",
    department: one(sp.department),
    semester: one(sp.semester),
    course: one(sp.course),
    q: one(sp.q),
  };

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <ScreenHeader
        title="Campus Help"
        subtitle="Drop the Gatekeeping, help your Campus."
        className="mb-4"
      />

      {/* Standalone route: internal SOCIO|ME uses `?tab=`. SOCIO has no Filters
          control anymore, so `filters` only matters if a `?category=`-style
          param is hit directly; it's never set from the UI. */}
      <CampusHelpShell
        helpTab={helpTab}
        socioHref="/help"
        meHref="/help?tab=me"
        filters={filters}
      />
    </main>
  );
}
