import Link from "next/link";
import {
  Heart,
  MessageSquare,
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
  HandHelping,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { AuraIcon } from "@/components/ui/aura-icon";
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

/** Badge icon overlaid on the actor avatar (or shown in the neutral circle for
 *  actor-less system notifications). Keyed by notification type — it covers
 *  exactly ACTIVITY_VISIBLE_TYPES, the only types this list can receive. */
const TYPE_ICON: Record<string, LucideIcon> = {
  // Reacts
  post_like: Heart,
  comment_like: Heart,
  // Comments and replies
  comment: MessageSquare,
  comment_reply: MessageSquare,
  mention: AtSign,
  // Matches and Discover — the bolt is the mark match/discover uses everywhere.
  match: Zap,
  match_post: ImageIcon,
  matching_request: UserPlus,
  matching_accepted: Zap,
  smart_match_application: UserPlus,
  smart_match_accepted: Zap,
  smart_match_mention: AtSign,
  // Events
  event_approved: Megaphone,
  event_rejected: Megaphone,
  event_organizer_added: Megaphone,
  event_organizer_removed: Megaphone,
  event_reminder: Clock,
  waitlist_promoted: Ticket,
  // Campus Help
  help_response: HandHelping,
  help_offer_accepted: HandHelping,
  help_follow: HandHelping,
  help_thanked: HandHelping,
  help_resolved: HandHelping,
  // Aura and badges
  level_up: Zap,
  achievement: Award,
  aura_adjusted: Zap,
  leaderboard_top_finish: Award,
  // Moderation and appeals
  content_moderated: ShieldAlert,
  moderation_warning: ShieldAlert,
  appeal_result: Gavel,
};

/** Notification types shown with the special gold Aura icon (no actor). */
const AURA_TYPES = new Set([
  "level_up",
  "aura_adjusted",
  "leaderboard_top_finish",
]);

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
            <p className="type-label mb-2 mt-8 px-1 text-fg-subtle">
              {section.label}
            </p>
            {section.items.length === 0 && isEarlier ? (
              <p className="py-8 text-center text-[15px] text-fg-muted">
                You&apos;re all caught up! 🎉
              </p>
            ) : (
              <div>
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
      className="pressable-subtle focus-ring -mx-2 flex items-center gap-3 rounded-[10px] px-2 py-3.5"
    >
      {/*
        The notification's kind is a quiet annotation on the actor's face, not a
        second coloured object. Every row used to carry a filled purple disc —
        a full 44px one when there was no actor — so a screenful of notices was
        a column of purple dots and the avatars, which are the actual content,
        came second. The glyph now sits on a neutral fill; Aura keeps gold
        because that colour IS the Aura identity, not decoration.
      */}
      <div className="relative shrink-0">
        {noActor ? (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-fill">
            {isAura ? (
              <AuraIcon className="h-5 w-5" />
            ) : (
              <Icon className="h-5 w-5 text-fg-muted" aria-hidden />
            )}
          </div>
        ) : (
          <>
            <div className="relative h-11 w-11 overflow-hidden rounded-full bg-card">
              {item.avatar && <AppImage src={item.avatar} alt="" sizes="44px" />}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface-active ring-2 ring-bg">
              <Icon className="h-2.5 w-2.5 text-fg-muted" aria-hidden />
            </span>
          </>
        )}
      </div>
      {/*
        The timestamp moved from under the sentence to the end of the row.
        Stacked, it doubled every row's height and put a second baseline under
        text the eye had already finished; right-aligned, all the times form one
        scannable column and the sentence gets the full width it needs
        (apple.md 16: hierarchy through order and alignment).
      */}
      <div className="min-w-0 flex-1">
        <p className="type-callout leading-snug">
          {rest !== null ? (
            <>
              <span className="font-semibold text-fg">{item.actorName}</span>
              <span className="text-fg-muted">{rest}</span>
            </>
          ) : (
            <span className="text-fg">{item.text}</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.unread && (
          <span
            className="h-2 w-2 rounded-full bg-accent"
            aria-label="Unread"
          />
        )}
        <span className="type-caption text-fg-muted">{item.timeAgo}</span>
      </div>
    </Link>
  );
}
