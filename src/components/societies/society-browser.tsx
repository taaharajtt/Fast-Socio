"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { SocietyCard } from "@/components/societies/society-card";
import { CATEGORY_ORDER, CATEGORY_META } from "@/lib/societies/constants";
import type { SocietyCategory } from "@/lib/societies/logic";
import type { SocietyCardVM } from "@/lib/societies/types";

type Flag = "all" | "official" | "recruiting" | "following";

const FLAGS: { key: Flag; label: string }[] = [
  { key: "all", label: "All" },
  { key: "official", label: "Official" },
  { key: "recruiting", label: "Recruiting" },
  { key: "following", label: "Following" },
];

export function SocietyBrowser({ societies }: { societies: SocietyCardVM[] }) {
  const [query, setQuery] = useState("");
  const [flag, setFlag] = useState<Flag>("all");
  const [category, setCategory] = useState<SocietyCategory | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return societies.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q) &&
          !(s.description?.toLowerCase().includes(q) ?? false)) return false;
      if (flag === "official" && !s.isOfficial) return false;
      if (flag === "recruiting" && !s.isRecruiting) return false;
      if (flag === "following" && !s.isFollowing) return false;
      if (category && s.category !== category) return false;
      return true;
    });
  }, [societies, query, flag, category]);

  return (
    <>
      <div className="relative mt-4">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fg-muted"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search societies…"
          aria-label="Search societies"
          className="h-12 w-full rounded-xl bg-card pl-11 pr-4 text-[15px] text-fg placeholder:text-fg-disabled outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {/* Status flags */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FLAGS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFlag(f.key)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
              flag === f.key ? "gradient-brand text-white" : "bg-card text-fg-muted"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Category chips */}
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORY_ORDER.map((c) => {
          const Icon = CATEGORY_META[c].icon;
          const active = category === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(active ? null : c)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                active ? "bg-accent text-white" : "bg-card text-fg-muted"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {CATEGORY_META[c].label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-2.5">
        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-muted">
            No societies match your filters.
          </p>
        ) : (
          visible.map((s) => <SocietyCard key={s.id} s={s} />)
        )}
      </div>
    </>
  );
}
