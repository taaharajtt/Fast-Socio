"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Heart,
  MessageSquare,
  Star,
  Zap,
  Megaphone,
  UserPlus,
  TrendingUp,
  Trophy,
  Ticket,
  Clock,
  ShieldAlert,
  Gavel,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";

export type BellItem = {
  id: string;
  text: string;
  href: string;
  avatar: string | null;
  unread: boolean;
  type: string;
  timeAgo: string;
};

/** Small badge icon overlaid on the actor avatar, keyed by notification type. */
const TYPE_ICON: Record<string, LucideIcon> = {
  post_like: Heart,
  comment: MessageSquare,
  match: Star,
  message: MessageSquare,
  message_request: UserPlus,
  community_post_approved: Megaphone,
  community_post_rejected: Megaphone,
  community_approved: Megaphone,
  event_approved: Megaphone,
  level_up: TrendingUp,
  achievement: Trophy,
  waitlist_promoted: Ticket,
  event_reminder: Clock,
  moderation_warning: ShieldAlert,
  appeal_result: Gavel,
};

/**
 * Bell with an Instagram-style dropdown panel (Figma prototype). Shows the most
 * recent notifications inline; the full feed lives at /activity. Closes on
 * outside-click or Escape.
 */
export function NotificationBellMenu({
  unread,
  items,
}: {
  unread: number;
  items: BellItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Activity${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-90",
          open ? "gradient-brand text-white" : "glass text-fg-muted hover:text-fg"
        )}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {!open && unread > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warning ring-2 ring-bg" />
        )}
      </button>

      {open && (
        <div className="glass-strong absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-[var(--radius-md)] shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
          <div className="flex items-center justify-between border-b border-glass-border px-4 py-3">
            <h3 className="text-base font-bold">Activity</h3>
            {unread > 0 && (
              <span className="gradient-brand rounded-full px-2 py-0.5 text-[11px] font-semibold text-white">
                {unread} new
              </span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-fg-muted">
                You&apos;re all caught up 🎉
              </p>
            ) : (
              items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                return (
                  <Link
                    key={n.id}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex items-center gap-3 border-b border-glass-border/60 px-4 py-3 last:border-0",
                      n.unread && "bg-accent/[0.06]"
                    )}
                  >
                    {n.unread && (
                      <span className="absolute inset-y-3 left-0 w-0.5 rounded-full gradient-brand" />
                    )}
                    <div className="relative shrink-0">
                      <div className="glass relative h-9 w-9 overflow-hidden rounded-full">
                        {n.avatar ? (
                          <AppImage src={n.avatar} alt="" sizes="36px" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center gradient-brand">
                            <Zap className="h-4 w-4 text-white" aria-hidden />
                          </span>
                        )}
                      </div>
                      <span className="gradient-brand absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full">
                        <Icon className="h-2 w-2 text-white" aria-hidden />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-xs leading-snug text-fg">
                        {n.text}
                      </p>
                      <p className="mt-0.5 text-[10px] text-fg-muted">
                        {n.timeAgo}
                      </p>
                    </div>
                  </Link>
                );
              })
            )}
          </div>

          <Link
            href="/activity"
            onClick={() => setOpen(false)}
            className="block border-t border-glass-border py-3 text-center text-sm font-semibold text-accent"
          >
            See all activity
          </Link>
        </div>
      )}
    </div>
  );
}
