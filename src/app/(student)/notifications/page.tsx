import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { notificationView } from "@/lib/notifications/view";

type Notif = {
  id: string;
  actor_id: string | null;
  type: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

function bucket(iso: string): "Today" | "This week" | "Earlier" {
  const d = new Date(iso).getTime();
  const now = Date.now();
  if (now - d < 24 * 3600 * 1000) return "Today";
  if (now - d < 7 * 24 * 3600 * 1000) return "This week";
  return "Earlier";
}

export default async function NotificationsPage() {
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
    .limit(60);
  const notifs = (rows as Notif[]) ?? [];

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

  // Mark everything read now that they've opened the feed.
  await supabase.rpc("mark_notifications_read");

  const groups: Record<string, Notif[]> = { Today: [], "This week": [], Earlier: [] };
  for (const n of notifs) groups[bucket(n.created_at)].push(n);

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
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
      </div>

      {notifs.length === 0 ? (
        <GlassCard className="p-6 text-center">
          <p className="text-sm text-fg-muted">
            No notifications yet. Matches, likes, and messages will show up here.
          </p>
        </GlassCard>
      ) : (
        (["Today", "This week", "Earlier"] as const).map((label) =>
          groups[label].length === 0 ? null : (
            <section key={label} className="mb-5">
              <h2 className="mb-2 text-sm font-medium text-fg-muted">{label}</h2>
              <div className="space-y-2">
                {groups[label].map((n) => {
                  const actor = n.actor_id ? actors.get(n.actor_id) : undefined;
                  const v = notificationView(n.type, actor?.name ?? null, n.data);
                  return (
                    <Link key={n.id} href={v.href} className="block">
                      <GlassCard
                        className={cn(
                          "flex items-center gap-3 p-3",
                          !n.read_at && "border-l-2 border-l-aura"
                        )}
                      >
                        <div className="glass h-10 w-10 shrink-0 overflow-hidden rounded-full">
                          {actor?.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={actor.avatar}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <p className="flex-1 text-sm">{v.text}</p>
                      </GlassCard>
                    </Link>
                  );
                })}
              </div>
            </section>
          )
        )
      )}
    </main>
  );
}
