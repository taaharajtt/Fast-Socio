import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PostCard } from "@/components/feed/post-card";
import { CommentsSection } from "@/components/feed/comments-section";
import { createClient } from "@/lib/supabase/server";
import { fetchComments } from "@/app/(student)/home/actions";
import type { FeedPost } from "@/lib/feed/types";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: postRow } = await supabase
    .from("feed_posts")
    .select("*")
    .eq("id", id)
    .single();
  if (!postRow) notFound();
  const post = postRow as FeedPost;

  // Same enriched load as the in-feed sheet (top-level comments + authors +
  // the viewer's like state); replies are lazy-loaded client-side.
  const { comments, authors } = await fetchComments(id);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 py-4">
      <div className="mb-3 flex items-center gap-3">
        <Link
          href="/home"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">Post</h1>
      </div>

      <PostCard post={post} currentUserId={user?.id} />

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <CommentsSection
          variant="page"
          postId={id}
          initialComments={comments}
          initialAuthors={authors}
          viewerId={user?.id}
        />
      </div>
    </main>
  );
}
