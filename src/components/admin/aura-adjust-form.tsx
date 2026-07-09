"use client";

import { useState, useTransition } from "react";
import { field, ctrl } from "@/components/admin/kit";
import { adjustAura } from "@/app/admin/users/actions";

export function AuraAdjustForm({ userId }: { userId: string }) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const parsedDelta = parseInt(delta, 10);
  const valid =
    !Number.isNaN(parsedDelta) && parsedDelta !== 0 && reason.trim().length >= 3;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    start(async () => {
      const res = await adjustAura(userId, parsedDelta, reason.trim());
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDone(true);
      setDelta("");
      setReason("");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Adjustment (+/-)
        </label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="e.g. 50 or -20"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          className={`${field} w-full`}
        />
      </div>
      <div className="space-y-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Reason <span className="text-error">*</span>
        </label>
        <input
          placeholder="Required — logged to the audit trail"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${field} w-full`}
        />
      </div>
      <button type="submit" className={ctrl} disabled={!valid || pending}>
        {pending ? "Applying…" : "Apply adjustment"}
      </button>
      {done && <p className="text-xs text-success">Adjustment applied.</p>}
      {error && <p className="text-xs text-error">{error}</p>}
    </form>
  );
}
