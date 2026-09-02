"use client";

import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { timeAgo } from "@/lib/time";

/**
 * A request the viewer SENT, and what became of it (UAT-02).
 *
 * The complaint was that requests "disappear". Half of that was literal: the
 * inbox only ever queried INCOMING pending rows, so from the sender's side a
 * request left no trace anywhere in the app the moment it was sent. This row is
 * that missing half — one line per sent request, with its state spelled out.
 *
 * An accepted request keeps its row until the conversation carries a message,
 * and links straight into that conversation, so the hand-off from Requests to
 * Messages is something the user watches happen rather than a gap they have to
 * trust.
 */
export type OutgoingRequest = {
  id: string;
  message: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  recipientName: string;
  recipientAvatar: string | null;
  /** Present once accepted, so the row can open the real thread. */
  conversationId: string | null;
};

const STATUS: Record<
  OutgoingRequest["status"],
  { label: string; tone: string }
> = {
  pending: { label: "Pending", tone: "text-fg-muted" },
  accepted: { label: "Accepted", tone: "text-success" },
  declined: { label: "Declined", tone: "text-fg-disabled" },
};

export function SentRequestRow({ request }: { request: OutgoingRequest }) {
  const status = STATUS[request.status];

  const body = (
    <div className="flex items-center gap-3 py-2.5">
      <div className="glass relative h-10 w-10 shrink-0 overflow-hidden rounded-full">
        {request.recipientAvatar ? (
          <AppImage
            src={request.recipientAvatar}
            alt={request.recipientName}
            sizes="40px"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate type-headline">{request.recipientName}</p>
        <p className="truncate type-caption text-fg-muted">
          You: {request.message}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`type-caption font-semibold ${status.tone}`}>
          {status.label}
        </p>
        <p className="type-caption text-fg-disabled">
          {timeAgo(request.createdAt)}
        </p>
      </div>
    </div>
  );

  // Only an accepted request has somewhere to go. A pending one is deliberately
  // inert: there is nothing for the sender to do but wait, and a tappable row
  // that leads nowhere reads as broken.
  return request.status === "accepted" && request.conversationId ? (
    <Link
      href={`/chat/${request.conversationId}`}
      className="focus-ring block rounded-[14px] px-1"
    >
      {body}
    </Link>
  ) : (
    <div className="px-1">{body}</div>
  );
}
