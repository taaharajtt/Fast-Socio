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
    accent === "aura"
      ? "gradient-brand text-white shadow-[0_4px_16px_rgba(200,80,192,0.4)]"
      : "bg-cyan text-[#001318] shadow-[0_4px_16px_rgba(0,212,255,0.35)]";

  return (
    <div
      role="tablist"
      className={cn(
        "flex gap-2",
        scrollable
          ? "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "glass rounded-[var(--radius-pill)] p-1",
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
              "h-9 shrink-0 rounded-[var(--radius-pill)] px-4 text-sm font-medium " +
                "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
              active
                ? activeFill
                : scrollable
                  ? "glass text-fg-muted hover:text-fg"
                  : "text-fg-muted hover:text-fg"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
