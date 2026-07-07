import { PostComposer } from "@/components/feed/post-composer";
import { FeedList } from "@/components/feed/feed-list";
import { EventsStrip } from "@/components/feed/events-strip";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { createClient } from "@/lib/supabase/server";
import { FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("feed_posts")
    .select("*")
    .is("community_id", null)
    .order("created_at", { ascending: false })
    .limit(FEED_PAGE_SIZE);
  const posts = (data as FeedPost[]) ?? [];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight">FAST SOCIO</h1>
        <NotificationBell />
      </div>

      <PostComposer />

      <EventsStrip />

      <div className="mt-4">
        <FeedList initial={posts} />
      </div>
    </main>
  );
}
