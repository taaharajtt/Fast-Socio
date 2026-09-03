"use client";

import { X } from "lucide-react";

/**
 * The "Replying to …" row that sits INSIDE the composer card while a reply is
 * being written, separated from the input by a hairline — so replying grows
 * the composer rather than floating a second card above it.
 *
 * Lifted out of the Messages thread so every surface shows the same banner,
 * with the same cancel affordance, in the same place.
 */
export function ReplyBanner({
  label,
  text,
  onCancel,
}: {
  /** "Replying to Ali" / "Replying to yourself" / "Replying to an anonymous message". */
  label: string;
  /** One line standing in for whatever is being replied to. */
  text: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-glass-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-fg">{label}</p>
        <p className="truncate text-[13px] text-fg-muted">{text}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        className="focus-ring -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
