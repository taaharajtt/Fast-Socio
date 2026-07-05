import {
  Home,
  Compass,
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
 * Five-item bottom navigation (post-UAT restructure, CR-003/004/007):
 * Home, Discover, Chat, Leaderboard, Profile. Communities and Requests now live
 * as inner tabs of Chat; Events is reached from the Home feed. Leaderboard is a
 * top-level destination with Department Rivalry at the top of the page.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/profile", label: "Profile", icon: User },
];
