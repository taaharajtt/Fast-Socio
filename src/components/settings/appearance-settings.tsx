"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  APPEARANCE_KEYS,
  applyAppearance,
  type FontSize,
} from "@/lib/appearance";

/**
 * Font size / density / motion controls (Refactor Phase 8). Writes localStorage
 * and re-applies to <html> immediately — the theme (light/dark) toggle lives
 * separately via next-themes.
 */
type State = { font: FontSize; compact: boolean; reduced: boolean };

export function AppearanceSettings() {
  // Start at defaults for a stable SSR/first paint; sync the controls to the
  // already-applied stored values after mount (single object → one update).
  const [{ font, compact, reduced }, setState] = useState<State>({
    font: "normal",
    compact: false,
    reduced: false,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only sync from localStorage
    setState({
      font: (localStorage.getItem(APPEARANCE_KEYS.font) as FontSize) || "normal",
      compact: localStorage.getItem(APPEARANCE_KEYS.density) === "compact",
      reduced: localStorage.getItem(APPEARANCE_KEYS.motion) === "reduced",
    });
  }, []);

  function pickFont(f: FontSize) {
    setState((s) => ({ ...s, font: f }));
    localStorage.setItem(APPEARANCE_KEYS.font, f);
    applyAppearance();
  }
  function toggleCompact() {
    const next = !compact;
    setState((s) => ({ ...s, compact: next }));
    localStorage.setItem(APPEARANCE_KEYS.density, next ? "compact" : "comfortable");
    applyAppearance();
  }
  function toggleReduced() {
    const next = !reduced;
    setState((s) => ({ ...s, reduced: next }));
    localStorage.setItem(APPEARANCE_KEYS.motion, next ? "reduced" : "full");
    applyAppearance();
  }

  return (
    <div className="space-y-5">
      {/* A real segmented control: one recessed track, the selection raised out
          of it. It was three separate buttons where the chosen one turned solid
          purple, so "small / normal / large" read as three options plus one
          brand moment rather than as one control with three positions. */}
      <div className="flex items-center justify-between gap-4">
        <p className="type-body">Text size</p>
        <div className="flex shrink-0 gap-1 rounded-[10px] bg-input p-1">
          {(["small", "normal", "large"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={font === f}
              onClick={() => pickFont(f)}
              className={cn(
                "pressable focus-ring rounded-[7px] px-3 py-1.5 text-sm font-medium capitalize",
                font === f
                  ? "bg-surface-active text-fg"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <Row label="Compact mode" hint="Tighter spacing" on={compact} onClick={toggleCompact} />
      <Row
        label="Reduce motion"
        hint="Minimize animations"
        on={reduced}
        onClick={toggleReduced}
      />
    </div>
  );
}

function Row({
  label,
  hint,
  on,
  onClick,
}: {
  label: string;
  hint: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="type-body">{label}</span>
        <p className="type-caption text-fg-subtle">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onClick}
        className={cn(
          "pressable focus-ring relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors",
          on ? "bg-success" : "bg-fill-strong"
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white transition-all",
            on ? "left-[22px]" : "left-[2px]"
          )}
        />
      </button>
    </div>
  );
}
