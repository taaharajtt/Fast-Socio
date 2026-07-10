"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { StatusDot, Tag, ctrl, ctrlDanger } from "@/components/admin/kit";
import { moderateEvent, deleteEvent } from "@/app/admin/events/actions";

export type AdminEvent = {
  id: string;
  title: string;
  category: string;
  location: string | null;
  startsAt: string;
  hostName: string | null;
  attendeeCount: number;
  status: "pending" | "approved" | "rejected";
};

const tone: Record<AdminEvent["status"], string> = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
};

export function EventAdminRow({ event, isSuper }: { event: AdminEvent; isSuper: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const act = (fn: () => Promise<{ error: string } | void>) => {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res?.error) setErr(res.error);
    });
  };

  return (
    <div className="rounded-[4px] border border-glass-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
            {event.title}
            <Tag>{event.category}</Tag>
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            {event.startsAt}
            {event.location ? ` · ${event.location}` : ""}
          </p>
          <p className="mt-1 font-mono text-[11px] text-fg-muted">
            by {event.hostName ?? "unknown"} · {event.attendeeCount} going
          </p>
          {err && <p className="mt-1 font-mono text-[11px] text-error">{err}</p>}
        </div>
        <StatusDot tone={tone[event.status]} label={event.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {event.status === "pending" && (
          <>
            <button className={ctrl} disabled={pending} onClick={() => act(() => moderateEvent(event.id, true))}>
              Approve
            </button>
            <button className={ctrlDanger} disabled={pending} onClick={() => act(() => moderateEvent(event.id, false))}>
              Reject
            </button>
          </>
        )}
        <Link href={`/events/${event.id}`} className={ctrl}>
          View →
        </Link>
        {isSuper && (
          <button
            className={`${ctrlDanger} ml-auto`}
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Delete event "${event.title}"? This is logged and cannot be undone.`))
                act(() => deleteEvent(event.id));
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
