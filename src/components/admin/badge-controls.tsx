"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { ctrl, ctrlDanger } from "@/components/admin/kit";
import { grantBadge, revokeBadge } from "@/app/admin/users/actions";

export type AdminBadgeRow = {
  code: string;
  title: string;
  description: string;
  image_url: string | null;
  earned: boolean;
};

/**
 * Grant / revoke badges on the admin user page. The Socio is admin-only by
 * design (metric 'manual'); the rest normally self-grant, but corrections are
 * allowed here. Both directions route through audited SECURITY DEFINER RPCs.
 */
export function BadgeControls({
  userId,
  badges,
}: {
  userId: string;
  badges: AdminBadgeRow[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function act(code: string, earned: boolean) {
    setError(null);
    start(async () => {
      const res = earned
        ? await revokeBadge(userId, code)
        : await grantBadge(userId, code);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-2">
      {badges.map((b) => (
        <div key={b.code} className="flex items-center gap-3">
          {b.image_url && (
            <Image
              src={b.image_url}
              alt=""
              width={48}
              height={48}
              className={`h-6 w-6 ${b.earned ? "" : "opacity-40 grayscale"}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg">
              {b.title}
              {b.code === "the_socio" && (
                <span className="ml-1.5 font-mono text-[10px] uppercase text-fg-muted">
                  admin-granted
                </span>
              )}
            </p>
            <p className="truncate text-[11px] text-fg-muted">{b.description}</p>
          </div>
          <button
            type="button"
            className={b.earned ? ctrlDanger : ctrl}
            disabled={pending}
            onClick={() => act(b.code, b.earned)}
          >
            {b.earned ? "Revoke" : "Grant"}
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
