import {
  Sparkles,
  Heart,
  FolderKanban,
  GraduationCap,
  Code2,
  Dumbbell,
  Megaphone,
  HandHeart,
  type LucideIcon,
} from "lucide-react";
import { POST_MODES, type DiscoverMode, type PostMode } from "@/lib/smart-match/modes";

// ---------------------------------------------------------------------------
// Discover filters. These are FILTERS over one unified feed, never tabs: they
// narrow the same list of connection cards in place and never navigate. "For
// You" is the default and shows every kind, ranked by the personalized score.
//
// A filter maps to the set of card kinds it admits, so the same mapping drives
// both the client-side narrowing and the `p_modes` argument of the
// get_unified_discover_feed RPC when we need to top up from the server.
// ---------------------------------------------------------------------------
export const DISCOVER_FILTERS = [
  "for_you",
  "socio",
  "teams",
  "fyp",
  "hackathons",
  "sports",
  "recruitment",
  "contributors",
] as const;

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number];

export const DEFAULT_DISCOVER_FILTER: DiscoverFilter = "for_you";

export function isDiscoverFilter(x: unknown): x is DiscoverFilter {
  return typeof x === "string" && (DISCOVER_FILTERS as readonly string[]).includes(x);
}

/** Chip metadata, in the order the chip row renders them. */
export const FILTER_META: Record<
  DiscoverFilter,
  { label: string; icon: LucideIcon }
> = {
  for_you: { label: "For You", icon: Sparkles },
  socio: { label: "SOCIO", icon: Heart },
  teams: { label: "Teams", icon: FolderKanban },
  fyp: { label: "FYP", icon: GraduationCap },
  hackathons: { label: "Hackathons", icon: Code2 },
  sports: { label: "Sports", icon: Dumbbell },
  recruitment: { label: "Recruitment", icon: Megaphone },
  contributors: { label: "Contributors", icon: HandHeart },
};

const FILTER_KINDS: Record<DiscoverFilter, readonly DiscoverMode[]> = {
  for_you: ["socio", ...POST_MODES],
  socio: ["socio"],
  teams: ["project_partner"],
  fyp: ["fyp_teammate"],
  hackathons: ["hackathon_team"],
  sports: ["sports"],
  recruitment: ["recruitment"],
  contributors: ["contributor"],
};

/** The card kinds a filter admits. "For You" admits everything. */
export function filterKinds(filter: DiscoverFilter): DiscoverMode[] {
  return [...FILTER_KINDS[filter]];
}

/** Just the post kinds — what the feed RPC's `p_modes` argument takes. */
export function filterPostModes(filter: DiscoverFilter): PostMode[] {
  return filterKinds(filter).filter((k): k is PostMode => k !== "socio");
}

/** Whether SOCIO profile cards belong in this filter's feed. */
export function filterIncludesSocio(filter: DiscoverFilter): boolean {
  return filterKinds(filter).includes("socio");
}

/** True when a card of `kind` should be visible under `filter`. */
export function matchesFilter(filter: DiscoverFilter, kind: DiscoverMode): boolean {
  return filterKinds(filter).includes(kind);
}
