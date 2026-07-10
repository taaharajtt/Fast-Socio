"use client";

import { useState, useTransition } from "react";
import { field, ctrl } from "@/components/admin/kit";
import { sendBroadcast } from "@/app/admin/broadcast/actions";

export function BroadcastComposer({ departments }: { departments: string[] }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [segment, setSegment] = useState<"all" | "verified">("all");
  const [department, setDepartment] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const valid = title.trim().length > 0 && body.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const target = department ? `${department}` : segment === "verified" ? "verified users" : "all users";
    if (!window.confirm(`Send this announcement to ${target}? It fires a push to everyone subscribed.`))
      return;
    start(async () => {
      const res = await sendBroadcast({
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || undefined,
        segment,
        department: department || undefined,
      });
      if ("error" in res) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: `Sent to ${res.recipients} recipient${res.recipients === 1 ? "" : "s"}.` });
        setTitle("");
        setBody("");
        setUrl("");
      }
    });
  }

  const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[4px] border border-glass-border p-4">
      <div className="space-y-1.5">
        <label className={label}>Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          placeholder="e.g. Maintenance tonight"
          className={`${field} w-full`}
        />
      </div>
      <div className="space-y-1.5">
        <label className={label}>Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={280}
          rows={3}
          placeholder="The message students will see…"
          className="w-full rounded-[3px] border border-glass-border bg-input px-2.5 py-1.5 text-sm text-fg outline-none focus:border-fg-muted"
        />
        <p className="text-right font-mono text-[10px] text-fg-disabled">{body.length}/280</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <label className={label}>Department (optional)</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={`${field} w-full`}
          >
            <option value="">Any department</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={label}>Link (optional)</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/events/…"
            className={`${field} w-full`}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={!valid || pending} className={ctrl}>
          {pending ? "Sending…" : "Send announcement"}
        </button>
        {msg && (
          <p className={`font-mono text-xs ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>
        )}
      </div>
    </form>
  );
}
