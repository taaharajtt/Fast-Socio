"use client";

import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";

export type SharedPostPreview = {
  body: string | null;
  image_url: string | null;
  author_name: string | null;
  author_avatar: string | null;
  is_anonymous: boolean;
  like_count: number;
  comment_count: number;
};

/**
 * A shared post rendered inline in a chat bubble (UAT-010).
 *
 * It used to be a bare "Tap to view post →" link, so the recipient had no idea
 * what they were being sent. The card shows the author, the image, and an
 * excerpt — enough to react to without leaving the conversation — while still
 * linking through to the full post.
 */
export function SharedPostCard({
  postId,
  preview,
  mine,
}: {
  postId: string;
  preview: SharedPostPreview | undefined;
  /** Rendered inside the sender's own (gradient) bubble. */
  mine: boolean;
}) {
  // The post may have been deleted, or hidden from this viewer by a block.
  if (!preview) {
    return (
      <div
        className={cn(
          "w-[240px] max-w-full rounded-xl border px-3 py-4 text-center text-xs",
          mine
            ? "border-white/25 bg-white/10 text-white/70"
            : "border-glass-border bg-bg-elevated/40 text-fg-muted"
        )}
      >
        This post is no longer available.
      </div>
    );
  }

  const author = preview.is_anonymous
    ? "Anonymous"
    : (preview.author_name ?? "Student");

  return (
    <Link
      href={`/post/${postId}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "block w-[240px] max-w-full overflow-hidden rounded-xl border",
        mine
          ? "border-white/25 bg-white/10"
          : "border-glass-border bg-bg-elevated/50"
      )}
    >
      <div className="flex items-center gap-2 px-2.5 pb-2 pt-2.5">
        <div
          className={cn(
            "relative h-5 w-5 shrink-0 overflow-hidden rounded-full",
            mine ? "bg-white/20" : "bg-card"
          )}
        >
          {!preview.is_anonymous && preview.author_avatar && (
            <AppImage src={preview.author_avatar} alt="" sizes="20px" />
          )}
        </div>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12px] font-semibold",
            mine ? "text-white" : "text-fg"
          )}
        >
          {author}
        </span>
      </div>

      {preview.image_url && (
        <div className="relative aspect-[4/3] w-full">
          <AppImage src={preview.image_url} alt="" sizes="240px" />
        </div>
      )}

      {preview.body && (
        <p
          className={cn(
            "line-clamp-3 px-2.5 pt-2 text-[13px] leading-snug",
            mine ? "text-white/90" : "text-fg"
          )}
        >
          {preview.body}
        </p>
      )}

      <p
        className={cn(
          "px-2.5 pb-2.5 pt-2 text-[11px]",
          mine ? "text-white/60" : "text-fg-disabled"
        )}
      >
        {preview.like_count} like{preview.like_count === 1 ? "" : "s"} ·{" "}
        {preview.comment_count} comment
        {preview.comment_count === 1 ? "" : "s"} · View post
      </p>
    </Link>
  );
}
