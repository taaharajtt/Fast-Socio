"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Heart,
  MessageSquare,
  Star,
  Zap,
  Megaphone,
  UserPlus,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { GlassCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import {
  ACTIVITY_CATEGORY_LABEL,
  type ActivityCategory,
} from "@/lib/notifications/view";

/** Serializable, pre-rendered activity row handed down from the server. */
export type ActivityItem = {
  key: string;
  category: ActivityCategory;
  /** Latest action type in the group — drives the badge icon. */
  type: string;
  avatar: string | null;
  text: string;
  href: string;
  unread: boolean;
  bucket: "Today" | "This Week" | "Earlier";
};

/** Badge icon overlaid on the actor avatar, keyed by notification type. */
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
};

const BUCKET_ORDER = ["Today", "This Week", "Earlier"] as const;

/**
 * Filter chip order — only chips with matching items are shown. Messages and
 * requests are intentionally absent: they belong to Chat, not Activity.
 */
const CATEGORY_ORDER: ActivityCategory[] = [
  "reacts",
  "replies",
  "matches",
  "announcements",
];

/**
 * The Activity panel body (UAT-002). Renders category filter chips over a
 * time-bucketed list. Filtering is client-side so switching categories is
 * instant; the data itself is fetched + grouped on the server.
 */
export function ActivityList({ items }: { items: ActivityItem[] }) {
  const [filter, setFilter] = useState<ActivityCategory | "all">("all");

  // Only offer chips for categories that actually have items.
  const present = useMemo(() => {
    const set = new Set(items.map((i) => i.category));
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [items]);

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.category === filter)),
    [items, filter]
  );

  const sections = BUCKET_ORDER.map((label) => ({
    label,
    items: visible.filter((i) => i.bucket === label),
  })).filter((s) => s.items.length > 0);

  return (
    <>
      {present.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
          {present.map((c) => (
            <Chip
              key={c}
              active={filter === c}
              onClick={() => setFilter(c)}
            >
              {ACTIVITY_CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
      )}

      {sections.length === 0 ? (
        <GlassCard className="p-6 text-center">
          <p className="text-sm text-fg-muted">Nothing here yet.</p>
        </GlassCard>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.label}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-fg-muted">
                {section.label}
              </p>
              <div className="space-y-2">
                {section.items.map((item) => {
                  const Icon = TYPE_ICON[item.type] ?? Bell;
                  return (
                    <Link key={item.key} href={item.href} className="block">
                      <GlassCard
                        className={cn(
                          "flex items-center gap-3 p-3",
                          item.unread && "border-l-2 border-l-accent"
                        )}
                      >
                        <div className="relative shrink-0">
                          <div className="glass relative h-10 w-10 overflow-hidden rounded-full">
                            {item.avatar ? (
                              <AppImage src={item.avatar} alt="" sizes="40px" />
                            ) : (
                              <span className="gradient-brand flex h-full w-full items-center justify-center">
                                <Zap className="h-4 w-4 text-white" aria-hidden />
                              </span>
                            )}
                          </div>
                          <span className="gradient-brand absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full">
                            <Icon className="h-2 w-2 text-white" aria-hidden />
                          </span>
                        </div>
                        <p className="flex-1 text-sm">{item.text}</p>
                      </GlassCard>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors active:scale-95",
        active
          ? "gradient-brand text-white"
          : "glass text-fg-muted hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}
