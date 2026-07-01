"use client";

import { useState, useTransition } from "react";
import { GlassButton, GlassInput } from "@/components/ui";
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
      <div className="space-y-2">
        <label className="text-sm font-medium">Adjustment (+/-)</label>
        <GlassInput
          type="number"
          inputMode="numeric"
          placeholder="e.g. 50 or -20"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Reason <span className="text-error">*</span>
        </label>
        <GlassInput
          placeholder="Required — logged to the audit trail"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <GlassButton type="submit" size="md" disabled={!valid || pending}>
        {pending ? "Applying…" : "Apply adjustment"}
      </GlassButton>
      {done && <p className="text-sm text-success">Adjustment applied.</p>}
      {error && <p className="text-sm text-error">{error}</p>}
    </form>
  );
}
