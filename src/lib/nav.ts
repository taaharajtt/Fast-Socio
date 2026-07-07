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
 * Six-item bottom navigation: Home, Discover, Events, Chat, Leaderboard, Profile.
 * Events is a top-level destination (restored to the dock alongside the Home-feed
 * "Upcoming events" strip). Communities and Requests live as inner tabs of Chat;
 * Leaderboard carries Department Rivalry at the top of its page.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/profile", label: "Profile", icon: User },
];
