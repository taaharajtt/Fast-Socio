"use client";

import { useState, useTransition } from "react";
import { Check, X, VenetianMask } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { moderateCommunityPost } from "@/app/(student)/communities/actions";

export type PendingPost = {
  id: string;
  body: string | null;
  image_url: string | null;
  is_anonymous: boolean;
  author_name: string | null;
  author_avatar: string | null;
};

export function ReviewPostRow({ post }: { post: PendingPost }) {
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function act(approve: boolean) {
    setError(null);
    start(async () => {
      const res = await moderateCommunityPost(post.id, approve);
      if (!res.ok) setError(res.error);
      else setDone(approve ? "approved" : "rejected");
    });
  }

  if (done) {
    return (
      <GlassCard className="p-4">
        <p className="text-sm text-fg-muted">
          Post {done}. The author has been notified.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2">
        <div className="glass flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full">
          {post.is_anonymous ? (
            <VenetianMask className="h-4 w-4 text-fg-muted" aria-hidden />
          ) : post.author_avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.author_avatar}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <p className="text-sm font-semibold">
          {post.is_anonymous ? "Anonymous" : (post.author_name ?? "Member")}
        </p>
      </div>

      {post.body && (
        <p className="mt-3 whitespace-pre-wrap text-[15px]">{post.body}</p>
      )}
      {post.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.image_url}
          alt="Pending post"
          className="mt-3 max-h-72 w-full rounded-2xl object-cover"
        />
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => act(true)}
          disabled={pending}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] bg-success/90 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Check className="h-4 w-4" aria-hidden /> Approve
        </button>
        <button
          type="button"
          onClick={() => act(false)}
          disabled={pending}
          className="glass flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] py-2.5 text-sm font-semibold text-error disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden /> Reject
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </GlassCard>
  );
}
