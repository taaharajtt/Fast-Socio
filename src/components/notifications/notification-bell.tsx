import { createClient } from "@/lib/supabase/server";
import { notificationView } from "@/lib/notifications/view";
import { timeAgo } from "@/lib/time";
import {
  NotificationBellMenu,
  type BellItem,
} from "./notification-bell-menu";

type NotifRow = {
  id: string;
  actor_id: string | null;
  type: string;
  data: Record<string, unknown>;
  group_count: number;
  read_at: string | null;
  created_at: string;
};

/**
 * Bell with an unread-count dot and an inline dropdown of recent notifications
 * (Figma prototype). Data is fetched server-side; the dropdown itself is a
 * client island so it can open/close without a round trip. The full feed remains
 * at /activity.
 */
export async function NotificationBell() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The bell is the Activity entry point, so it mirrors the panel: messages and
  // message requests are excluded here (they live in Chat, with their own dock
  // badge) and only surface as mobile push.
  const [{ count }, { data: rows }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .is("read_at", null)
      .not("type", "in", "(message,message_request)"),
    supabase
      .from("notifications")
      .select("id, actor_id, type, data, group_count, read_at, created_at")
      .eq("user_id", user!.id)
      .not("type", "in", "(message,message_request)")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const notifs = (rows as NotifRow[]) ?? [];
  const actorIds = [
    ...new Set(notifs.map((n) => n.actor_id).filter(Boolean) as string[]),
  ];
  const actors = new Map<string, { name: string | null; avatar: string | null }>();
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", actorIds);
    (profs ?? []).forEach((p) =>
      actors.set(p.id, { name: p.full_name, avatar: p.avatar_url })
    );
  }

  const items: BellItem[] = notifs.map((n) => {
    const actor = n.actor_id ? actors.get(n.actor_id) : undefined;
    const view = notificationView(
      n.type,
      actor?.name ?? null,
      n.data,
      n.group_count ?? 1
    );
    return {
      id: n.id,
      text: view.text,
      href: view.href,
      avatar: actor?.avatar ?? null,
      unread: !n.read_at,
      type: n.type,
      timeAgo: timeAgo(n.created_at),
    };
  });

  return <NotificationBellMenu unread={count ?? 0} items={items} />;
}
