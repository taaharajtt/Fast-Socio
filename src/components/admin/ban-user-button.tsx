"use client";

import { useState, useTransition } from "react";
import { setUserBan } from "@/app/admin/users/actions";

export function BanUserButton({
  userId,
  isBanned,
}: {
  userId: string;
  isBanned: boolean;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const confirmMsg = isBanned
      ? "Restore this user's access?"
      : "Ban this user? They will be blocked from using the app. This is logged.";
    if (!window.confirm(confirmMsg)) return;
    setError(null);
    start(async () => {
      const res = await setUserBan(userId, !isBanned, reason);
      if (res?.error) setError(res.error);
      else setReason("");
    });
  }

  return (
    <div className="space-y-2">
      {!isBanned && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, logged)"
          className="glass h-10 w-full rounded-[var(--radius-sm)] px-3 text-sm text-fg outline-none placeholder:text-fg-muted"
        />
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className={`w-full rounded-[var(--radius-pill)] py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
          isBanned ? "bg-success/90" : "bg-error/90"
        }`}
      >
        {pending
          ? "Working…"
          : isBanned
            ? "Restore access"
            : "Ban user"}
      </button>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
