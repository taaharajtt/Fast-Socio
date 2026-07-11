"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MoreHorizontal, Ban, VolumeX, Volume2, RotateCcw } from "lucide-react";
import {
  blockUser,
  unblockUser,
  muteUser,
  unmuteUser,
} from "@/app/(student)/settings/relationship-actions";

/**
 * Block / mute overflow menu on another student's profile (Refactor Phase 8).
 * Optimistic; the server actions revalidate the profile + settings lists.
 */
export function ProfileActionsMenu({
  targetId,
  blocked: initialBlocked,
  muted: initialMuted,
}: {
  targetId: string;
  blocked: boolean;
  muted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(initialBlocked);
  const [muted, setMuted] = useState(initialMuted);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function act(fn: () => Promise<unknown>) {
    setOpen(false);
    start(() => {
      fn();
    });
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="More options"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-fg-muted"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>

      {open && (
        <div className="glass absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-[var(--radius-md)] py-1 shadow-xl">
          {muted ? (
            <MenuItem
              icon={Volume2}
              label="Unmute"
              onClick={() => {
                setMuted(false);
                act(() => unmuteUser(targetId));
              }}
            />
          ) : (
            <MenuItem
              icon={VolumeX}
              label="Mute"
              onClick={() => {
                setMuted(true);
                act(() => muteUser(targetId));
              }}
            />
          )}
          {blocked ? (
            <MenuItem
              icon={RotateCcw}
              label="Unblock"
              onClick={() => {
                setBlocked(false);
                act(() => unblockUser(targetId));
              }}
            />
          ) : (
            <MenuItem
              icon={Ban}
              label="Block"
              danger
              onClick={() => {
                setBlocked(true);
                setMuted(false);
                act(() => blockUser(targetId));
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm ${
        danger ? "text-error" : "text-fg"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
