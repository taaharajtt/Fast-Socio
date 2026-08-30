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
 * here. That is worth keeping on its own merits — the header and the comment
 * skeleton paint immediately and only the query streams.
 *
 * ---------------------------------------------------------------------------
 * ON E592, AND WHAT THIS COMMENT USED TO CLAIM.
 *
 * It used to say this shape was REQUIRED under Cache Components, that awaiting
 * params here caused
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided
 *
 * and that the invariant "surfaced as a 500 on individual post pages". Fifteen
 * other dynamic routes were rewritten to match. Measured on production
 * 2026-08-31, all three claims are false:
 *
 *  - NOT FIXED. This route was still throwing it 222 times in 24 hours, while
 *    already having the shape above. 100% of the app's occurrences are here.
 *  - NOT A 500. All 162 /post/ responses in that same window were 200, and
 *    zero 5xx were served. Next catches the invariant and re-renders.
 *  - NOT CAUSED BY PAGE CODE. The guard is
 *    node_modules/next/dist/server/app-render/app-render.js:1591 —
 *      if (typeof renderOpts.postponed === 'string')
 *        if (fallbackRouteParams) throw
 *    Neither value is derived from this file. Both are true for all 16 dynamic
 *    routes (see .next/prerender-manifest.json), which is why rewriting the
 *    other fifteen changed nothing.
 *
 * `await connection()` was tried here and REVERTED: it does not remove the
 * postponed state. Under `cacheComponents: true` PPR is not optional per
 * route, the shell is produced from the layout/loading boundary ABOVE this
 * page, and the route stays PARTIALLY_STATIC with a 4,253-byte postponed
 * entry either way. Verified in the build output — the marker never left `◐`.
 *
 * The trigger is still unknown, and the next person should start from this
 * measurement rather than the source: the errors fire with ZERO incoming
 * /post/ requests in the access log (2 within 12 minutes of a container start
 * during which Caddy logged no /post traffic at all), so it is background
 * render work, not a user request. Do not "fix" this route again without a
 * before/after count from `docker logs fastsocio-app | grep -c "postponed state"`.
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
