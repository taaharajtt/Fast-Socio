"use client";

import { useState, useTransition } from "react";
import { ctrl } from "@/components/admin/kit";
import { decideAppeal } from "@/app/admin/moderation-actions";

/** Approve / reject buttons for a single appeal (Refactor Phase 9). */
export function AppealDecision({ appealId }: { appealId: string }) {
  const [done, setDone] = useState<null | "approved" | "rejected">(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(approve: boolean) {
    setErr(null);
    start(async () => {
      const res = await decideAppeal(appealId, approve);
      if (res.ok) setDone(approve ? "approved" : "rejected");
      else setErr(res.error);
    });
  }

  if (done) {
    return (
      <span className="font-mono text-[11px] capitalize text-fg-muted">{done}</span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => decide(true)}
        disabled={pending}
        className={ctrl}
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() => decide(false)}
        disabled={pending}
        className={ctrl}
      >
        Reject
      </button>
      {err && <span className="font-mono text-[11px] text-error">{err}</span>}
    </div>
  );
}
