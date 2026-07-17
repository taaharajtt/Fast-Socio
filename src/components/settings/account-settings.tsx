"use client";

import { useState, useTransition } from "react";
import { GlassButton } from "@/components/ui";
import {
  deactivateAccount,
  reactivateAccount,
} from "@/app/(student)/settings/account-actions";

export function AccountSettings({
  currentUsername,
  deactivated,
}: {
  currentUsername: string | null;
  deactivated: boolean;
}) {
  const [isDeactivated, setIsDeactivated] = useState(deactivated);
  const [pending, start] = useTransition();

  function toggleDeactivate() {
    start(async () => {
      const res = isDeactivated
        ? await reactivateAccount()
        : await deactivateAccount();
      if (!res?.error) setIsDeactivated(!isDeactivated);
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-fg-muted">Username</h2>
        <div className="rounded-[var(--radius-card)] bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-fg-muted">@</span>
            <span className="font-medium">{currentUsername ?? "—"}</span>
          </div>
          <p className="text-xs text-fg-muted">
            Your username is your roll number. It&apos;s set from your campus
            email and can&apos;t be changed.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-fg-muted">
          {isDeactivated ? "Reactivate account" : "Deactivate account"}
        </h2>
        <div className="rounded-[var(--radius-card)] bg-card p-5 space-y-3">
          <p className="text-sm text-fg-muted">
            {isDeactivated
              ? "Your account is deactivated — you're hidden from Discover. Reactivate any time; nothing was deleted."
              : "Hide your profile from Discover and pause activity without deleting anything. You can restore it whenever you like."}
          </p>
          <GlassButton
            variant={isDeactivated ? "primary" : "glass"}
            size="sm"
            onClick={toggleDeactivate}
            disabled={pending}
          >
            {isDeactivated ? "Reactivate" : "Deactivate"}
          </GlassButton>
        </div>
      </section>
    </div>
  );
}
