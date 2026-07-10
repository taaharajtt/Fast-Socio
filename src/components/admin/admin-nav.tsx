"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Flag,
  Users,
  Boxes,
  CalendarDays,
  ScrollText,
  MessageSquareWarning,
  Megaphone,
  Zap,
  Heart,
  Database,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { AdminRole } from "@/lib/admin/access";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: string;
  super?: boolean;
};

/** Console sections. `match` is the pathname prefix that marks a link active;
 *  `super` items are hidden from moderators. */
const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, match: "/admin" },
  { href: "/admin/content", label: "Content", icon: MessageSquareWarning, match: "/admin/content" },
  { href: "/admin/reports?type=profile", label: "Reports", icon: Flag, match: "/admin/reports" },
  { href: "/admin/users", label: "Users", icon: Users, match: "/admin/users" },
  { href: "/admin/communities", label: "Communities", icon: Boxes, match: "/admin/communities" },
  { href: "/admin/events", label: "Events", icon: CalendarDays, match: "/admin/events" },
  { href: "/admin/aura", label: "Aura", icon: Zap, match: "/admin/aura", super: true },
  { href: "/admin/matching", label: "Matching", icon: Heart, match: "/admin/matching", super: true },
  { href: "/admin/broadcast", label: "Broadcast", icon: Megaphone, match: "/admin/broadcast", super: true },
  { href: "/admin/database", label: "Database", icon: Database, match: "/admin/database", super: true },
  { href: "/admin/sql", label: "SQL console", icon: Terminal, match: "/admin/sql", super: true },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, match: "/admin/audit" },
];

function useActive() {
  const pathname = usePathname();
  return (match: string) =>
    match === "/admin" ? pathname === "/admin" : pathname.startsWith(match);
}

export function AdminSidebar({ isSuper, role }: { isSuper: boolean; role: AdminRole }) {
  const isActive = useActive();
  const items = NAV.filter((n) => !n.super || isSuper);
  return (
    <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-glass-border bg-bg md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-glass-border px-4">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fg">
          Socio
        </span>
        <span className="rounded-[3px] border border-glass-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-muted">
          {role === "super_admin" ? "super" : "mod"}
        </span>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {items.map(({ href, label, icon: Icon, match }) => {
          const active = isActive(match);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-[3px] px-2.5 py-2 text-sm transition-colors ${
                active
                  ? "bg-card font-medium text-fg"
                  : "text-fg-muted hover:bg-card/50 hover:text-fg"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-glass-border p-2">
        <Link
          href="/home"
          className="flex items-center gap-2.5 rounded-[3px] px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-card/50 hover:text-fg"
        >
          Exit console →
        </Link>
      </div>
    </aside>
  );
}

export function AdminTopbar({ isSuper }: { isSuper: boolean }) {
  const isActive = useActive();
  const items = NAV.filter((n) => !n.super || isSuper);
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b border-glass-border bg-bg px-3 py-2 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
      <span className="mr-1 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-fg">
        Socio·admin
      </span>
      {items.map(({ href, label, match }) => {
        const active = isActive(match);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-[3px] px-2.5 py-1 text-xs transition-colors ${
              active ? "bg-card font-medium text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {label}
          </Link>
        );
      })}
      <Link
        href="/home"
        className="ml-auto shrink-0 pl-2 text-xs text-fg-muted hover:text-fg"
      >
        Exit
      </Link>
    </div>
  );
}
