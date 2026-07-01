"use client";

import { useTransition } from "react";
import { GlassButton } from "@/components/ui";
import { rsvp, cancelRsvp } from "@/app/(student)/events/actions";

export function RsvpButton({
  eventId,
  attending,
}: {
  eventId: string;
  attending: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <GlassButton
      variant={attending ? "glass" : "primary"}
      size="md"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (attending) await cancelRsvp(eventId);
          else await rsvp(eventId);
        })
      }
    >
      {pending ? "…" : attending ? "Going ✓" : "Attend"}
    </GlassButton>
  );
}
