"use client";

import { cn } from "@/lib/utils";
import {
  DISCOVER_FILTERS,
  FILTER_META,
  type DiscoverFilter,
} from "@/lib/discover/filters";

/**
 * The Discover filter row. These are FILTERS, not tabs — pressing one narrows
 * the same feed in place and never navigates, so the active state flips on the
 * same frame as the tap. Horizontally scrollable so all eight fit the mobile
 * column. `counts` (optional) shows how many cards each chip currently holds.
 */
export function DiscoverFilterChips({
  active,
  counts,
  onChange,
}: {
  active: DiscoverFilter;
  counts?: Partial<Record<DiscoverFilter, number>>;
  onChange: (filter: DiscoverFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter Discover"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {DISCOVER_FILTERS.map((filter) => {
        const { label, icon: Icon } = FILTER_META[filter];
        const isActive = filter === active;
        const count = counts?.[filter];
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(filter)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors",
              isActive
                ? "bg-accent text-white"
                : "glass text-fg-muted hover:text-fg"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
            {!isActive && count != null && count > 0 && (
              <span className="text-[11px] font-medium opacity-70">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
