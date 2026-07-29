import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { Bell, MapPin } from "lucide-react";
import { HomeFeed } from "@/components/feed/home-feed";
import { FirstRunTour } from "@/components/tour/first-run-tour";
import { NewFeaturesTour } from "@/components/tour/new-features-tour";
import { HomeHelpStrip } from "@/components/help/home-help-strip";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
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

  return (
    <main className="mx-auto w-full max-w-md pb-4">
      {/* Header (UISpec V3 Screen 2) — brand logo + Activity (top-right).
          The in-app notification bell was removed; notifications now surface as
          PWA push on mobile/iOS (Settings → Enable push). */}
      <header className="flex h-20 items-center justify-between px-4">
        {/* Brand logo (UAT-001). PNG lives at public/brand/logo.png; the h1 text
            stays as the accessible name and renders if the asset is missing. */}
        <h1 className="text-xl font-black tracking-tight">
          {/* UAT-006: theme-aware logo. Dark keeps logo.png; light shows the new
              logo1.png. Class-strategy dark mode (html.dark / html.light) lets us
              swap with CSS alone — no JS, no hydration flash. */}
          <Image
            src="/brand/logo.png"
            alt="FAST SOCIO"
            width={512}
            height={256}
            priority
            className="hidden h-[70px] w-auto dark:block"
          />
          <Image
            src="/brand/logo1.png"
            alt="FAST SOCIO"
            width={512}
            height={256}
            priority
            className="block h-[70px] w-auto dark:hidden"
          />
          <span className="sr-only">FAST SOCIO</span>
        </h1>
        {/* Top-right actions: quick jump to the Campus Map, then Activity. The
            dp lives on the bottom nav's "Me" tab (UAT-005). */}
        <div className="flex items-center gap-2">
          <Link
            href="/map"
            aria-label="Campus Map"
            className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:text-fg"
          >
            <MapPin className="h-5 w-5" aria-hidden />
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

/** The Activity button with no count — what the shell renders until the real
 *  count arrives. Identical geometry, so the badge never shifts anything. */
function ActivityLink({ unread = 0 }: { unread?: number }) {
  return (
    <Link
      href="/activity"
      data-tour="activity"
      aria-label={unread ? `Activity, ${unread} unread` : "Activity"}
      className="glass relative flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:text-fg"
    >
      <Bell className="h-5 w-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white ring-2 ring-bg">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

/** UAT-013: the Activity icon carries an unread count. Mirrors the filter on
 *  /activity so the badge can never point at rows that page won't show. */
async function ActivityLinkWithBadge() {
  const supabase = await createClient();
  const userId = (await getAuthUserId())!;
  const { count } = await supabase
    // The badge must not count notifications whose subject is gone (mig 0132).
    .from("notifications_live")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null)
    .not("type", "in", "(message,message_request,announcement)");
  return <ActivityLink unread={count ?? 0} />;
}

/** First-run tour gate: null tour_seen_at = this account hasn't seen it. */
async function TourGate() {
  const supabase = await createClient();
  const userId = (await getAuthUserId())!;
  const { data: viewer } = await supabase
    .from("profiles")
    .select("tour_seen_at")
    .eq("id", userId)
    .single();
  return viewer?.tour_seen_at ? <NewFeaturesTour /> : <FirstRunTour />;
}
