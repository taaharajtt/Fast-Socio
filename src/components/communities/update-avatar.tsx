import {
  AtSign,
  Bell,
  CalendarClock,
  ClipboardCheck,
  Heart,
  Megaphone,
  MessageCircle,
  MessageSquare,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";

/**
 * The avatar for one Updates row: a large circle with a small circular
 * category badge notched into its lower-right corner.
 *
 * WHY THE BADGE IS A SIBLING OF THE CLIPPED CIRCLE, not a child: the avatar
 * uses `overflow-hidden` to keep a non-square photo circular, and anything
 * inside that box gets cut off at the arc. The same mistake the profile
 * verified tick made once (see `ProfileVerifiedTick`), fixed the same way.
 *
 * The badge carries the app's page background as its ring, so it reads as
 * punched out of the avatar rather than floating on top of it.
 */

/** What kind of thing happened — drives the glyph and its accent. */
type Category =
  | "broadcast"
  | "message"
  | "like"
  | "comment"
  | "mention"
  | "join"
  | "moderation"
  | "event"
  | "role"
  | "other";

const CATEGORY_BY_TYPE: Record<string, Category> = {
  society_announcement: "broadcast",
  community_message: "message",
  event_message: "message",
  message: "message",
  message_request: "message",
  message_request_accepted: "message",
  post_like: "like",
  comment_like: "like",
  message_reaction: "like",
  comment: "comment",
  comment_reply: "comment",
  community_post: "comment",
  mention: "mention",
  community_join_request: "join",
  community_join_approved: "join",
  community_join_rejected: "join",
  community_post_review: "moderation",
  community_post_approved: "moderation",
  community_post_rejected: "moderation",
  community_approved: "moderation",
  community_rejected: "moderation",
  event_post_request: "moderation",
  event_approved: "event",
  event_rejected: "event",
  event_updated: "event",
  event_reminder: "event",
  waitlist_promoted: "event",
  event_organizer_added: "role",
  event_organizer_removed: "role",
  society_role: "role",
  society_role_removed: "role",
};

/** Glyph + accent per category. Colours come from tokens, never hex. */
const CATEGORY_STYLE: Record<Category, { icon: LucideIcon; tone: string }> = {
  broadcast: { icon: Megaphone, tone: "text-warning" },
  message: { icon: MessageCircle, tone: "text-accent-light" },
  like: { icon: Heart, tone: "text-error" },
  comment: { icon: MessageSquare, tone: "text-accent-light" },
  mention: { icon: AtSign, tone: "text-accent-light" },
  join: { icon: UserPlus, tone: "text-success" },
  moderation: { icon: ClipboardCheck, tone: "text-verified" },
  event: { icon: CalendarClock, tone: "text-warning" },
  role: { icon: ShieldCheck, tone: "text-verified" },
  other: { icon: Bell, tone: "text-fg-muted" },
};

export function updateCategory(type: string): Category {
  return CATEGORY_BY_TYPE[type] ?? "other";
}

export function UpdateAvatar({
  src,
  alt,
  type,
  className,
}: {
  src: string | null;
  /** Empty for a decorative avatar — the row's text is the accessible label. */
  alt: string;
  type: string;
  className?: string;
}) {
  const category = updateCategory(type);
  const { icon: Icon, tone } = CATEGORY_STYLE[category];

  return (
    <span className={cn("relative block h-14 w-14 shrink-0", className)}>
      {/* The clipped circle. `relative` is load-bearing: AppImage renders with
          `fill`, so it positions against the nearest positioned ancestor —
          without it the photo escapes this box and renders square. */}
      <span className="relative block h-full w-full overflow-hidden rounded-full bg-surface-active">
        {src ? (
          <AppImage src={src} alt={alt} sizes="56px" />
        ) : (
          // Fallback: never a square, never an empty hole.
          <span
            aria-hidden
            className="flex h-full w-full items-center justify-center text-fg-disabled"
          >
            <Bell className="h-6 w-6" />
          </span>
        )}
      </span>
      <span
        aria-hidden
        className="absolute -bottom-0.5 -right-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[3px] border-bg bg-card"
      >
        <Icon className={cn("h-3 w-3", tone)} />
      </span>
    </span>
  );
}
