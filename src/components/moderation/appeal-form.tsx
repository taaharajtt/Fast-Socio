"use client";

import { useState, useTransition } from "react";
import { GlassButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { submitAppeal } from "@/app/(student)/appeals/actions";

const SUBJECTS: { key: string; label: string }[] = [
  { key: "posting_restriction", label: "Posting restriction" },
  { key: "suspension", label: "Suspension" },
  { key: "strike", label: "Warning / strike" },
  { key: "content", label: "Removed content" },
  { key: "shadow_ban", label: "Reduced reach" },
  { key: "ban", label: "Ban" },
];

export function AppealForm() {
  const [subject, setSubject] = useState("");
  const [explanation, setExplanation] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const valid = subject && explanation.trim().length >= 10;

  function submit() {
    setMsg(null);
    start(async () => {
      const res = await submitAppeal({ subject, explanation });
      if (res.ok) {
        setMsg({ ok: true, text: "Appeal submitted. We'll review it soon." });
        setExplanation("");
        setSubject("");
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-card)] bg-card p-5 space-y-3">
      <p className="text-sm font-semibold text-fg">File an appeal</p>
      <div className="flex flex-wrap gap-2">
        {SUBJECTS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={subject === s.key}
            onClick={() => setSubject(s.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              subject === s.key ? "bg-aura text-white" : "glass text-fg-muted"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <textarea
        value={explanation}
        onChange={(e) => setExplanation(e.target.value.slice(0, 1000))}
        rows={4}
        placeholder="Explain why this action should be reconsidered…"
        className="w-full resize-none rounded-[var(--radius-md)] bg-input-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
      />
      <GlassButton size="sm" onClick={submit} disabled={pending || !valid}>
        {pending ? "Submitting…" : "Submit appeal"}
      </GlassButton>
      {msg && (
        <p className={msg.ok ? "text-sm text-success" : "text-sm text-error"}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
