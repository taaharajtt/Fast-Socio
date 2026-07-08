import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import {
  notificationView,
  notificationActionPhrase,
  notificationCategory,
  SYSTEM_NOTIFICATION_TYPES,
} from "@/lib/notifications/view";
import {
  ActivityList,
  type ActivityItem,
} from "@/components/notifications/activity-list";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bucket an item by recency into Today / This Week / Earlier. */
function bucketOf(latestAt: string): ActivityItem["bucket"] {
  const age = Date.now() - new Date(latestAt).getTime();
  if (age < DAY_MS) return "Today";
  if (age < 7 * DAY_MS) return "This Week";
  return "Earlier";
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

  const { data: rows } = await supabase
    .from("notifications")
    .select("id, actor_id, type, data, read_at, created_at")
    .eq("user_id", me)
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

  // Mark everything read now that they've opened the panel.
  if (notifs.some((n) => !n.read_at)) await supabase.rpc("mark_notifications_read");

  // Flatten into serializable rows for the client filter/list.
  const items: ActivityItem[] = feed.map((item) => {
    const actor = item.actorId ? actors.get(item.actorId) : undefined;
    const latest = item.actions[0];
    return {
      key: item.key,
      category: notificationCategory(latest.type),
      type: latest.type,
      avatar: actor?.avatar ?? null,
      text: summarize(item, actor?.name ?? null),
      href: notificationView(latest.type, actor?.name ?? null, latest.data).href,
      unread: item.anyUnread,
      bucket: bucketOf(item.latestAt),
    };
  });

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/home"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight">Activity</h1>
      </div>

      {items.length === 0 ? (
        <GlassCard className="p-6 text-center">
          <p className="text-sm text-fg-muted">
            No activity yet. Reacts, replies, matches, and messages will show up
            here.
          </p>
        </GlassCard>
      ) : (
        <ActivityList items={items} />
      )}
    </main>
  );
}
