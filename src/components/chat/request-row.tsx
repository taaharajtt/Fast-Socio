"use client";

import { useTransition } from "react";
import { GlassButton, GlassCard } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import {
  acceptMessageRequest,
  declineMessageRequest,
} from "@/app/(student)/chat/actions";

export type IncomingRequest = {
  id: string;
  message: string;
  senderName: string;
  senderAvatar: string | null;
  senderDept: string | null;
};

export function RequestRow({ request }: { request: IncomingRequest }) {
  const [pending, start] = useTransition();

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-3">
        <div className="glass relative h-12 w-12 shrink-0 overflow-hidden rounded-full">
          {request.senderAvatar ? (
            <AppImage
              src={request.senderAvatar}
              alt={request.senderName}
              sizes="48px"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{request.senderName}</p>
          {request.senderDept && (
            <p className="truncate text-xs text-fg-muted">
              {request.senderDept}
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm text-fg/90">&ldquo;{request.message}&rdquo;</p>
      <div className="mt-3 flex gap-2">
        <GlassButton
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await acceptMessageRequest(request.id);
            })
          }
        >
          Accept
        </GlassButton>
        <GlassButton
          variant="glass"
          size="sm"
          className="flex-1"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await declineMessageRequest(request.id);
            })
          }
        >
          Decline
        </GlassButton>
      </div>
    </GlassCard>
  );
}
