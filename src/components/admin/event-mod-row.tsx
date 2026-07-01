"use client";

import { useTransition } from "react";
import { GlassButton, GlassCard, GlassChip } from "@/components/ui";
import { moderateEvent } from "@/app/admin/events/actions";

export type PendingEvent = {
  id: string;
  title: string;
  category: string;
  location: string | null;
  startsAt: string;
  hostName: string | null;
};

export function EventModRow({ event }: { event: PendingEvent }) {
  const [pending, start] = useTransition();

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2">
        <p className="font-semibold">{event.title}</p>
        <GlassChip tone="cyan">{event.category}</GlassChip>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {event.startsAt}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        by {event.hostName ?? "unknown"}
      </p>
      <div className="mt-3 flex gap-2">
        <GlassButton
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={() => start(async () => void (await moderateEvent(event.id, true)))}
        >
          Approve
        </GlassButton>
        <GlassButton
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() => start(async () => void (await moderateEvent(event.id, false)))}
        >
          Reject
        </GlassButton>
      </div>
    </GlassCard>
  );
}
