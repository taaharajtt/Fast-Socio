"use client";

import { useState, useTransition } from "react";
import {
  cancelJoinRequest,
  requestJoinCommunity,
  type JoinState,
} from "@/app/(student)/communities/actions";

/**
 * The Join half of Follow/Join on its own, for the gated chat panel. Tapping
 * "Requested" withdraws the ask, so a student is never stuck waiting on a
 * moderator with no way out.
 */
export function RequestJoinButton({
  communityId,
  joinStatus,
}: {
  communityId: string;
  joinStatus: JoinState;
}) {
  const [status, setStatus] = useState<JoinState>(joinStatus);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (status === "pending") {
      setStatus("none");
      start(async () => {
        await cancelJoinRequest(communityId);
      });
      return;
    }
    setStatus("pending");
    start(async () => {
      if (status === "rejected") await cancelJoinRequest(communityId);
      const res = await requestJoinCommunity(communityId);
      if (res.ok) setStatus(res.status);
      else {
        setStatus("none");
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending || status === "joined"}
        className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {status === "pending"
          ? "Requested — tap to cancel"
          : status === "joined"
            ? "Joined"
            : "Request to join"}
      </button>
      {error && <p className="text-sm text-error">{error}</p>}
    </>
  );
}
