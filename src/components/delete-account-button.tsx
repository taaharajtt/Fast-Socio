"use client";

import { useState, useTransition } from "react";
import { GlassButton } from "@/components/ui";
import { deleteAccount } from "@/app/(student)/settings/actions";

export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <GlassButton variant="danger" size="md" onClick={() => setConfirming(true)}>
        Delete account
      </GlassButton>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        This permanently deletes your account and all your data. This cannot be
        undone.
      </p>
      <div className="flex gap-3">
        <GlassButton
          variant="glass"
          size="md"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </GlassButton>
        <GlassButton
          variant="danger"
          size="md"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await deleteAccount();
              if (res?.error) setError(res.error);
            })
          }
        >
          {pending ? "Deleting…" : "Yes, delete everything"}
        </GlassButton>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
