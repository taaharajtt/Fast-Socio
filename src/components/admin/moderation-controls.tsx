"use client";

import { useState, useTransition } from "react";
import { ctrl } from "@/components/admin/kit";
import { issueStrike, setShadowBan } from "@/app/admin/moderation-actions";

/**
 * Moderation controls for a single user (Refactor Phase 9): issue an escalating
 * strike and toggle a silent shadow ban. Both are admin-gated in SQL.
 */
export function ModerationControls({
  userId,
  shadowBanned,
  strikeCount,
}: {
  userId: string;
  shadowBanned: boolean;
  strikeCount: number;
}) {
  const [reason, setReason] = useState("");
  const [shadow, setShadow] = useState(shadowBanned);
  const [strikes, setStrikes] = useState(strikeCount);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function strike() {
    if (reason.trim().length < 3) {
      setErr("Give a reason.");
      return;
    }
    if (!window.confirm(`Issue strike ${strikes + 1} to this user?`)) return;
    setErr(null);
    start(async () => {
      const res = await issueStrike(userId, reason);
      if (res.ok) {
        setStrikes((s) => s + 1);
        setReason("");
      } else setErr(res.error);
    });
  }

  function toggleShadow() {
    setErr(null);
    start(async () => {
      const res = await setShadowBan(userId, !shadow);
      if (res.ok) setShadow((v) => !v);
      else setErr(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Strikes issued: {strikes}
        </p>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for strike"
          className="w-full rounded-[3px] border border-glass-border bg-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-fg"
        />
        <button type="button" onClick={strike} disabled={pending} className={ctrl}>
          Issue strike {strikes + 1}
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Shadow ban {shadow ? "· active" : ""}
        </p>
        <button type="button" onClick={toggleShadow} disabled={pending} className={ctrl}>
          {shadow ? "Lift shadow ban" : "Shadow ban (silent)"}
        </button>
      </div>

      {err && <p className="font-mono text-[11px] text-error">{err}</p>}
    </div>
  );
}
