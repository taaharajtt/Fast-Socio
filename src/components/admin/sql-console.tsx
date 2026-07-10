"use client";

import { useState, useTransition } from "react";
import { ctrl, ctrlDanger } from "@/components/admin/kit";
import { runSql, type SqlResult } from "@/app/admin/sql/actions";

export function SqlConsole() {
  const [query, setQuery] = useState("select id, full_name, aura_score from profiles order by aura_score desc limit 20;");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SqlResult | null>(null);

  function run() {
    setResult(null);
    start(async () => {
      setResult(await runSql(query, confirm));
    });
  }

  const rows =
    result && "mode" in result && result.mode === "read" ? result.rows : null;
  const cols = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-3">
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        rows={6}
        className="w-full rounded-[4px] border border-glass-border bg-input px-3 py-2 font-mono text-xs text-fg outline-none focus:border-fg-muted"
        placeholder="select … from …"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={pending} className={ctrl}>
          {pending ? "Running…" : "Run"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
            className="accent-error"
          />
          Confirm writes (required for insert/update/delete/DDL)
        </label>
        {confirm && (
          <span className="font-mono text-[11px] text-error">write mode armed</span>
        )}
      </div>

      {result && "error" in result && (
        <pre className="overflow-x-auto rounded-[4px] border border-error/30 bg-error/5 p-3 font-mono text-[11px] text-error">
          {result.error}
        </pre>
      )}

      {result && "mode" in result && result.mode === "write" && (
        <p className="rounded-[4px] border border-glass-border px-3 py-2 font-mono text-xs text-success">
          OK · {result.affected} row{result.affected === 1 ? "" : "s"} affected.
        </p>
      )}

      {rows && (
        <div className="space-y-1">
          <p className="font-mono text-[11px] text-fg-muted">
            {rows.length} row{rows.length === 1 ? "" : "s"}
            {rows.length === 1000 ? " (capped)" : ""}
          </p>
          {rows.length === 0 ? (
            <p className="rounded-[4px] border border-glass-border px-3 py-2 text-sm text-fg-muted">
              No rows.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[4px] border border-glass-border">
              <table className="w-full border-collapse text-sm" style={{ minWidth: `${cols.length * 130}px` }}>
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th
                        key={c}
                        className="border-b border-glass-border px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-fg-muted"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-glass-border last:border-0">
                      {cols.map((c) => {
                        const v = r[c];
                        const text =
                          v === null || v === undefined
                            ? "null"
                            : typeof v === "object"
                              ? JSON.stringify(v)
                              : String(v);
                        return (
                          <td
                            key={c}
                            className={`whitespace-nowrap px-3 py-2 font-mono text-xs ${
                              v === null || v === undefined ? "text-fg-disabled italic" : "text-fg"
                            }`}
                          >
                            {text.length > 80 ? text.slice(0, 80) + "…" : text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
