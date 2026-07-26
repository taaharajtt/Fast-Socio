import {
  Home,
  Compass,
  Users,
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
 * Six-item bottom navigation (UISpec V3 §2.1): Home · Discover · Ranks ·
 * Community · Chat · Me. "Ranks" is the Leaderboard route (weekly + department
 * rankings); "Me" is the profile. "Community" is the campus-life surface at
 * /events — upcoming events on top, campus societies below — and it also owns
 * the /communities and /societies routes (see ADOPTED_ROUTES). Chat is now just
 * Messages + Requests. Two features are reached without their own dock button:
 * the Campus Map (/map) from the Home header, and Campus Help from Me → Help
 * (the /help route still exists for deep links and lights the Me tab).
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
  { href: "/events", label: "Community", icon: Users },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/profile", label: "Me", icon: User },
];

/** Routes that light a tab they don't live under. */
const ADOPTED_ROUTES: Array<[prefix: string, tab: string]> = [
  ["/activity", "/home"], // reached from the Home header
  ["/post", "/home"],
  // The whole campus-life cluster lights the "Community" tab (which lives at
  // /events): the community directory, society pages, and the /community alias.
  ["/community", "/events"],
  ["/communities", "/events"],
  ["/societies", "/events"],
  ["/settings", "/profile"],
  ["/help", "/profile"], // Campus Help now lives at Me → Help
];

/**
 * Which dock tab should read as active for `pathname` (UAT-006/UAT-011).
 *
 * Two things a plain prefix match gets wrong:
 *   · Sub-pages of a section (a post, a community, settings) previously lit no
 *     tab at all, so the purple highlight vanished as soon as you drilled in.
 *   · `/profile/<id>` prefix-matched "/profile", so viewing someone ELSE's
 *     profile lit your own avatar. Another student's profile is a Discover
 *     destination; only your own id (or the bare /profile routes) is "Me".
 *
 * Returns the href of the owning NAV_ITEM, or null when nothing should light.
 */
export function activeNavHref(pathname: string, viewerId?: string): string | null {
  const profileMatch = /^\/profile\/([^/]+)$/.exec(pathname);
  if (profileMatch) {
    const segment = profileMatch[1];
    // /profile/edit and /profile/aura are your own pages, not a user id.
    if (segment === "edit" || segment === "aura") return "/profile";
    return segment === viewerId ? "/profile" : "/discover";
  }

  for (const [prefix, tab] of ADOPTED_ROUTES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return tab;
  }

  const item = NAV_ITEMS.find(
    (n) => pathname === n.href || pathname.startsWith(`${n.href}/`)
  );
  return item?.href ?? null;
}
