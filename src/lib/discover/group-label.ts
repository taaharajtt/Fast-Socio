import { MODE_META, isPostMode } from "@/lib/smart-match/modes";

/**
 * Capsule text for a Discover team room — "Discover · FYP Teammate".
 *
 * Shared by the inbox row and the thread header so the two never drift, and
 * tolerant of an unknown/absent mode because `communities.discover_mode` is a
 * nullable text column rather than an enum.
 */
export function discoverGroupLabel(mode: string | null | undefined): string {
  return isPostMode(mode) ? `Discover · ${MODE_META[mode].label}` : "Discover";
}
