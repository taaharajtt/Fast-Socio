"use client";

import { useEffect, useRef } from "react";
import { markActivityRead } from "@/app/(student)/activity/actions";

/**
 * Marks all notifications read automatically when the panel opens (fire-and-
 * forget on mount). Renders nothing — there is no longer a manual "Mark all
 * read" button; visiting the panel IS the read action. The current render keeps
 * its unread highlights (the action doesn't revalidate), so the user still sees
 * what was new this visit; the bell badge clears on the next navigation.
 */
export function AutoMarkRead() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void markActivityRead();
  }, []);
  return null;
}
