"use client";

import { useTransition } from "react";
import { Tag, ctrl, ctrlDanger } from "@/components/admin/kit";
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
    <div className="rounded-[4px] border border-glass-border p-3">
      <div className="flex items-center gap-2">
        <p className="font-medium text-fg">{event.title}</p>
        <Tag>{event.category}</Tag>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {event.startsAt}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      <p className="mt-1 font-mono text-[11px] text-fg-muted">
        by {event.hostName ?? "unknown"}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={ctrl}
          disabled={pending}
          onClick={() => start(async () => void (await moderateEvent(event.id, true)))}
        >
          Approve
        </button>
        <button
          type="button"
          className={ctrlDanger}
          disabled={pending}
          onClick={() => start(async () => void (await moderateEvent(event.id, false)))}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
