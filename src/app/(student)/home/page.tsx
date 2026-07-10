import Image from "next/image";
import Link from "next/link";
import { Activity } from "lucide-react";
import { PostComposer } from "@/components/feed/post-composer";
import { FeedList } from "@/components/feed/feed-list";
import { EventsStrip } from "@/components/feed/events-strip";
import { createClient } from "@/lib/supabase/server";
import { FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data }, { count: unreadActivity }] = await Promise.all([
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
      .eq("user_id", user!.id)
      .is("read_at", null)
      .not("type", "in", "(message,message_request,announcement)"),
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

      <div className="px-4">
        <PostComposer />
        <EventsStrip />
      </div>

      <div className="mt-2">
        <FeedList initial={posts} currentUserId={user?.id} />
      </div>
    </main>
  );
}
