"use client";

import { useState, useTransition } from "react";
import { Check, X, VenetianMask } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { moderateCommunityPost } from "@/app/(student)/communities/actions";
import { resolveAvatarUrl } from "@/lib/avatar";
import { coverMedia, normalizePostMedia } from "@/lib/feed/media";

export type PendingPost = {
  id: string;
  body: string | null;
  image_url: string | null;
  /** Ordered carousel media. The queue shows slide 1 only — a moderator is
   *  triaging, and the cover is what identifies the post. */
  media?: unknown;
  is_anonymous: boolean;
  author_name: string | null;
  author_avatar: string | null;
  author_gender: string | null;
};

export function ReviewPostRow({ post }: { post: PendingPost }) {
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cover = coverMedia(normalizePostMedia(post.media), post.image_url);

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
        <div className="glass relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full">
          {post.is_anonymous ? (
            <VenetianMask className="h-4 w-4 text-fg-muted" aria-hidden />
          ) : resolveAvatarUrl(post.author_avatar, post.author_gender) ? (
            <AppImage
              src={resolveAvatarUrl(post.author_avatar, post.author_gender)!}
              alt=""
              sizes="32px"
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
      {cover && (
        <div className="relative mt-3 aspect-square w-full overflow-hidden rounded-2xl">
          {/* Slide 1, centre-cut square — the same cover rule every square post
              thumbnail in the app follows. */}
          <AppImage
            src={cover}
            alt="Pending post"
            sizes="(max-width: 448px) 100vw, 448px"
            square
          />
        </div>
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
