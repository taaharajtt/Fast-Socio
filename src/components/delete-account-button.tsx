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
      // Force a solid error fill + white text (not the /90 alpha) and a border,
      // so the destructive action is unmistakably visible in BOTH light and dark
      // themes — a translucent danger fill can wash out on the light surface.
      <GlassButton
        variant="danger"
        size="md"
        onClick={() => setConfirming(true)}
        className="border border-error !bg-error !text-white"
      >
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
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
