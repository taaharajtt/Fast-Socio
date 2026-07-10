"use client";

import { useState, useTransition } from "react";
import { ctrl } from "@/components/admin/kit";
import { setAuthFlag } from "@/app/admin/infra/actions";

/**
 * Supabase auth toggles. Note `mailer_autoconfirm` is inverted for humans:
 * autoconfirm=true means email verification is OFF.
 */
export function InfraAuthSettings({
  siteUrl,
  jwtExp,
  autoconfirm,
  disableSignup,
}: {
  siteUrl: string;
  jwtExp: number;
  autoconfirm: boolean;
  disableSignup: boolean;
}) {
  const [pending, start] = useTransition();
  const [ac, setAc] = useState(autoconfirm);
  const [ds, setDs] = useState(disableSignup);
  const [err, setErr] = useState<string | null>(null);

  function toggle(key: "mailer_autoconfirm" | "disable_signup", next: boolean, confirmMsg: string) {
    if (!window.confirm(confirmMsg)) return;
    setErr(null);
    start(async () => {
      const res = await setAuthFlag(key, next);
      if ("error" in res) setErr(res.error);
      else if (key === "mailer_autoconfirm") setAc(next);
      else setDs(next);
    });
  }

  const row = "flex items-center justify-between gap-3 px-3 py-2.5";

  return (
    <div className="divide-y divide-glass-border overflow-hidden rounded-[4px] border border-glass-border">
      <div className={row}>
        <div>
          <p className="text-sm text-fg">Require email confirmation</p>
          <p className="font-mono text-[11px] text-fg-muted">
            {ac ? "OFF — new signups are auto-confirmed" : "ON — users must verify their email"}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          className={ctrl}
          onClick={() =>
            toggle(
              "mailer_autoconfirm",
              !ac,
              ac
                ? "Require email confirmation for new signups? Users will have to verify before logging in."
                : "Disable email confirmation? New signups will be auto-confirmed without verifying.",
            )
          }
        >
          {ac ? "Enable" : "Disable"}
        </button>
      </div>

      <div className={row}>
        <div>
          <p className="text-sm text-fg">Signups</p>
          <p className="font-mono text-[11px] text-fg-muted">{ds ? "DISABLED" : "enabled"}</p>
        </div>
        <button
          type="button"
          disabled={pending}
          className={ctrl}
          onClick={() =>
            toggle(
              "disable_signup",
              !ds,
              ds ? "Re-open signups to new users?" : "Disable all new signups?",
            )
          }
        >
          {ds ? "Enable" : "Disable"}
        </button>
      </div>

      <div className={row}>
        <div>
          <p className="text-sm text-fg">Site URL</p>
          <p className="font-mono text-[11px] text-fg-muted">{siteUrl}</p>
        </div>
        <span className="font-mono text-[11px] text-fg-disabled">jwt {jwtExp}s</span>
      </div>

      {err && <p className="px-3 py-2 font-mono text-[11px] text-error">{err}</p>}
    </div>
  );
}
