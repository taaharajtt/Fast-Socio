import Link from "next/link";
import { ArrowLeft, Bookmark } from "lucide-react";
import { SavedPostsList } from "@/components/feed/saved-posts-list";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost } from "@/lib/feed/types";

/**
 * Saved posts (Refactor Phase 3b). Lists the posts the viewer has bookmarked,
 * newest-post-first. Reads through the feed_posts view filtered on saved_by_me,
 * so anonymity, blocks and moderation stay enforced exactly as in the feed.
 */
export default async function SavedPostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("feed_posts")
    .select("*")
    .eq("saved_by_me", true)
    .order("created_at", { ascending: false })
    .limit(30);
  const posts = (data as FeedPost[]) ?? [];

  return (
    <main className="mx-auto w-full max-w-md pb-4">
      <header className="flex h-16 items-center gap-3 px-4">
        <Link
          href="/profile"
          aria-label="Back to profile"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Bookmark className="h-5 w-5 text-accent" aria-hidden />
          Saved
        </h1>
      </header>

      {posts.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-fg-muted">
          Nothing saved yet. Tap the bookmark on any post to keep it here.
        </p>
      ) : (
        <div className="mt-1">
          <SavedPostsList initial={posts} currentUserId={user?.id} />
        </div>
      )}
    </main>
  );
}
