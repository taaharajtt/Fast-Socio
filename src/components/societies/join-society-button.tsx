"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { followSociety } from "@/app/(student)/societies/actions";

/**
 * "Join this society to participate in chat" CTA on the gated Chat tab. This
 * codebase has one membership relationship (community_members), so following
 * a society and joining it are the same action — followSociety already grants
 * chat access. router.refresh() re-fetches the server-loaded tab data (initial
 * messages) while SocietyShell's own client tab-selection state is preserved.
 */
export function JoinSocietyButton({ societyId }: { societyId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          await followSociety(societyId);
          setDone(true);
          router.refresh();
        })
      }
      className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
    >
      {done ? "Joined…" : pending ? "Joining…" : "Join Society"}
    </button>
  );
}
