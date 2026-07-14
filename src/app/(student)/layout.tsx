import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { FloatingDock } from "@/components/floating-dock";
import { PushAutoEnable } from "@/components/push/push-auto-enable";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { PresenceHeartbeat } from "@/components/presence/heartbeat";
import { AnnouncementModal } from "@/components/notifications/announcement-modal";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { getMaintenanceState, resolveFlags } from "@/lib/flags";

/**
 * Shell for the logged-in student experience. Hosts the floating glass dock and
 * reserves bottom space so scrollable content clears it. All six primary
 * destinations live under this route group. New users who haven't finished
 * onboarding are sent through the profile wizard first.
 *
 * PERF: this layout runs on every navigation, so it must not stack round trips.
 * Auth is verified locally from the JWT (getAuthUserId), the gate queries run
 * in ONE parallel stage, session recording is deferred to after the response,
 * and the dock badges + announcements stream in behind Suspense instead of
 * blocking the page shell.
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) redirect("/login");

  // Everything the shell must know before it can render, in one parallel stage.
  const [{ data: profile }, maintenance, flags] = await Promise.all([
    supabase
      .from("profiles")
      .select("onboarding_completed, avatar_url, events_seen_at, admin_role")
      .eq("id", userId)
      .single(),
    getMaintenanceState(),
    resolveFlags(["discover", "events", "leaderboard"]),
  ]);

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const isAdmin = Boolean(profile.admin_role);

  // Maintenance gate (Refactor Phase 1). Admins keep operating during a window;
  // everyone else is parked on the interstitial until the flag is cleared.
  if (!isAdmin && maintenance.enabled) redirect("/maintenance");

  // Record/refresh this device's session row for Settings → Security (P8).
  // Deferred until after the response is sent — it must never block rendering.
  const userAgent = (await headers()).get("user-agent");
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const realIp = (await headers()).get("x-real-ip");
  after(async () => {
    await supabase
      .rpc("record_session", {
        p_user_agent: userAgent,
        p_ip: forwardedFor?.split(",")[0]?.trim() ?? realIp ?? null,
      })
      .then(
        () => {},
        () => {}
      );
  });

  const hiddenTabs = [
    !flags.discover && "/discover",
    !flags.events && "/events",
    !flags.leaderboard && "/leaderboard",
  ].filter((h): h is string => Boolean(h));

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
      {/* Browser-tab users: invite them to install. On iOS this is the only way
          they can ever receive push at all. Renders nothing once installed. */}
      <InstallPrompt />
      {/* Stamps last_seen_at while the tab is visible, so presence is real. */}
      <PresenceHeartbeat />
      {/* Badges + announcements stream in after the shell; the fallback dock is
          identical minus the counts, so nothing shifts when they arrive. */}
      <Suspense
        fallback={
          <FloatingDock
            badges={{}}
            avatarUrl={profile?.avatar_url}
            viewerId={userId}
            hiddenHrefs={hiddenTabs}
          />
        }
      >
        <DockWithBadges
          userId={userId}
          avatarUrl={profile?.avatar_url}
          eventsSeenAt={profile.events_seen_at}
          hiddenTabs={hiddenTabs}
        />
      </Suspense>
    </div>
  );
}

/**
 * Dock badges (UAT-013) + unread broadcast modal (UAT-012), fetched in parallel
 * and streamed after the page shell. RLS scopes every query to the caller.
 *   /chat   unread incoming messages + pending message requests
 *   /events approved, still-upcoming events published since the last visit
 */
async function DockWithBadges({
  userId,
  avatarUrl,
  eventsSeenAt,
  hiddenTabs,
}: {
  userId: string;
  avatarUrl?: string | null;
  eventsSeenAt: string | null;
  hiddenTabs: string[];
}) {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [
    { count: unreadMsgs },
    { count: pendingReqs },
    { count: newEvents },
    { data: announcements },
  ] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .neq("sender_id", userId)
      .is("read_at", null),
    supabase
      .from("message_requests")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .eq("status", "pending"),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .gt("starts_at", nowIso)
      // A user who has never opened /events sees every upcoming event as new.
      .gt("created_at", eventsSeenAt ?? "1970-01-01T00:00:00Z"),
    // UAT-012: broadcasts are delivered as a modal on a cold open, not as a row
    // buried in Activity. Unread = not yet dismissed.
    supabase
      .from("notifications")
      .select("id, data, created_at")
      .eq("user_id", userId)
      .eq("type", "announcement")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const chatBadge = (unreadMsgs ?? 0) + (pendingReqs ?? 0);

  return (
    <>
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
        avatarUrl={avatarUrl}
        viewerId={userId}
        hiddenHrefs={hiddenTabs}
      />
    </>
  );
}
