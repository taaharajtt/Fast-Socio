"use client";

import { useState } from "react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { cn } from "@/lib/utils";
import { reportHelp } from "@/app/(student)/help/actions";

const REASONS = [
  "Spam or advertising",
  "Harassment or hate",
  "Inappropriate content",
  "Scam or misleading",
  "Wrong category / off-topic",
  "Other",
];

/**
 * Report a help request or response into the shared moderation queue. Same
 * radio-row pattern as the Discover report sheet (UI Spec §5).
 */
export function HelpReportSheet({
  open,
  onClose,
  targetType,
  targetId,
  targetLabel,
}: {
  open: boolean;
  onClose: () => void;
  targetType: "help_request" | "help_response";
  targetId: string;
  targetLabel: string;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason) return;
    setPending(true);
    setError(null);
    const res = await reportHelp(targetType, targetId, reason, details || undefined);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
    setTimeout(() => {
      setDone(false);
      setReason(null);
      setDetails("");
      onClose();
    }, 1200);
  }

  return (
    <GlassSheet open={open} onClose={onClose} label="Report">
      <div className="space-y-3">
        <h3 className="text-lg font-bold">Report {targetLabel}</h3>
        <p className="text-sm text-fg-muted">Why are you reporting this?</p>
        <div className="space-y-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn(
                "flex w-full items-center justify-between rounded-[var(--radius-sm)] px-4 py-3 text-left text-sm transition-colors",
                reason === r ? "glass-strong text-fg" : "glass text-fg-muted"
              )}
            >
              {r}
              <span
                className={cn(
                  "h-4 w-4 rounded-full border",
                  reason === r ? "border-error bg-error" : "border-fg-muted"
                )}
              />
            </button>
          ))}
        </div>
        <GlassButton
          variant="danger"
          size="lg"
          className="w-full"
          disabled={!reason || pending || done}
          onClick={submit}
        >
          {done ? "Reported ✓" : pending ? "Submitting…" : "Submit report"}
        </GlassButton>
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    </GlassSheet>
  );
}
