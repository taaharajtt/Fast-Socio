import Link from "next/link";
import {
  Heart,
  MessageSquare,
  Star,
  Zap,
  Megaphone,
  UserPlus,
  Bell,
  AtSign,
  Clock,
  Ticket,
  Award,
  ShieldAlert,
  Gavel,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";

/** Serializable, pre-rendered activity row handed down from the server. */
export type ActivityItem = {
  key: string;
  /** Latest action type in the group — drives the badge icon + aura styling. */
  type: string;
  /** Actor's name, rendered bold ahead of the action text. Null for system
   *  notifications (e.g. an Aura milestone), which have no actor avatar. */
  actorName: string | null;
  avatar: string | null;
  text: string;
  href: string;
  unread: boolean;
  timeAgo: string;
  bucket: "Today" | "Earlier";
};

/** Badge icon overlaid on the actor avatar (or shown in the solid-purple
 *  circle for actor-less system notifications), keyed by notification type. */
const TYPE_ICON: Record<string, LucideIcon> = {
  post_like: Heart,
  comment: MessageSquare,
  mention: AtSign,
  match: Star,
  match_post: ImageIcon,
  message: MessageSquare,
  message_request: UserPlus,
  community_post_approved: Megaphone,
  community_post_rejected: Megaphone,
  community_approved: Megaphone,
  event_approved: Megaphone,
  event_reminder: Clock,
  waitlist_promoted: Ticket,
  level_up: Zap,
  achievement: Award,
  moderation_warning: ShieldAlert,
  appeal_result: Gavel,
};

/** Notification types shown with the special solid-purple Aura icon (no actor). */
const AURA_TYPES = new Set(["aura", "aura_milestone", "level_up"]);

const BUCKET_ORDER = ["Today", "Earlier"] as const;

/**
 * The Notifications full-screen body (UISpec V3 Screen 4). Time-bucketed rows
 * (TODAY / EARLIER) rendered flat with hairline dividers — the actor avatar
 * carries a small type badge, while actor-less system notifications (e.g. an
 * event reminder) show a solid-purple circle with the matching icon. When
 * there's nothing in EARLIER, the caught-up message takes its place.
 */
export function ActivityList({ items }: { items: ActivityItem[] }) {
  const sections = BUCKET_ORDER.map((label) => ({
    label,
    items: items.filter((i) => i.bucket === label),
  }));

  return (
    <div>
      {sections.map((section) => {
        const isEarlier = section.label === "Earlier";
        // Skip an empty TODAY section, but always render EARLIER so its
        // caught-up empty state can show beneath the label.
        if (section.items.length === 0 && !isEarlier) return null;
        return (
          <section key={section.label}>
            <p className="mb-1 mt-5 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-disabled">
              {section.label}
            </p>
            {section.items.length === 0 && isEarlier ? (
              <p className="py-8 text-center text-[15px] text-fg-muted">
                You&apos;re all caught up! 🎉
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {section.items.map((item) => (
                  <ActivityRow key={item.key} item={item} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const isAura = AURA_TYPES.has(item.type);
  // Actor-less system notifications (no avatar, no name) get the solid-purple
  // circle treatment instead of an avatar + badge.
  const noActor = !item.avatar && !item.actorName;
  const Icon = TYPE_ICON[item.type] ?? Bell;

  // Bold the actor name ahead of the muted action text where we can.
  const rest =
    item.actorName && item.text.startsWith(item.actorName)
      ? item.text.slice(item.actorName.length)
      : null;

  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 py-3.5 transition-transform active:scale-[0.99]"
    >
      <div className="relative shrink-0">
        {noActor ? (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent">
            {isAura ? (
              <Zap className="h-5 w-5 text-white" aria-hidden />
            ) : (
              <Icon className="h-5 w-5 text-white" aria-hidden />
            )}
          </div>
        ) : (
          <>
            <div className="relative h-11 w-11 overflow-hidden rounded-full bg-card">
              {item.avatar && <AppImage src={item.avatar} alt="" sizes="44px" />}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent ring-2 ring-bg">
              <Icon className="h-2.5 w-2.5 text-white" aria-hidden />
            </span>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug">
          {rest !== null ? (
            <>
              <span className="font-semibold text-fg">{item.actorName}</span>
              <span className="text-fg-muted">{rest}</span>
            </>
          ) : (
            <span className="text-fg">{item.text}</span>
          )}
        </p>
        <p className="mt-1 text-xs text-fg-disabled">{item.timeAgo}</p>
      </div>
      {item.unread && (
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-accent"
          aria-label="Unread"
        />
      )}
    </Link>
  );
}
