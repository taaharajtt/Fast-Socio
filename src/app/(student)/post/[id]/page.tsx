import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PostCard } from "@/components/feed/post-card";
import { CommentsSection } from "@/components/feed/comments-section";
import { SkeletonCard } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { fetchComments } from "@/app/(student)/home/actions";
import { FEED_COLUMNS, type FeedPost } from "@/lib/feed/types";

/**
 * The page itself is a STATIC shell: it never awaits `params` and never reads
 * a request. Everything request-dependent lives in `PostBody` behind a
 * Suspense boundary, and the params promise is passed down rather than awaited
 * here.
 *
 * This shape is required under Cache Components (`cacheComponents: true` in
 * next.config.ts). Awaiting params at the top level made the whole route
 * dynamic while Next was still building a fallback shell for it, and the
 * `notFound()` below then threw during that shell pass:
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided
 *
 * which surfaced as a 500 on individual post pages. Keeping the shell free of
 * request data means the fallback can prerender on its own, and the dynamic
 * half streams in afterwards.
 */
export default function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

      <Suspense fallback={<SkeletonCard />}>
        <PostBody params={params} />
      </Suspense>
    </main>
  );
}

async function PostBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip (layout already
  // gated this route; RLS scopes every query below).
  const me = await getAuthUserId();

  const { data: postRow } = await supabase
    .from("feed_posts")
    .select(FEED_COLUMNS)
    .eq("id", id)
    .single();
  if (!postRow) notFound();
  const post = postRow as FeedPost;

  // Same enriched load as the in-feed sheet (top-level comments + authors +
  // the viewer's like state); replies are lazy-loaded client-side.
  const { comments, authors } = await fetchComments(id);

  return (
    <>
      <PostCard post={post} currentUserId={me ?? undefined} />

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <CommentsSection
          variant="page"
          postId={id}
          initialComments={comments}
          initialAuthors={authors}
          viewerId={me ?? undefined}
        />
      </div>
    </>
  );
}
