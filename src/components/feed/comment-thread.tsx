"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppImage } from "@/components/ui/app-image";

export type Comment = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
};

type Author = { full_name: string | null; avatar_url: string | null };

/**
 * Live comment list for a post. Seeds from server-rendered comments, then
 * subscribes to post_comments INSERTs for this post_id. The author's own
 * comment (submitted through the addComment server action) echoes back over the
 * same channel, so dedup-by-id keeps a single source of truth with no optimistic
 * bookkeeping. Unknown commenter profiles are resolved lazily.
 */
export function CommentThread({
  postId,
  initialComments,
  initialAuthors,
}: {
  postId: string;
  initialComments: Comment[];
  initialAuthors: Record<string, Author>;
}) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [authors, setAuthors] =
    useState<Record<string, Author>>(initialAuthors);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) supabase.realtime.setAuth(session.access_token);

      const channel = supabase
        .channel(`post-comments:${postId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "post_comments",
            filter: `post_id=eq.${postId}`,
          },
          (payload) => {
            const c = payload.new as Comment;
            setComments((prev) =>
              prev.some((x) => x.id === c.id) ? prev : [...prev, c]
            );
            setAuthors((prev) => {
              if (prev[c.author_id]) return prev;
              supabase
                .from("profiles")
                .select("full_name, avatar_url")
                .eq("id", c.author_id)
                .single()
                .then(({ data }) => {
                  if (data)
                    setAuthors((s) => ({ ...s, [c.author_id]: data }));
                });
              return prev;
            });
          }
        )
        .subscribe();

      channelRef.current = channel;
    })();

    return () => {
      if (channelRef.current) createClient().removeChannel(channelRef.current);
    };
  }, [postId]);

  return (
    <>
      <h2 className="text-sm font-medium text-fg-muted">
        {comments.length} comment{comments.length === 1 ? "" : "s"}
      </h2>
      {comments.map((c) => {
        const a = authors[c.author_id];
        return (
          <div key={c.id} className="flex gap-3">
            <div className="glass relative h-9 w-9 shrink-0 overflow-hidden rounded-full">
              {a?.avatar_url ? (
                <AppImage
                  src={a.avatar_url}
                  alt={a.full_name ?? ""}
                  sizes="36px"
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{a?.full_name ?? "Student"}</p>
              <p className="text-[15px]">{c.body}</p>
            </div>
          </div>
        );
      })}
    </>
  );
}
