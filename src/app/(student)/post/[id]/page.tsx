import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PostCard } from "@/components/feed/post-card";
import { AddComment } from "@/components/feed/add-comment";
import { CommentThread } from "@/components/feed/comment-thread";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost } from "@/lib/feed/types";

type ProfileLite = { id: string; full_name: string | null; avatar_url: string | null };

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: postRow } = await supabase
    .from("feed_posts")
    .select("*")
    .eq("id", id)
    .single();
  if (!postRow) notFound();
  const post = postRow as FeedPost;

  const { data: commentRows } = await supabase
    .from("post_comments")
    .select("id, author_id, body, created_at")
    .eq("post_id", id)
    .order("created_at", { ascending: true });
  const comments = commentRows ?? [];

  const authorIds = [...new Set(comments.map((c) => c.author_id))];
  const authors: Record<string, { full_name: string | null; avatar_url: string | null }> = {};
  if (authorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", authorIds);
    (profs ?? []).forEach((p: ProfileLite) => {
      authors[p.id] = { full_name: p.full_name, avatar_url: p.avatar_url };
    });
  }

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

      <PostCard post={post} />

      <section className="mt-4 flex-1 space-y-3">
        <CommentThread
          postId={id}
          initialComments={comments}
          initialAuthors={authors}
        />
      </section>

      <AddComment postId={id} />
    </main>
  );
}
