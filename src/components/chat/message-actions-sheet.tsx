"use client";

import type { LucideIcon } from "lucide-react";
import { GlassSheet } from "@/components/ui";
import { QUICK_EMOJIS } from "@/lib/chat/reactions";
import { cn } from "@/lib/utils";

/**
 * The long-press message menu, in the Messages thread's own conventions: a
 * quick-emoji row across the top, then one glass row per action, destructive
 * ones in the error colour and last.
 *
 * PERMISSION IS THE CALLER'S JOB, NOT THIS COMPONENT'S — and only for what to
 * DRAW. Every action listed here is separately refused by the database (an RLS
 * policy or the RPC's own rank check) for anyone not entitled to it, so a row
 * that should not have been rendered is a cosmetic bug, never a privilege. The
 * caller passes only the actions it wants shown; `undefined` entries are
 * dropped so a call site can write `canEdit && {...}` inline.
 */

export type MessageAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Destructive rows are drawn in the error colour. */
  tone?: "default" | "danger";
};

export function MessageActionsSheet({
  open,
  onClose,
  actions,
  onReact,
  label = "Message actions",
}: {
  open: boolean;
  onClose: () => void;
  actions: (MessageAction | false | null | undefined)[];
  /** Omitted when the viewer may not react (e.g. a non-attendee). */
  onReact?: (emoji: string) => void;
  label?: string;
}) {
  const rows = actions.filter(Boolean) as MessageAction[];
  return (
    <GlassSheet open={open} onClose={onClose} label={label}>
      <div className="space-y-3">
        {onReact && (
          <div className="flex items-center justify-between px-1">
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onReact(e)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-2xl active:scale-90"
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {rows.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={a.onSelect}
            className={cn(
              "glass flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm",
              a.tone === "danger" ? "text-error" : "text-fg"
            )}
          >
            <a.icon className="h-4 w-4" aria-hidden />
            {a.label}
          </button>
        ))}
      </div>
    </GlassSheet>
  );
}
