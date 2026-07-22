import {
  GraduationCap,
  MessageCircleQuestion,
  HandHeart,
  Dumbbell,
  PartyPopper,
  PackageSearch,
  type LucideIcon,
} from "lucide-react";
import type { HelpCategory, HelpUrgency, HelpStatus } from "./logic";

/** Display metadata for the six help categories (UI only; values live in logic). */
export const CATEGORY_META: Record<
  HelpCategory,
  { label: string; short: string; icon: LucideIcon; blurb: string }
> = {
  academic: {
    label: "Academic",
    short: "Academic",
    icon: GraduationCap,
    blurb: "Concepts, assignments, notes, exam prep",
  },
  advice: {
    label: "Advice",
    short: "Advice",
    icon: MessageCircleQuestion,
    blurb: "Guidance on courses, campus life, decisions",
  },
  help: {
    label: "Help",
    short: "Help",
    icon: HandHeart,
    blurb: "A hand with anything else on campus",
  },
  sports: {
    label: "Sports",
    short: "Sports",
    icon: Dumbbell,
    blurb: "Teammates, matches, gym, practice",
  },
  events: {
    label: "Events",
    short: "Events",
    icon: PartyPopper,
    blurb: "Society tasks, volunteers, event help",
  },
  lost_found: {
    label: "Lost & Found",
    short: "Lost & Found",
    icon: PackageSearch,
    blurb: "Lost something, or found someone's thing",
  },
};

/** Stable render order for chips and menus. */
export const CATEGORY_ORDER = Object.keys(CATEGORY_META) as HelpCategory[];

type ChipTone = "neutral" | "aura" | "cyan" | "success" | "warning" | "error";

export const URGENCY_META: Record<
  HelpUrgency,
  { label: string; tone: ChipTone }
> = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "cyan" },
  urgent: { label: "Urgent", tone: "error" },
};

export const STATUS_META: Record<HelpStatus, { label: string; tone: ChipTone }> = {
  open: { label: "Open", tone: "success" },
  resolved: { label: "Resolved", tone: "neutral" },
};

/**
 * The two Help tabs, styled like the Ranks page (SOCIO = the public help feed,
 * default; ME = your own asks, responses, and history).
 */
export const HELP_TABS = [
  { key: "socio", label: "SOCIO" },
  { key: "me", label: "ME" },
] as const;

export type HelpTab = (typeof HELP_TABS)[number]["key"];
export const DEFAULT_HELP_TAB: HelpTab = "socio";

export function isHelpTab(v: unknown): v is HelpTab {
  return HELP_TABS.some((t) => t.key === v);
}

export function categoryLabel(v: string): string {
  return (CATEGORY_META as Record<string, { label: string }>)[v]?.label ?? v;
}
