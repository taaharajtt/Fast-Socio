"use client";

import { useState, useTransition } from "react";
import { rsvp } from "@/app/(student)/events/actions";
import { cn } from "@/lib/utils";

/** Compact Attend/RSVP action for an event card on the main Community hub. */
export function QuickRsvpButton({ eventId }: { eventId: string }) {
  const [state, setState] = useState<"none" | "going" | "waitlisted">("none");
  const [pending, start] = useTransition();

  if (state !== "none") {
    return (
      <span className="rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold text-white">
        {state === "going" ? "Attending" : "Waitlisted"}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await rsvp(eventId);
          if (res.ok) {
            setState(res.state === "waitlisted" || res.state === "already_waitlisted" ? "waitlisted" : "going");
          }
        });
      }}
      className={cn(
        "rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
      )}
    >
      {pending ? "…" : "Attend"}
    </button>
  );
}
