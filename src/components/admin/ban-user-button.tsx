"use client";

import { useState, useTransition } from "react";
import { field, ctrl, ctrlDanger } from "@/components/admin/kit";
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
          className={`${field} w-full`}
        />
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className={isBanned ? ctrl : ctrlDanger}
      >
        {pending ? "Working…" : isBanned ? "Restore access" : "Ban user"}
      </button>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
