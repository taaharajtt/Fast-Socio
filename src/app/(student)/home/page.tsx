import { PostComposer } from "@/components/feed/post-composer";
import { PostCard } from "@/components/feed/post-card";
import { EventsStrip } from "@/components/feed/events-strip";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost } from "@/lib/feed/types";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("feed_posts")
    .select("*")
    .is("community_id", null)
    .order("created_at", { ascending: false })
    .limit(50);
  const posts = (data as FeedPost[]) ?? [];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Home</h1>

      <PostComposer />

      <EventsStrip />

      <div className="mt-4 space-y-4">
        {posts.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">
            No posts yet. Be the first to share something.
          </p>
        ) : (
          posts.map((p) => <PostCard key={p.id} post={p} />)
        )}
      </div>
    </main>
  );
}
