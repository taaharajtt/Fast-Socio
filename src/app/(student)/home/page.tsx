import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { ActivityLink } from "@/components/notifications/activity-link";
import { fetchActivityUnread } from "@/lib/notifications/count";
import { HomeFeed } from "@/components/feed/home-feed";
import { FirstRunTour } from "@/components/tour/first-run-tour";
import { NewFeaturesTour } from "@/components/tour/new-features-tour";
import { HomeHelpStrip } from "@/components/help/home-help-strip";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { getViewerProfile } from "@/lib/profile/viewer";
import { timed } from "@/lib/perf";
import { FEED_COLUMNS, FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";

// No `unstable_instant` export here — it only adds build-time validation, and
// that validation currently trips on @sentry/nextjs reading the `sentry-trace`
// header during every server render. See the note in next.config.ts; the static
// shell itself is unaffected (this route builds as Partial Prerender).

/**
 * The campus feed.
 *
 * This component does not await anything: the masthead, the Campus Map and
 * Activity buttons and the composer are identical for every student on every
 * visit, so they belong in the prerendered shell and appear the instant the
 * Home tab is tapped. The three request-scoped pieces — the Activity unread
 * count, the feed itself, and which guided tour (if either) this account is due
 * — each stream into their own slot.
 *
 * `loadFeed()` is deliberately called WITHOUT await and handed to the client
 * shell as a promise. That starts the query immediately (it is in flight while
 * the shell is still being serialised) but leaves this function synchronous, so
 * nothing above the feed can be held back by it.
 */
export default function HomePage() {
  const feed = loadFeed();
  // Deliberately NOT awaited — see the note above. Awaiting here would make this
  // function async and hold the entire prerendered shell behind a profile read.
  // It travels as a promise, exactly like `feed`, and is unwrapped behind its own
  // Suspense boundary in HomeFeed.
  const composerPlaceholder = loadComposerPlaceholder();

  return (
    <main className="mx-auto w-full max-w-md pb-4">
      {/* Header (UISpec V3 Screen 2) — brand logo + Activity (top-right).
          The in-app notification bell was removed; notifications now surface as
          PWA push on mobile/iOS (Settings → Enable push). */}
      <header className="flex h-[80px] items-center justify-between px-4">
        {/* Brand logo (UAT-001). PNG lives at public/brand/logo.png; the h1 text
            stays as the accessible name and renders if the asset is missing.
            70px tall. Header height is deliberately just 10px taller on each
            side (80px total) rather than the previous looser 104px — that gap
            below the logo is what becomes the space before the composer, and
            it's now roughly half what it was (~5px vs ~9.5px). */}
        <h1 className="text-xl font-black tracking-tight">
          {/* App is dark-only; always render the dark-mode logo asset. */}
          <Image
            src="/brand/logo.png"
            alt="FAST SOCIO"
            width={512}
            height={256}
            priority
            className="h-[70px] w-auto"
          />
          <span className="sr-only">FAST SOCIO</span>
        </h1>
        {/* Top-right actions: quick jump to the Campus Map, then Activity. The
            dp lives on the bottom nav's "Me" tab (UAT-005). Bare glyphs, not
            bordered wells — the icon IS the button, and each still carries a
            40px tap target (apple.md §10). */}
        <div className="flex items-center gap-1">
          <Link
            href="/map"
            aria-label="Campus Map"
            className="pressable focus-ring flex h-10 w-10 items-center justify-center rounded-full text-fg hover:text-accent"
          >
            <MapPin className="h-[22px] w-[22px]" strokeWidth={1.9} aria-hidden />
          </Link>
          {/* The button itself is static; only its unread count is per-user, so
              the badge alone streams on top of an already-tappable control. */}
          <Suspense fallback={<ActivityLink />}>
            <ActivityLinkWithBadge />
          </Suspense>
        </div>
      </header>

      {/* A client shell ties composer → feed so a new post appears via one
          targeted fetch instead of a full RSC refresh. The Campus Help discovery
          strip sits in the belowComposer slot so the composer reads first, then
          a gap, then Campus Help (its own <section className="mt-4">). */}
      <HomeFeed
        feed={feed}
        composerPlaceholder={composerPlaceholder}
        belowComposer={
          <Suspense fallback={null}>
            <HomeHelpStrip />
          </Suspense>
        }
      />
      {/* Guided tours (mutually exclusive). New accounts get the full first-run
          tour, gated per account via profiles.tour_seen_at; accounts that have
          already finished it get the release "what's new" tour instead, gated
          per device via localStorage so it shows once after the addons rollout.
          Neither is visible on first paint, so this streams in last. */}
      <Suspense fallback={null}>
        <TourGate />
      </Suspense>
    </main>
  );
}

/** Single chronological campus feed (newest first), plus the viewer id the feed
 *  rows need to know which posts are the viewer's own. */
async function loadFeed(): Promise<{
  posts: FeedPost[];
  currentUserId: string | null;
}> {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip (middleware has
  // already gated this route; RLS scopes the query below).
  const currentUserId = await getAuthUserId();
  const { data } = await timed("home:feed", () =>
    supabase
      .from("feed_posts")
      .select(FEED_COLUMNS)
      .is("community_id", null)
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE)
  );
  return { posts: (data as unknown as FeedPost[]) ?? [], currentUserId };
}

/** Builds the composer's placeholder from the viewer's own name (fix-038):
 *  "Yo, {name}! What's on your mind?", falling back to the nameless default
 *  when the profile has no name, and to the first name only when the full
 *  name would be too long for the composer card. */
async function loadComposerPlaceholder(): Promise<string> {
  const fallback = "What's on your mind?";
  // Shares the one viewer-profile read with StudentShell and TourGate (F11).
  const viewer = await getViewerProfile();
  const full = viewer?.full_name?.trim();
  if (!full) return fallback;
  const name = full.length > 18 ? full.split(" ")[0] : full;
  return `Yo, ${name}! What's on your mind?`;
}

/** UAT-013: the Activity icon carries an unread count. The filter lives in
 *  `fetchActivityUnread` so the server badge and the realtime recount in
 *  <NotificationsRealtime/> can never drift apart about what it counts. */
async function ActivityLinkWithBadge() {
  const supabase = await createClient();
  const userId = (await getAuthUserId())!;
  return <ActivityLink unread={await fetchActivityUnread(supabase, userId)} />;
}

/** First-run tour gate: null tour_seen_at = this account hasn't seen it. */
async function TourGate() {
  const viewer = await getViewerProfile();
  return viewer?.tour_seen_at ? <NewFeaturesTour /> : <FirstRunTour />;
}
