"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X, Search, Check } from "lucide-react";
import { GlassInput } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CATEGORY_ORDER, CATEGORY_META } from "@/lib/help/constants";

export type SocioFilters = {
  category: string;
  department: string;
  semester: string;
  course: string;
  q: string;
};

/**
 * The SOCIO feed's single "Filters" control, pinned to the top-right under the
 * tab bar. A compact popover holds the type filter (All + the six categories)
 * plus optional precise fields — deliberately not a top-left row of chips. Every
 * change is written to the URL so the server component re-queries.
 *
 * `basePath` + `keep` keep the control host-agnostic: `keep` holds params that
 * must survive every push. Campus Help lives only at `/help` now, so `keep` is
 * empty there, but the plumbing stays so the shell can be hosted elsewhere
 * without divergence.
 */
export function HelpFilters({
  filters,
  basePath = "/help",
  keep = {},
}: {
  filters: SocioFilters;
  basePath?: string;
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Local state for the precise text fields (applied on submit).
  const [dept, setDept] = useState(filters.department);
  const [sem, setSem] = useState(filters.semester);
  const [course, setCourse] = useState(filters.course);
  const [q, setQ] = useState(filters.q);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function push(next: Partial<SocioFilters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    // Params that must survive every push (e.g. tab=help inside the profile).
    for (const [k, v] of Object.entries(keep)) if (v) params.set(k, v);
    // The SOCIO internal tab is the default (no tab/h param), so it's never set.
    if (merged.category) params.set("category", merged.category);
    if (merged.department) params.set("department", merged.department);
    if (merged.semester) params.set("semester", merged.semester);
    if (merged.course) params.set("course", merged.course);
    if (merged.q) params.set("q", merged.q);
    const qs = params.toString();
    start(() => router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false }));
  }

  function applyPrecise() {
    push({
      department: dept.trim(),
      semester: sem,
      course: course.trim(),
      q: q.trim(),
    });
    setOpen(false);
  }

  function clearAll() {
    setDept("");
    setSem("");
    setCourse("");
    setQ("");
    push({ category: "", department: "", semester: "", course: "", q: "" });
  }

  const activeCount = [
    filters.category,
    filters.department,
    filters.semester,
    filters.course,
    filters.q,
  ].filter(Boolean).length;

  return (
    <div className="relative flex justify-end" ref={panelRef}>
      <div className="flex items-center gap-2">
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-fg"
          >
            <X className="h-3 w-3" aria-hidden /> Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-glass-border bg-card px-3.5 py-2 text-sm font-medium transition-colors",
            activeCount > 0 ? "text-fg" : "text-fg-muted hover:text-fg"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters
          {activeCount > 0 && (
            <span className="gradient-brand rounded-full px-1.5 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div
          className={cn(
            "glass-strong absolute right-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-glass-border p-4 shadow-[0_16px_48px_rgba(0,0,0,0.4)]",
            pending && "opacity-70"
          )}
        >
          {/* Type filter: All + the six categories */}
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Type
          </p>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={!filters.category}
              onClick={() => push({ category: "" })}
              label="All"
            />
            {CATEGORY_ORDER.map((c) => {
              const Icon = CATEGORY_META[c].icon;
              return (
                <FilterChip
                  key={c}
                  active={filters.category === c}
                  onClick={() =>
                    push({ category: filters.category === c ? "" : c })
                  }
                  label={CATEGORY_META[c].short}
                  icon={<Icon className="h-3.5 w-3.5" aria-hidden />}
                />
              );
            })}
          </div>

          <div className="my-4 h-px bg-white/[0.06]" />

          {/* Precise fields */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            <GlassInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyPrecise()}
              placeholder="Search title or details"
              className="h-11 pl-9"
              aria-label="Search"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <GlassInput
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              placeholder="Department"
              className="h-11"
              aria-label="Department"
            />
            <GlassInput
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              placeholder="Course code"
              className="h-11"
              aria-label="Course code"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-fg-muted">Semester</span>
            {["1", "2", "3", "4", "5", "6", "7", "8"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSem(sem === s ? "" : s)}
                className={cn(
                  "h-8 w-8 rounded-full text-xs font-medium transition-colors",
                  sem === s ? "bg-aura text-white" : "bg-card text-fg-muted"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={applyPrecise}
            className="gradient-brand mt-4 w-full rounded-full py-2.5 text-sm font-semibold text-white active:scale-95"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-aura text-white" : "glass text-fg-muted hover:text-fg"
      )}
    >
      {active && !icon ? <Check className="h-3.5 w-3.5" aria-hidden /> : icon}
      {label}
    </button>
  );
}
