import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { timeAgo } from "@/lib/time";
import {
  notificationView,
  notificationActionPhrase,
} from "@/lib/notifications/view";
import {
  ActivityList,
  type ActivityItem,
} from "@/components/notifications/activity-list";
import { AutoMarkRead } from "@/components/notifications/mark-all-read";

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
  group_count: number;
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

/**
 * One item per notification — no bundling. Notifications are never merged, not
 * even multiple from the same person (product decision): every like, comment,
 * and event is its own row. (The DB-side per-post collapse was removed in mig
 * 0077; this drops the former client-side same-actor hourly grouping.)
 */
function buildFeed(notifs: Notif[]): FeedItem[] {
  return notifs
    .map((n) => ({
      key: n.id,
      actorId: n.actor_id,
      actions: [n],
      latestAt: n.created_at,
      anyUnread: !n.read_at,
    }))
    .sort(
      (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
    );
}

function summarize(item: FeedItem, actorName: string | null): string {
  const who = actorName ?? "Someone";
  const actions = item.actions; // newest-first (source list is desc)
  if (actions.length === 1) {
    return notificationView(
      actions[0].type,
      actorName,
      actions[0].data,
      actions[0].group_count ?? 1
    ).text;
  }
  const first = notificationActionPhrase(actions[0].type);
  if (actions.length === 2) {
    return `${who} ${first} and ${notificationActionPhrase(actions[1].type)}`;
  }
  return `${who} ${first} and ${actions.length - 1} other activities`;
}

export default async function ActivityPage() {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip (layout already
  // gated this route; RLS scopes every query below).
  const me = (await getAuthUserId())!;

  // Messages and message requests live in Chat, not Activity — they only fire as
  // mobile push. Admin broadcasts (type 'announcement') are delivered as a
  // cold-open modal instead (UAT-012), so they're excluded here too.
  const { data: rows } = await supabase
    .from("notifications")
    .select("id, actor_id, type, data, group_count, read_at, created_at")
    .eq("user_id", me)
    .not("type", "in", "(message,message_request,announcement)")
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

  // Reads are cleared automatically on open (AutoMarkRead, below). The current
  // render still shows the unread highlights for THIS visit — the mark-read runs
  // client-side without revalidating — so nothing is missed, and next visit the
  // rows (and the bell badge) read as seen.

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
      </header>

      {/* Visiting the panel marks everything read automatically (no button). */}
      <AutoMarkRead />

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
