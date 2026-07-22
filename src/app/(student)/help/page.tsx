import { HandHeart } from "lucide-react";
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
      <div className="mb-4 flex items-center gap-2.5">
        <span className="gradient-brand flex h-10 w-10 items-center justify-center rounded-[14px] shadow-[0_8px_24px_rgba(124,92,255,0.35)]">
          <HandHeart className="h-5 w-5 text-white" aria-hidden />
        </span>
        <div>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">
            Campus Help
          </h1>
          <p className="text-xs text-fg-muted">
            SOCIO helps me solve campus problems.
          </p>
        </div>
      </div>

      {/* Standalone route: internal SOCIO|ME uses `?tab=`, filters push to /help. */}
      <CampusHelpShell
        helpTab={helpTab}
        socioHref="/help"
        meHref="/help?tab=me"
        filters={filters}
        filterBasePath="/help"
        filterKeep={{}}
      />
    </main>
  );
}
