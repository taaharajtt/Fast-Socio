import {
  GraduationCap,
  Dumbbell,
  Palette,
  Cpu,
  HeartHandshake,
  Building2,
  Globe,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { SocietyCategory, SocietyRole } from "@/lib/societies/logic";

/** Display metadata for each society category (directory chips + profile). */
export const CATEGORY_META: Record<
  SocietyCategory,
  { label: string; icon: LucideIcon }
> = {
  academic: { label: "Academic", icon: GraduationCap },
  sports: { label: "Sports", icon: Dumbbell },
  arts: { label: "Arts", icon: Palette },
  tech: { label: "Tech", icon: Cpu },
  volunteer: { label: "Volunteer", icon: HeartHandshake },
  departmental: { label: "Departmental", icon: Building2 },
  cultural: { label: "Cultural", icon: Globe },
  religious: { label: "Religious", icon: Sparkles },
  other: { label: "Other", icon: Users },
};

/** Order categories appear in pickers and filter rows. */
export const CATEGORY_ORDER: SocietyCategory[] = [
  "academic",
  "tech",
  "arts",
  "sports",
  "volunteer",
  "departmental",
  "cultural",
  "religious",
  "other",
];

export function categoryLabel(c: string | null): string {
  if (!c) return "Society";
  return (CATEGORY_META as Record<string, { label: string }>)[c]?.label ?? "Society";
}

/** Human labels for the role hierarchy. */
export const ROLE_META: Record<SocietyRole, string> = {
  owner: "Owner",
  president: "President",
  vice_president: "Vice President",
  officer: "Officer",
  event_manager: "Event Manager",
  media: "Media",
  moderator: "Moderator",
  member: "Member",
};

export function roleLabel(role: string | null): string {
  if (!role) return "Member";
  return (ROLE_META as Record<string, string>)[role] ?? "Member";
}

/** Directory filter chips beyond category (status flags). */
export const DIRECTORY_FLAGS = [
  { key: "official", label: "Official" },
  { key: "recruiting", label: "Recruiting" },
] as const;
export type DirectoryFlag = (typeof DIRECTORY_FLAGS)[number]["key"];

/** Profile tabs → each is a real route under /societies/[id]. */
export const SOCIETY_TABS = [
  "overview",
  "events",
  "announcements",
  "members",
  "recruitment",
] as const;
export type SocietyTab = (typeof SOCIETY_TABS)[number];

export function isSocietyTab(v: string): v is SocietyTab {
  return (SOCIETY_TABS as readonly string[]).includes(v);
}
