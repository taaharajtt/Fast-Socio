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
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm">Text size</p>
        <div className="flex gap-2">
          {(["small", "normal", "large"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={font === f}
              onClick={() => pickFont(f)}
              className={cn(
                "flex-1 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium capitalize transition-all",
                font === f ? "gradient-brand text-white" : "bg-card text-fg-muted"
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
        <span className="text-sm">{label}</span>
        <p className="text-xs text-fg-muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onClick}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-aura" : "bg-glass-strong"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
            on ? "left-[22px]" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}
