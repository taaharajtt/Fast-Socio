"use client";

import { useState, useTransition } from "react";
import { Monitor } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { signOutOtherDevices } from "@/app/(student)/settings/session-actions";

export type DeviceRow = {
  id: string;
  label: string;
  ip: string | null;
  lastActive: string;
  current: boolean;
};

export function DeviceList({
  sessions,
  currentId,
}: {
  sessions: DeviceRow[];
  currentId: string | null;
}) {
  const [rows, setRows] = useState(sessions);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const others = rows.filter((r) => !r.current).length;

  function signOutOthers() {
    setError(null);
    setRows((r) => r.filter((x) => x.current));
    start(async () => {
      const res = await signOutOtherDevices(currentId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-3 rounded-[var(--radius-card)] bg-card p-4"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-elevated">
            <Monitor className="h-5 w-5 text-fg-muted" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">
              {r.label}
              {r.current && (
                <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                  This device
                </span>
              )}
            </p>
            <p className="truncate text-xs text-fg-muted">
              {r.ip ? `${r.ip} · ` : ""}Active {r.lastActive}
            </p>
          </div>
        </div>
      ))}

      {others > 0 && (
        <GlassButton
          variant="glass"
          className="w-full"
          onClick={signOutOthers}
          disabled={pending}
        >
          Sign out all other devices
        </GlassButton>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
