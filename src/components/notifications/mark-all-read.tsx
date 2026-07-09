"use client";

import { useTransition } from "react";
import { markAllActivityRead } from "@/app/(student)/activity/actions";

/**
 * "Mark all read" affordance (UISpec V3 Screen 4). Only shown when there is at
 * least one unread notification; clears them via the server action and lets the
 * page revalidate so the unread purple borders drop away.
 */
export function MarkAllReadButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void markAllActivityRead())}
      className="text-sm text-[#a78bfa] transition-colors hover:text-accent-light disabled:opacity-50"
    >
      Mark all read
    </button>
  );
}
