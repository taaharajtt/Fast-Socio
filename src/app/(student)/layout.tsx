import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { FloatingDock } from "@/components/floating-dock";
import { PushAutoEnable } from "@/components/push/push-auto-enable";
import { PresenceHeartbeat } from "@/components/presence/heartbeat";
import { DockRealtime } from "@/components/chat/dock-realtime";
import { InboxRealtime } from "@/components/chat/inbox-realtime";
import { AnnouncementModal } from "@/components/notifications/announcement-modal";
import { ExternalLinkInterceptor } from "@/components/ui/external-link-interceptor";
import { RouteFallback } from "@/components/ui/route-fallback";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { getMaintenanceState, resolveFlags } from "@/lib/flags";
import { timed } from "@/lib/perf";
import { resolveAvatarUrl } from "@/lib/avatar";
import { getViewerProfile } from "@/lib/profile/viewer";
import { getHomeBootstrap, type Announcement } from "@/lib/home/bootstrap";

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
      {/*
        Ambient depth. This used to be two large purple/magenta radial blobs at
        60% opacity, which tinted every pixel of every screen — photos, avatars
        and post text all sat under the same purple wash, so the brand colour
        stopped meaning anything and the content stopped being the hero.
        What replaces it is a single near-black vertical gradient: the ground is
        no longer perfectly flat (it lifts by ~4 points of luminance at the top,
        which is what keeps a dark UI from reading as a void) but it carries no
        hue of its own. Colour now comes from content and from the purple accent
        where purple actually means something.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, #101018 0%, var(--bg) 38%, var(--bg) 100%)",
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
 * ONE parallel stage covers everything. It used to be two: the events badge
 * needed `events_seen_at` off the profile row, so it ran afterwards as a second
 * sequential round trip. That whole count now lives inside
 * `community_badge_count()` (migration 0170), which reads the mark itself — so
 * the layout's shell is a single Promise.all again and the second stage is gone
 * rather than merely moved.
 */
async function StudentShell() {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  // Middleware has already bounced anonymous requests; this is belt-and-braces
  // for a session that expires between the proxy hop and this render.
  if (!userId) redirect("/login");

  const [profile, maintenance, flags, bootstrap] = await timed(
    "layout:shell",
    () =>
    Promise.all([
    // Request-memoised (perf audit 2.5). The Home page also needs this row for
    // the composer placeholder and the tour gate; going through the shared
    // loader means all three share ONE query instead of three.
    getViewerProfile(),
    getMaintenanceState(),
    resolveFlags(["discover", "events", "leaderboard"]),
    // ONE call for both dock badges, the broadcast announcements and the
    // Activity unread count (migration 0174). These were four separate reads;
    // they always occur together on the same screen and all key off auth.uid(),
    // so issuing them in parallel still meant four network legs to Frankfurt.
    //
    // The badge SEMANTICS are unchanged and still owned by one definition each:
    // the RPC calls chat_badge_count()/community_badge_count() rather than
    // reimplementing them, and the reader runs the results back through the
    // same toBadge/sumBadge helpers the client uses — so a server render and a
    // realtime recount still cannot disagree about what the number MEANS
    // (unread conversations + requests, mig 0169; grouped Community/Event/
    // Broadcast and never chat, mig 0170).
    getHomeBootstrap(),
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

  // Feature-flagged destinations are dropped from the dock entirely. The
  // fallback dock above shows all six, so a tab whose flag is OFF is briefly
  // visible before this render removes it — the flags fail open and are dark-
  // launch switches, so in the normal all-on case nothing moves at all.
  const hiddenTabs = [
    !flags.discover && "/discover",
    !flags.events && "/events",
    !flags.leaderboard && "/leaderboard",
  ].filter((h): h is string => Boolean(h));

  const chatBadge = bootstrap.chat.total;

  return (
    <>
      {/* Keeps the dock's chat badge (unread DMs + pending requests) live on
          every student screen, not just after a navigation. */}
      <DockRealtime userId={userId} initialBadge={chatBadge} />
      {/* The DM inbox's listener. It lives HERE, not on /chat, so it keeps
          receiving while the student is inside a conversation or anywhere else
          in the app — the channel used to be torn down on navigation and every
          event that arrived meanwhile was lost, with no replay to recover it. */}
      <InboxRealtime userId={userId} />
      <AnnouncementModal
        announcements={bootstrap.announcements.map((a: Announcement) => ({
          id: a.id as string,
          title: String(
            (a.data as Record<string, unknown>)?.title ?? "FAST SOCIO"
          ),
          body: String((a.data as Record<string, unknown>)?.body ?? ""),
          url: ((a.data as Record<string, unknown>)?.url as string) ?? null,
        }))}
      />
      <FloatingDock
        // Keyed by NAV_ITEM href. "/events" used to be passed here and read by
        // nothing — /events is an adopted route, not a tab — so the events
        // signal now arrives as part of the Community badge, under the key the
        // dock actually renders.
        badges={{ "/chat": chatBadge, "/communities": bootstrap.community.total }}
        avatarUrl={resolveAvatarUrl(profile?.avatar_url, profile?.gender)}
        viewerId={userId}
        hiddenHrefs={hiddenTabs}
      />
    </>
  );
}
