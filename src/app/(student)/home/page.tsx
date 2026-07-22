import Image from "next/image";
import Link from "next/link";
import { Activity } from "lucide-react";
import { HomeFeed } from "@/components/feed/home-feed";
import { FirstRunTour } from "@/components/tour/first-run-tour";
import { EventsStrip } from "@/components/feed/events-strip";
import { HomeHelpStrip } from "@/components/help/home-help-strip";
import { HomeSocietyStrip } from "@/components/societies/home-society-strip";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";

export default async function HomePage() {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip (the layout has
  // already gated this route; RLS scopes every query below).
  const userId = (await getAuthUserId())!;
  const [{ data }, { count: unreadActivity }, { data: viewer }] =
    await Promise.all([
    // Single chronological campus feed (newest first).
    supabase
      .from("feed_posts")
      .select("*")
      .is("community_id", null)
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE),
    // UAT-013: the Activity icon carries an unread count. Mirrors the filter on
    // /activity so the badge can never point at rows that page won't show.
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null)
      .not("type", "in", "(message,message_request,announcement)"),
    // First-run tour gate: null tour_seen_at = this account hasn't seen it.
    supabase.from("profiles").select("tour_seen_at").eq("id", userId).single(),
  ]);
  const posts = (data as FeedPost[]) ?? [];

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
        {/* Activity is the sole top-right action; the dp lives on the bottom
            nav's "Me" tab (UAT-005). */}
        <Link
          href="/activity"
          data-tour="activity"
          aria-label={
            unreadActivity
              ? `Activity, ${unreadActivity} unread`
              : "Activity"
          }
          className="glass relative flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:text-fg"
        >
          <Activity className="h-5 w-5" aria-hidden />
          {(unreadActivity ?? 0) > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white ring-2 ring-bg">
              {unreadActivity! > 99 ? "99+" : unreadActivity}
            </span>
          )}
        </Link>
      </header>

      {/* Campus Help discovery strip — a utility surface, not a feed category
          (rendered above the feed; renders nothing when nothing is open). */}
      <div className="px-4">
        <HomeHelpStrip />
        <HomeSocietyStrip />
      </div>

      {/* Same DOM as before, but a client shell ties composer → feed so a new
          post appears via one targeted fetch instead of a full RSC refresh. */}
      <HomeFeed
        initialPosts={posts}
        currentUserId={userId}
        eventsStrip={<EventsStrip />}
      />
      {/* One-time guided tour, gated per account via profiles.tour_seen_at. */}
      {!viewer?.tour_seen_at && <FirstRunTour />}
    </main>
  );
}
