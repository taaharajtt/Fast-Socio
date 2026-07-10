"use client";

import { useState, useTransition } from "react";
import { ctrl, ctrlDanger } from "@/components/admin/kit";
import { redeployTo } from "@/app/admin/infra/actions";

export type DeployRow = {
  uid: string;
  readyState: string;
  created: string;
  sha: string;
  message: string;
  isLatest: boolean;
};

export function InfraDeployControls({ deployments }: { deployments: DeployRow[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function go(d: DeployRow) {
    const rollback = !d.isLatest;
    if (
      !window.confirm(
        rollback
          ? `Roll back production to ${d.sha} ("${d.message}")? This redeploys that build.`
          : `Redeploy the latest production build (${d.sha})?`,
      )
    )
      return;
    setMsg(null);
    setBusy(d.uid);
    start(async () => {
      const res = await redeployTo(d.uid, rollback ? `rollback to ${d.sha}` : `redeploy ${d.sha}`);
      setBusy(null);
      if ("error" in res) setMsg({ ok: false, text: res.error });
      else setMsg({ ok: true, text: `Triggered — new production deploy building for ${d.sha}.` });
    });
  }

  return (
    <div className="space-y-2">
      {msg && (
        <p className={`font-mono text-xs ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>
      )}
      {deployments.map((d) => (
        <div key={d.uid} className="flex items-center justify-between gap-3 rounded-[4px] border border-glass-border p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-mono text-xs">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  d.readyState === "READY" ? "bg-success" : d.readyState === "ERROR" ? "bg-error" : "bg-warning"
                }`}
              />
              <span className="text-fg">{d.sha}</span>
              {d.isLatest && <span className="text-fg-muted">· current</span>}
            </p>
            <p className="mt-0.5 truncate text-xs text-fg-muted">{d.message}</p>
            <p className="font-mono text-[11px] text-fg-disabled">{d.created}</p>
          </div>
          <button
            type="button"
            disabled={pending || d.readyState !== "READY"}
            onClick={() => go(d)}
            className={d.isLatest ? ctrl : ctrlDanger}
          >
            {busy === d.uid ? "…" : d.isLatest ? "Redeploy" : "Rollback"}
          </button>
        </div>
      ))}
    </div>
  );
}
