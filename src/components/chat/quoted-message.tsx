"use client";

import { cn } from "@/lib/utils";
import {
  replyPreviewText,
  type QuotablePreview,
} from "@/lib/chat/reply-preview";

/**
 * The compact quote that sits above a reply — in the thread and, in the same
 * shape, inside the composer while composing one.
 *
 * `label` is the relationship line ("replied to you", "You replied to Ali"),
 * which is what tells the reader whose message is being answered without
 * repeating a name inside the quote itself.
 */
export function QuotedMessage({
  preview,
  label,
  mine,
  onClick,
  className,
}: {
  // `QuotablePreview`, not the DM-specific `ReplyPreview`: the group
  // surfaces quote rows from three other tables, and every one of them is
  // projected to this shape before it gets here.
  preview: QuotablePreview | null | undefined;
  label?: string | null;
  /** Rendered against an outgoing (purple) bubble rather than the dark ground. */
  mine?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const text = replyPreviewText(preview);
  const body = (
    <span
      className={cn(
        // `w-full`, not shrink-to-fit: the column around the bubble is
        // `items-end`/`items-start`, so without an explicit width the quote
        // sized itself to its own text and sat narrower (or wider) than the
        // bubble beneath it. Full width resolves against that column, which
        // is as wide as the widest child — i.e. the bubble — so the quote and
        // the message it answers share one edge on both sides, incoming and
        // outgoing alike.
        "flex w-full min-w-0 flex-col gap-0.5 rounded-xl border-l-2 px-2.5 py-1.5 text-left",
        mine
          ? "border-white/60 bg-white/15 text-white/85"
          : "border-fg-subtle/50 bg-fill text-fg-muted",
        className
      )}
    >
      {label && (
        <span className="truncate text-[11px] font-medium opacity-80">{label}</span>
      )}
      <span className="truncate text-[13px]">{text}</span>
    </span>
  );

  if (!onClick) return body;
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex w-full min-w-0 rounded-xl text-left"
      aria-label="Show the original message"
    >
      {body}
    </button>
  );
}
