import Image from "next/image";
import Link from "next/link";
import { Activity } from "lucide-react";
import { PostComposer } from "@/components/feed/post-composer";
import { FeedList } from "@/components/feed/feed-list";
import { EventsStrip } from "@/components/feed/events-strip";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { createClient } from "@/lib/supabase/server";
import { FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("feed_posts")
    .select("*")
    .is("community_id", null)
    .order("created_at", { ascending: false })
    .limit(FEED_PAGE_SIZE);
  const posts = (data as FeedPost[]) ?? [];

  return (
    <main className="mx-auto w-full max-w-md pb-4">
      {/* Header (UISpec V3 Screen 2) — 56px, title + bell + avatar */}
      <header className="flex h-20 items-center justify-between px-4">
        {/* Brand logo (UAT-001). PNG lives at public/brand/logo.png; the h1 text
            stays as the accessible name and renders if the asset is missing. */}
        <h1 className="text-xl font-black tracking-tight">
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
        <div className="flex items-center gap-3">
          <NotificationBell />
          {/* UAT-005: the old dp slot now opens Activity; the dp itself moved to
              the bottom nav's "Me" tab. */}
          <Link
            href="/activity"
            aria-label="Activity"
            className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:text-fg"
          >
            <Activity className="h-5 w-5" aria-hidden />
          </Link>
        </div>
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
