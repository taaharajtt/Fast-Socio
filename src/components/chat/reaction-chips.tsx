"use client";

import { cn } from "@/lib/utils";
import type { ReactionChip } from "@/lib/chat/reactions";

/**
 * The reaction chips that sit under a bubble. Lifted out of the Messages
 * thread verbatim so the room, event and broadcast surfaces render the same
 * chip rather than a lookalike.
 *
 * Tapping your own chip removes your reaction; tapping someone else's adds
 * yours to it — the parent's toggle decides, this only reports the tap.
 */
export function ReactionChips({
  chips,
  align,
  onToggle,
  disabled = false,
}: {
  chips: ReactionChip[];
  align: "start" | "end";
  onToggle: (emoji: string) => void;
  /** Read-only: someone who may see reactions but not cast one. */
  disabled?: boolean;
}) {
  if (chips.length === 0) return null;
  return (
    <div
      className={cn(
        "-mt-1 flex flex-wrap gap-1",
        align === "end" ? "justify-end pr-1" : "justify-start pl-1"
      )}
    >
      {chips.map((c) => (
        <button
          key={c.emoji}
          type="button"
          disabled={disabled}
          aria-pressed={c.mine}
          aria-label={`${c.emoji} ${c.count}`}
          onClick={() => onToggle(c.emoji)}
          className={cn(
            "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px]",
            c.mine
              ? "border-accent/50 bg-accent/15 text-fg"
              : "border-glass-border bg-card text-fg-muted",
            disabled && "cursor-default"
          )}
        >
          <span>{c.emoji}</span>
          {c.count > 1 && <span className="tabular-nums">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}
