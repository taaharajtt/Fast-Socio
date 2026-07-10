"use client";

import { useState, useTransition } from "react";
import { ctrl } from "@/components/admin/kit";
import { setUserRole, setVerified, type GrantableRole } from "@/app/admin/users/actions";

/**
 * Super-admin controls for a single user: grant/revoke admin role and toggle the
 * verified badge. Only rendered for super_admins (the actions are gated too).
 */
export function UserAdminControls({
  userId,
  role,
  verified,
}: {
  userId: string;
  role: GrantableRole;
  verified: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<GrantableRole>(role);
  const [isVerified, setIsVerified] = useState(verified);

  function changeRole(next: GrantableRole) {
    if (next === current) return;
    const label = next === null ? "revoke admin from" : `make ${next.replace("_", " ")}`;
    if (!window.confirm(`Are you sure you want to ${label} this user?`)) return;
    setErr(null);
    start(async () => {
      const res = await setUserRole(userId, next);
      if (res?.error) setErr(res.error);
      else setCurrent(next);
    });
  }

  function toggleVerified() {
    setErr(null);
    start(async () => {
      const res = await setVerified(userId, !isVerified);
      if (res?.error) setErr(res.error);
      else setIsVerified((v) => !v);
    });
  }

  const roles: { key: GrantableRole; label: string }[] = [
    { key: null, label: "None" },
    { key: "moderator", label: "Moderator" },
    { key: "super_admin", label: "Super admin" },
  ];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Admin role
        </p>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <button
              key={r.label}
              type="button"
              disabled={pending}
              onClick={() => changeRole(r.key)}
              aria-pressed={current === r.key}
              className={`rounded-[3px] border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                current === r.key
                  ? "border-fg bg-card font-medium text-fg"
                  : "border-glass-border text-fg-muted hover:text-fg"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
          Verified badge
        </p>
        <button type="button" onClick={toggleVerified} disabled={pending} className={ctrl}>
          {isVerified ? "✓ Verified — revoke" : "Grant verified"}
        </button>
      </div>

      {err && <p className="font-mono text-[11px] text-error">{err}</p>}
    </div>
  );
}
