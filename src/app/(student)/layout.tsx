import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { FloatingDock } from "@/components/floating-dock";
import { PushAutoEnable } from "@/components/push/push-auto-enable";
import { PresenceHeartbeat } from "@/components/presence/heartbeat";
import { AnnouncementModal } from "@/components/notifications/announcement-modal";
import { createClient } from "@/lib/supabase/server";
import { getMaintenanceState, resolveFlags } from "@/lib/flags";

/**
 * Shell for the logged-in student experience. Hosts the floating glass dock and
 * reserves bottom space so scrollable content clears it. All six primary
 * destinations live under this route group. New users who haven't finished
 * onboarding are sent through the profile wizard first.
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, avatar_url, events_seen_at, admin_role")
    .eq("id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const isAdmin = Boolean(profile.admin_role);

  // Maintenance gate (Refactor Phase 1). Admins keep operating during a window;
  // everyone else is parked on the interstitial until the flag is cleared.
  if (!isAdmin) {
    const { enabled: maintenance } = await getMaintenanceState();
    if (maintenance) redirect("/maintenance");
  }

  // Record/refresh this device's session row for Settings → Security (P8).
  // Fire-and-forget: a failure here must never block rendering the app.
  const hdrs = await headers();
  await supabase
    .rpc("record_session", {
      p_user_agent: hdrs.get("user-agent"),
      p_ip:
        hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        hdrs.get("x-real-ip") ??
        null,
    })
    .then(
      () => {},
      () => {}
    );

  // Feature flags gate the primary destinations without a redeploy.
  const flags = await resolveFlags(["discover", "events", "leaderboard"]);
  const hiddenTabs = [
    !flags.discover && "/discover",
    !flags.events && "/events",
    !flags.leaderboard && "/leaderboard",
  ].filter((h): h is string => Boolean(h));

  const nowIso = new Date().toISOString();

  // Dock badges (UAT-013). RLS scopes messages to the caller's own conversations.
  //   /chat   unread incoming messages + pending message requests
  //   /events approved, still-upcoming events published since the last visit
  const [
    { count: unreadMsgs },
    { count: pendingReqs },
    { count: newEvents },
    { data: announcements },
  ] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .neq("sender_id", user.id)
      .is("read_at", null),
    supabase
      .from("message_requests")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .eq("status", "pending"),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .gt("starts_at", nowIso)
      // A user who has never opened /events sees every upcoming event as new.
      .gt("created_at", profile.events_seen_at ?? "1970-01-01T00:00:00Z"),
    // UAT-012: broadcasts are delivered as a modal on a cold open, not as a row
    // buried in Activity. Unread = not yet dismissed.
    supabase
      .from("notifications")
      .select("id, data, created_at")
      .eq("user_id", user.id)
      .eq("type", "announcement")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const chatBadge = (unreadMsgs ?? 0) + (pendingReqs ?? 0);

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      {/* Ambient brand glow shared across student screens */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(40rem 30rem at 15% -10%, rgba(124,92,255,0.22), transparent), radial-gradient(35rem 25rem at 95% 5%, rgba(200,80,192,0.18), transparent)",
        }}
      />
      <div className="flex-1 pb-20">{children}</div>
      {/* Enable push notifications by default for signed-in students. */}
      <PushAutoEnable />
      {/* Stamps last_seen_at while the tab is visible, so presence is real. */}
      <PresenceHeartbeat />
      <AnnouncementModal
        announcements={(announcements ?? []).map((a) => ({
          id: a.id as string,
          title: String(
            (a.data as Record<string, unknown>)?.title ?? "FAST SOCIO"
          ),
          body: String((a.data as Record<string, unknown>)?.body ?? ""),
          url: ((a.data as Record<string, unknown>)?.url as string) ?? null,
        }))}
      />
      <FloatingDock
        badges={{ "/chat": chatBadge, "/events": newEvents ?? 0 }}
        avatarUrl={profile?.avatar_url}
        viewerId={user.id}
        hiddenHrefs={hiddenTabs}
      />
    </div>
  );
}
