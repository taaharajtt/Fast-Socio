"use client";

import { useState, useTransition } from "react";
import { field, ctrl, ctrlDanger } from "@/components/admin/kit";
import { saveEnvVar, removeEnvVar } from "@/app/admin/infra/actions";

export type EnvRow = { id: string; key: string; targets: string[] };

const TARGETS = ["production", "preview", "development"] as const;

/** Env vars are write-only here: values are encrypted by Vercel and never read back. */
export function InfraEnvEditor({ envs }: { envs: EnvRow[] }) {
  const [pending, start] = useTransition();
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const [targets, setTargets] = useState<string[]>(["production"]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await saveEnvVar(k.trim(), v, targets);
      if ("error" in res) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: `Saved ${k.trim()}. Redeploy for it to take effect.` });
        setK("");
        setV("");
      }
    });
  }

  function remove(row: EnvRow) {
    if (!window.confirm(`Delete env var ${row.key}? This is logged.`)) return;
    setMsg(null);
    start(async () => {
      const res = await removeEnvVar(row.id, row.key);
      if ("error" in res) setMsg({ ok: false, text: res.error });
      else setMsg({ ok: true, text: `Deleted ${row.key}.` });
    });
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-glass-border overflow-hidden rounded-[4px] border border-glass-border">
        {envs.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-fg">{e.key}</p>
              <p className="font-mono text-[10px] text-fg-disabled">{e.targets.join(", ")}</p>
            </div>
            <button type="button" disabled={pending} className={ctrlDanger} onClick={() => remove(e)}>
              Delete
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="space-y-2 rounded-[4px] border border-glass-border p-3">
        <div className="flex flex-wrap gap-2">
          <input
            value={k}
            onChange={(e) => setK(e.target.value)}
            placeholder="KEY"
            className={`${field} flex-1 font-mono`}
          />
          <input
            value={v}
            onChange={(e) => setV(e.target.value)}
            type="password"
            placeholder="value (write-only)"
            className={`${field} flex-1`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {TARGETS.map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={targets.includes(t)}
                onChange={(e) =>
                  setTargets((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)))
                }
              />
              {t}
            </label>
          ))}
          <button type="submit" disabled={pending || !k.trim() || !v} className={`${ctrl} ml-auto`}>
            {pending ? "Saving…" : "Save env var"}
          </button>
        </div>
        {msg && <p className={`font-mono text-[11px] ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
      </form>
    </div>
  );
}
