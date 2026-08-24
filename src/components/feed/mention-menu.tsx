"use client";

import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import type { MentionTarget } from "@/app/(student)/home/actions";

/**
 * The floating @-mention suggestion list. Shared by the comment composer and
 * the post composer so both offer the identical picker; `className` positions
 * it: the comment bar floats it ABOVE the input, while the post composer keeps
 * it in flow below the textarea (the composer card is overflow-hidden, so an
 * absolutely-positioned menu would be clipped there).
 */
export function MentionMenu({
  roster,
  suggestions,
  activeIdx,
  onPick,
  onHover,
  className = "",
}: {
  roster: MentionTarget[] | null;
  suggestions: MentionTarget[];
  activeIdx: number;
  onPick: (t: MentionTarget) => void;
  onHover: (i: number) => void;
  className?: string;
}) {
  return (
    <div
      className={
        "glass-strong z-20 max-h-56 overflow-y-auto overscroll-contain rounded-[var(--radius-sm)] border border-glass-border " +
        className
      }
    >
      {roster === null ? (
        <p className="px-3 py-2.5 text-sm text-fg-muted">Loading matches…</p>
      ) : (
        suggestions.map((t, i) => (
          <button
            key={t.id}
            type="button"
            // Keep the field focused so the tap registers before blur.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(t)}
            onMouseEnter={() => onHover(i)}
            className={
              "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors " +
              (i === activeIdx ? "bg-glass" : "hover:bg-glass")
            }
          >
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-card">
              {resolveAvatarUrl(t.avatar_url, t.gender) && (
                <AppImage
                  src={resolveAvatarUrl(t.avatar_url, t.gender)!}
                  alt=""
                  sizes="32px"
                />
              )}
            </div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-fg">
                {t.full_name ?? "Student"}
              </span>
              <span className="block truncate text-[12px] text-fg-muted">
                @{t.username}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}
