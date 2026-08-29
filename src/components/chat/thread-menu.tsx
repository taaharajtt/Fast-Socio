"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, MoreVertical } from "lucide-react";

/**
 * The one-to-one DM overflow menu.
 *
 * It navigates to `?report=1` rather than talking to ChatThread directly: the
 * header is rendered by the server page and the thread is a sibling client
 * component, so a search param is the one channel they already share. It also
 * makes the flow linkable and survives a refresh, and ChatThread clears the
 * param when selection ends.
 */
export function ThreadMenu({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conversation options"
        className="glass focus-ring flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
      >
        <MoreVertical className="h-5 w-5" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Conversation options"
          className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-[var(--radius-md)] border border-glass-border bg-card shadow-lg"
        >
          <button
            ref={itemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              router.replace(`/chat/${conversationId}?report=1`);
            }}
            className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-error hover:bg-fill"
          >
            <Flag className="h-4 w-4" aria-hidden />
            Report messages
          </button>
        </div>
      )}
    </div>
  );
}
