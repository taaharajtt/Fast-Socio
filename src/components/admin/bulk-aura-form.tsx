"use client";

import { useState, useTransition } from "react";
import { field, ctrl } from "@/components/admin/kit";
import { bulkAura } from "@/app/admin/aura/actions";

export function BulkAuraForm({ departments }: { departments: string[] }) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [segment, setSegment] = useState<"all" | "verified">("all");
  const [department, setDepartment] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const parsed = parseInt(delta, 10);
  const valid = !Number.isNaN(parsed) && parsed !== 0 && reason.trim().length >= 3;
  const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const target = department || (segment === "verified" ? "verified users" : "all users");
    if (!window.confirm(`Apply ${parsed > 0 ? "+" : ""}${parsed} aura to ${target}? This is audited per user.`))
      return;
    start(async () => {
      const res = await bulkAura({
        delta: parsed,
        reason: reason.trim(),
        segment,
        department: department || undefined,
      });
      if ("error" in res) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: `Applied to ${res.count} user${res.count === 1 ? "" : "s"}.` });
        setDelta("");
        setReason("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[4px] border border-glass-border p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <label className={label}>Delta (+/-)</label>
          <input
            type="number"
            inputMode="numeric"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. 25"
            className={`${field} w-full`}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-3">
          <label className={label}>
            Reason <span className="text-error">*</span>
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required — logged per user"
            className={`${field} w-full`}
          />
        </div>
        <div className="space-y-1.5">
          <label className={label}>Segment</label>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as "all" | "verified")}
            className={`${field} w-full`}
          >
            <option value="all">All users</option>
            <option value="verified">Verified only</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={label}>Department</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={`${field} w-full`}
          >
            <option value="">Any</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!valid || pending} className={ctrl}>
          {pending ? "Applying…" : "Apply bulk aura"}
        </button>
        {msg && <p className={`font-mono text-xs ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}
