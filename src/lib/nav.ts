import {
  Home,
  Compass,
  CalendarDays,
  MessageCircle,
  Trophy,
  User,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Six-item bottom navigation (UISpec V3 §2.1): Home · Discover · Ranks · Events ·
 * Chat · Me. "Ranks" is the Leaderboard route (weekly + department rankings);
 * "Me" is the profile. Communities and Requests live as inner tabs of Chat.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/profile", label: "Me", icon: User },
];
