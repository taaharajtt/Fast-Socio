"use client";

import { cn } from "@/lib/utils";

export type PillOption = { value: string; label: string };

type SegmentedPillsProps = {
  options: PillOption[];
  value: string;
  onChange: (value: string) => void;
  /** Active fill color — Aura Purple (default) or Electric Cyan. */
  accent?: "aura" | "cyan";
  /** Horizontally scrollable row (Discover/Feed) vs. fixed segmented control. */
  scrollable?: boolean;
  className?: string;
};

/**
 * Shared pill-tab spec (UI Spec §10.1): glass background, active pill solid
 * Aura Purple / Electric Cyan fill, inactive pills outlined glass, 9999 radius,
 * 32–40px height. Used for For-You/filter tabs, community tabs, and the
 * appearance theme toggle.
 */
export function SegmentedPills({
  options,
  value,
  onChange,
  accent = "aura",
  scrollable = false,
  className,
}: SegmentedPillsProps) {
  const activeFill =
    accent === "aura" ? "bg-accent text-white" : "bg-verified text-white";

  return (
    <div
      role="tablist"
      className={cn(
        "flex gap-2",
        scrollable &&
          "overflow-x-auto no-scrollbar",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "pressable focus-ring h-9 shrink-0 rounded-[var(--radius-pill)] px-4",
              "text-sm font-semibold",
              active
                ? activeFill
                : "bg-fill font-medium text-fg-muted hover:text-fg"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
