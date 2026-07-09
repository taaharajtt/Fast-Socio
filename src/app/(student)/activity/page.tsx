import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/time";
import {
  notificationView,
  notificationActionPhrase,
  SYSTEM_NOTIFICATION_TYPES,
} from "@/lib/notifications/view";
import {
  ActivityList,
  type ActivityItem,
} from "@/components/notifications/activity-list";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bucket an item into Today / Earlier (UISpec V3 Screen 4 sections). */
function bucketOf(latestAt: string): ActivityItem["bucket"] {
  const age = Date.now() - new Date(latestAt).getTime();
  return age < DAY_MS ? "Today" : "Earlier";
}

type Notif = {
  id: string;
  actor_id: string | null;
  type: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

type Actor = { name: string | null; avatar: string | null };

type FeedItem = {
  key: string;
  actorId: string | null;
  actions: Notif[];
  latestAt: string;
  anyUnread: boolean;
};

const GROUP_WINDOW_MS = 60 * 60 * 1000; // bundle same-sender actions within 1h

/**
 * Bundle consecutive notifications from the same actor that occur within an hour
 * into one item (CR-013). System notifications (matches, approvals) are never
 * grouped — each is its own item.
 */
function buildFeed(notifs: Notif[]): FeedItem[] {
  const items: FeedItem[] = [];
  const open = new Map<string, FeedItem>();

  for (const n of notifs) {
    const groupable = n.actor_id && !SYSTEM_NOTIFICATION_TYPES.has(n.type);
    if (!groupable) {
      items.push({
        key: n.id,
        actorId: n.actor_id,
        actions: [n],
        latestAt: n.created_at,
        anyUnread: !n.read_at,
      });
      continue;
    }
    const actor = n.actor_id as string;
    const g = open.get(actor);
    const withinWindow =
      g &&
      new Date(g.latestAt).getTime() - new Date(n.created_at).getTime() <=
        GROUP_WINDOW_MS;
    if (g && withinWindow) {
      g.actions.push(n);
      g.anyUnread = g.anyUnread || !n.read_at;
    } else {
      const item: FeedItem = {
        key: `${actor}:${n.id}`,
        actorId: actor,
        actions: [n],
        latestAt: n.created_at,
        anyUnread: !n.read_at,
      };
      open.set(actor, item);
      items.push(item);
    }
  }

  return items.sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
  );
}

function summarize(item: FeedItem, actorName: string | null): string {
  const who = actorName ?? "Someone";
  const actions = item.actions; // newest-first (source list is desc)
  if (actions.length === 1) {
    return notificationView(actions[0].type, actorName, actions[0].data).text;
  }
  const first = notificationActionPhrase(actions[0].type);
  if (actions.length === 2) {
    return `${who} ${first} and ${notificationActionPhrase(actions[1].type)}`;
  }
  return `${who} ${first} and ${actions.length - 1} other activities`;
}

export default async function ActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  // Messages and message requests live in Chat, not Activity — they only fire
  // as mobile push. Everything else (reacts, replies, matches, announcements)
  // shows here.
  const { data: rows } = await supabase
    .from("notifications")
    .select("id, actor_id, type, data, read_at, created_at")
    .eq("user_id", me)
    .not("type", "in", "(message,message_request)")
    .order("created_at", { ascending: false })
    .limit(80);
  const notifs = (rows as Notif[]) ?? [];

  const actorIds = [
    ...new Set(notifs.map((n) => n.actor_id).filter(Boolean) as string[]),
  ];
  const actors = new Map<string, Actor>();
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", actorIds);
    (profs ?? []).forEach((p) =>
      actors.set(p.id, { name: p.full_name, avatar: p.avatar_url })
    );
  }

  const feed = buildFeed(notifs);
  const unreadCount = notifs.filter((n) => !n.read_at).length;

  // NB: reads are no longer cleared on open (UISpec V3) — the unread purple
  // borders persist until the user taps "Mark all read".

  // Flatten into serializable rows for the list.
  const items: ActivityItem[] = feed.map((item) => {
    const actor = item.actorId ? actors.get(item.actorId) : undefined;
    const latest = item.actions[0];
    return {
      key: item.key,
      type: latest.type,
      actorName: actor?.name ?? null,
      avatar: actor?.avatar ?? null,
      text: summarize(item, actor?.name ?? null),
      href: notificationView(latest.type, actor?.name ?? null, latest.data).href,
      unread: item.anyUnread,
      timeAgo: `${timeAgo(item.latestAt)} ago`,
      bucket: bucketOf(item.latestAt),
    };
  });

  return (
    <main className="mx-auto w-full max-w-md px-4 py-4">
      {/* Header (UISpec V3 Screen 4): back · title · Mark all read. */}
      <header className="mb-2 flex items-center gap-3">
        <Link
          href="/home"
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </Link>
        <h1 className="flex-1 text-[22px] font-bold tracking-tight">
          Notifications
        </h1>
        {unreadCount > 0 && <MarkAllReadButton />}
      </header>

      {items.length === 0 ? (
        <p className="py-16 text-center text-[15px] text-fg-muted">
          You&apos;re all caught up! 🎉
        </p>
      ) : (
        <ActivityList items={items} />
      )}
    </main>
  );
}
