"use client";

import { useState, useTransition } from "react";
import { GlassButton, GlassInput } from "@/components/ui";
import {
  changeUsername,
  deactivateAccount,
  reactivateAccount,
} from "@/app/(student)/settings/account-actions";

const USERNAME_RE = /^[a-z0-9_]{0,20}$/;

export function AccountSettings({
  currentUsername,
  deactivated,
}: {
  currentUsername: string | null;
  deactivated: boolean;
}) {
  const [username, setUsername] = useState(currentUsername ?? "");
  const [uMsg, setUMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isDeactivated, setIsDeactivated] = useState(deactivated);
  const [pending, start] = useTransition();

  const dirty = username.trim().toLowerCase() !== (currentUsername ?? "");
  const valid = /^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase());

  function saveUsername() {
    setUMsg(null);
    start(async () => {
      const res = await changeUsername(username);
      if (res.ok) setUMsg({ ok: true, text: "Username updated." });
      else setUMsg({ ok: false, text: res.error });
    });
  }

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
            <GlassInput
              value={username}
              onChange={(e) => {
                const v = e.target.value.toLowerCase();
                if (USERNAME_RE.test(v)) setUsername(v);
              }}
              placeholder="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <p className="text-xs text-fg-muted">
            3–20 characters — lowercase letters, numbers, underscore. Can be
            changed once every 30 days.
          </p>
          <GlassButton
            size="sm"
            onClick={saveUsername}
            disabled={pending || !dirty || !valid}
          >
            {pending ? "Saving…" : "Save username"}
          </GlassButton>
          {uMsg && (
            <p className={uMsg.ok ? "text-sm text-success" : "text-sm text-error"}>
              {uMsg.text}
            </p>
          )}
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
