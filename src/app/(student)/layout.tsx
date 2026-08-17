import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { FloatingDock } from "@/components/floating-dock";
import { PushAutoEnable } from "@/components/push/push-auto-enable";
import { PresenceHeartbeat } from "@/components/presence/heartbeat";
import { DockRealtime } from "@/components/chat/dock-realtime";
import { AnnouncementModal } from "@/components/notifications/announcement-modal";
import { ExternalLinkInterceptor } from "@/components/ui/external-link-interceptor";
import { RouteFallback } from "@/components/ui/route-fallback";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { getMaintenanceState, resolveFlags } from "@/lib/flags";
import { timed } from "@/lib/perf";
import { resolveAvatarUrl } from "@/lib/avatar";

/**
 * Shell for the logged-in student experience. Hosts the bottom dock and reserves
 * space so scrollable content clears it. All six primary destinations live under
 * this route group.
 *
 * PERF — this layout is deliberately NOT async. Under Cache Components every
 * segment is prerendered into a static shell and the request-scoped parts stream
 * in behind their Suspense boundaries. The moment this function awaits anything
 * (a profile row, a feature flag, the session cookie) that shell collapses and
 * every dock tap has to wait on a server round trip before ANY pixel changes.
 * So the layout itself renders only markup that is identical for every student —
 * the ambient glow, the children slot, the client islands, and a fully working
 * dock — and hands all user-specific work to <StudentShell/> below.
 *
 * Correctness is unaffected. Auth, the ban gate and the onboarding gate all run
 * in the proxy/middleware BEFORE this ever renders, and RLS remains the
 * authority on every query. The redirects kept in StudentShell are
 * defence-in-depth, not the primary boundary.
 */
export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      {/* Every student route is request-scoped, so the page segment always
          suspends. This boundary is what lets the shell above it (glow, dock,
          client islands) prerender and paint on its own. Routes with their own
          loading.tsx nest a closer boundary and keep using it; this fallback
          only catches the ones that don't have one. */}
      {/* The shell is the ONE place the top inset is paid back and the ONE
          place dock clearance is reserved, so no page needs its own
          safe-area logic. min-h-[100dvh] makes short pages fill the dynamic
          viewport so there is no dead zone under the content. */}
      <div className="flex min-h-[100dvh] flex-1 flex-col pt-[var(--safe-top)] pb-[var(--shell-pb)]">
        <Suspense fallback={<RouteFallback />}>{children}</Suspense>
      </div>
      {/* Global click-delegation guard: warns before any off-origin link in a
          post, comment, chat, help response, or profile bio is followed. */}
      <ExternalLinkInterceptor />
      {/* Enable push notifications by default for signed-in students. */}
      <PushAutoEnable />
      {/* Stamps last_seen_at while the tab is visible, so presence is real. */}
      <PresenceHeartbeat />
      {/* The fallback is a REAL dock — every tab is present, labelled and
          navigable — so it ships in the static shell and is interactive before
          a single query resolves. What streams in on top is only the enrichment:
          unread counts, the viewer's dp on the Me tab, and the viewer id that
          tells your own /profile/<id> apart from someone else's. */}
      <Suspense fallback={<FloatingDock />}>
        <StudentShell />
      </Suspense>
    </div>
  );
}

/**
 * Everything about the shell that depends on WHO is asking. Streams in after the
 * static shell has painted, so none of it delays a navigation.
 *
 * One parallel stage covers the gate data plus the three counts that don't
 * depend on it; the events badge needs `events_seen_at` from the profile row, so
 * it follows in a second, single-query stage. Both are off the critical path.
 */
async function StudentShell() {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  // Middleware has already bounced anonymous requests; this is belt-and-braces
  // for a session that expires between the proxy hop and this render.
  if (!userId) redirect("/login");

  const [
    { data: profile },
    maintenance,
    flags,
    { count: unreadMsgs },
    { count: pendingReqs },
    { data: announcements },
  ] = await timed("layout:shell", () =>
    Promise.all([
    supabase
      .from("profiles")
      .select("avatar_url, gender, events_seen_at, admin_role")
      .eq("id", userId)
      .single(),
    getMaintenanceState(),
    resolveFlags(["discover", "events", "leaderboard"]),
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
    ])
  );

  const isAdmin = Boolean(profile?.admin_role);

  // Maintenance gate (Refactor Phase 1). Admins keep operating during a window;
  // everyone else is parked on the interstitial until the flag is cleared.
  if (!isAdmin && maintenance.enabled) redirect("/maintenance");

  // Record/refresh this device's session row for Settings → Security (P8).
  // Deferred until after the response is sent — it must never block rendering.
  const headerList = await headers();
  const userAgent = headerList.get("user-agent");
  const forwardedFor = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");
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

  // Approved, still-upcoming events published since the last /events visit. A
  // user who has never opened /events sees every upcoming event as new.
  const { count: newEvents } = await timed("layout:eventsBadge", () =>
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .gt("starts_at", new Date().toISOString())
      .gt("created_at", profile?.events_seen_at ?? "1970-01-01T00:00:00Z")
  );

  // Feature-flagged destinations are dropped from the dock entirely. The
  // fallback dock above shows all six, so a tab whose flag is OFF is briefly
  // visible before this render removes it — the flags fail open and are dark-
  // launch switches, so in the normal all-on case nothing moves at all.
  const hiddenTabs = [
    !flags.discover && "/discover",
    !flags.events && "/events",
    !flags.leaderboard && "/leaderboard",
  ].filter((h): h is string => Boolean(h));

  const chatBadge = (unreadMsgs ?? 0) + (pendingReqs ?? 0);

  return (
    <>
      {/* Keeps the dock's chat badge (unread DMs + pending requests) live on
          every student screen, not just after a navigation. */}
      <DockRealtime userId={userId} initialBadge={chatBadge} />
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
        avatarUrl={resolveAvatarUrl(profile?.avatar_url, profile?.gender)}
        viewerId={userId}
        hiddenHrefs={hiddenTabs}
      />
    </>
  );
}
