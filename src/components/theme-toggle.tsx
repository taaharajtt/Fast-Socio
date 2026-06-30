"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { SegmentedPills } from "@/components/ui";

const OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const emptySubscribe = () => () => {};

/** True only after client hydration; stable `false` on the server snapshot. */
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

/**
 * Appearance control for Settings (UI Spec §5.15): a segmented pill control,
 * not a plain switch, to match the design system's pill language.
 * Falls back to a stable "system" value before hydration to avoid mismatch.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <SegmentedPills
      options={OPTIONS}
      value={hydrated ? (theme ?? "system") : "system"}
      onChange={setTheme}
    />
  );
}
