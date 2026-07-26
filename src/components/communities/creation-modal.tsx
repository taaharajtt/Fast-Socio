"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare, Plus, ShieldCheck } from "lucide-react";
import { GlassSheet } from "@/components/ui";

/** Header `+` modal: create a casual Chat Room or register a Verified Community/Society. */
export function CreationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <GlassSheet open={open} onClose={onClose} label="Create">
      <h2 className="text-lg font-bold">Create</h2>
      <div className="mt-4 space-y-2">
        <Link
          href="/communities/new"
          onClick={onClose}
          className="flex items-center gap-3 rounded-[14px] bg-card p-4"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <MessageSquare className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg">Create Chat Room</span>
            <span className="block text-xs text-fg-muted">
              A casual space to chat with other students
            </span>
          </span>
        </Link>
        <Link
          href="/communities/new?type=society"
          onClick={onClose}
          className="flex items-center gap-3 rounded-[14px] bg-card p-4"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg">
              Create Verified Community/Society
            </span>
            <span className="block text-xs text-fg-muted">
              A public society page with officers, broadcasts & events
            </span>
          </span>
        </Link>
      </div>
    </GlassSheet>
  );
}

/** Header `+` button that opens the CreationModal — kept alongside it since it
 *  owns the sheet's open/close state. */
export function CreationModalTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Create"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-fg-muted hover:text-fg"
      >
        <Plus className="h-5 w-5" aria-hidden />
      </button>
      <CreationModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
