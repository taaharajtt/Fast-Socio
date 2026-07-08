import Image from "next/image";
import Link from "next/link";
import { PostComposer } from "@/components/feed/post-composer";
import { FeedList } from "@/components/feed/feed-list";
import { EventsStrip } from "@/components/feed/events-strip";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { AppImage } from "@/components/ui/app-image";
import { createClient } from "@/lib/supabase/server";
import { FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data }, { data: me }] = await Promise.all([
    supabase
      .from("feed_posts")
      .select("*")
      .is("community_id", null)
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE),
    supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user?.id ?? "")
      .single(),
  ]);
  const posts = (data as FeedPost[]) ?? [];

  return (
    <main className="mx-auto w-full max-w-md pb-4">
      {/* Header (UISpec V3 Screen 2) — 56px, title + bell + avatar */}
      <header className="flex h-14 items-center justify-between px-4">
        {/* Brand logo (UAT-001). PNG lives at public/brand/logo.png; the h1 text
            stays as the accessible name and renders if the asset is missing. */}
        <h1 className="text-xl font-black tracking-tight">
          <Image
            src="/brand/logo.png"
            alt="FAST SOCIO"
            width={512}
            height={256}
            priority
            className="h-7 w-auto"
          />
          <span className="sr-only">FAST SOCIO</span>
        </h1>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <Link
            href="/profile"
            aria-label="Your profile"
            className="relative block h-9 w-9 overflow-hidden rounded-full bg-card"
          >
            {me?.avatar_url && (
              <AppImage src={me.avatar_url} alt="You" sizes="36px" />
            )}
          </Link>
        </div>
      </header>

      <div className="px-4">
        <PostComposer />
        <EventsStrip />
      </div>

      <div className="mt-2">
        <FeedList initial={posts} />
      </div>
    </main>
  );
}
