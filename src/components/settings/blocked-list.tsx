"use client";

import { useState, useTransition } from "react";
import { AppImage } from "@/components/ui/app-image";
import {
  unblockUser,
  unmuteUser,
} from "@/app/(student)/settings/relationship-actions";

export type RelUser = {
  id: string;
  name: string | null;
  avatar: string | null;
};

export function BlockedList({
  blocked,
  muted,
}: {
  blocked: RelUser[];
  muted: RelUser[];
}) {
  const [blockedRows, setBlocked] = useState(blocked);
  const [mutedRows, setMuted] = useState(muted);
  const [pending, start] = useTransition();

  function undoBlock(id: string) {
    setBlocked((r) => r.filter((x) => x.id !== id));
    start(async () => {
      await unblockUser(id);
    });
  }
  function undoMute(id: string) {
    setMuted((r) => r.filter((x) => x.id !== id));
    start(async () => {
      await unmuteUser(id);
    });
  }

  return (
    <div className="space-y-6">
      <Section
        title="Blocked"
        empty="You haven't blocked anyone."
        rows={blockedRows}
        actionLabel="Unblock"
        onAction={undoBlock}
        pending={pending}
      />
      <Section
        title="Muted"
        empty="You haven't muted anyone."
        rows={mutedRows}
        actionLabel="Unmute"
        onAction={undoMute}
        pending={pending}
      />
    </div>
  );
}

function Section({
  title,
  empty,
  rows,
  actionLabel,
  onAction,
  pending,
}: {
  title: string;
  empty: string;
  rows: RelUser[];
  actionLabel: string;
  onAction: (id: string) => void;
  pending: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-fg-muted">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-card)] bg-card p-5 text-sm text-fg-muted">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 rounded-[var(--radius-card)] bg-card p-3"
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
                {u.avatar && <AppImage src={u.avatar} alt="" sizes="40px" />}
              </div>
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                {u.name ?? "Student"}
              </p>
              <button
                type="button"
                onClick={() => onAction(u.id)}
                disabled={pending}
                className="shrink-0 rounded-full bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:text-fg"
              >
                {actionLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
