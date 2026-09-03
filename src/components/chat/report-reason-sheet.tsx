"use client";

import { useState } from "react";
import { Check, Flag } from "lucide-react";
import { GlassSheet } from "@/components/ui";

/**
 * Pick a reason and file a report on one message.
 *
 * The same five reasons the feed offers, so a moderator's queue is one
 * vocabulary rather than three. Direct messages deliberately do NOT use this:
 * a DM report carries selected message EVIDENCE and has its own review step
 * (`report-review.tsx`, mig 0161), because a moderator cannot read a DM
 * thread. A room, event or broadcast message is already visible to a
 * moderator, so the reason alone is enough.
 */
const REPORT_REASONS = [
  "Harassment or hate",
  "Inappropriate content",
  "Spam or scam",
  "Misinformation",
  "Other",
];

export function ReportReasonSheet({
  open,
  onClose,
  onSubmit,
  title = "Report message",
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    reason: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  title?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);

  async function file(reason: string) {
    if (busy) return;
    setBusy(reason);
    setError(null);
    const res = await onSubmit(reason);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setFiled(true);
  }

  return (
    <GlassSheet
      open={open}
      onClose={() => {
        onClose();
        // Reset for the next message rather than in an effect, which would
        // set state during a render pass the repo's lint rule forbids.
        setFiled(false);
        setError(null);
      }}
      label={title}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Flag className="h-5 w-5 text-error" aria-hidden />
          <h3 className="text-lg font-bold">{title}</h3>
        </div>

        {filed ? (
          <p className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-card px-4 py-3 text-sm text-fg">
            <Check className="h-4 w-4 text-success" aria-hidden />
            Thanks — a moderator will take a look.
          </p>
        ) : (
          <>
            {REPORT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => file(r)}
                className="glass flex w-full items-center rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm text-fg disabled:opacity-60"
              >
                {busy === r ? "Reporting…" : r}
              </button>
            ))}
            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </GlassSheet>
  );
}
