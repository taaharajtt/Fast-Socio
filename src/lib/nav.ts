import {
  Home,
  Compass,
  Users,
  CalendarDays,
  MessageCircle,
  User,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Fixed six-item bottom navigation (UI Spec §4): Home, Discover, Communities,
 * Events, Chat, Profile. Order and count are fixed by the spec.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/communities", label: "Communities", icon: Users },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/profile", label: "Profile", icon: User },
];
