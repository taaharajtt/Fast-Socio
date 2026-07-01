"use client";

import { useState } from "react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { cn } from "@/lib/utils";
import { reportProfile } from "@/app/(student)/discover/actions";
import type { DiscoverProfile } from "@/lib/profile/types";

const REASONS = [
  "Fake or impersonation",
  "Inappropriate photos",
  "Harassment or hate",
  "Spam or scam",
  "Underage",
  "Other",
];

/**
 * Report sheet (UI Spec §5: reason list as radio-style glass rows, optional
 * text, submit CTA in Error color). Files into the polymorphic reports table.
 */
export function ReportSheet({
  profile,
  onClose,
}: {
  profile: DiscoverProfile | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!profile || !reason) return;
    setPending(true);
    setError(null);
    const res = await reportProfile(profile.id, reason, details || undefined);
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
    <GlassSheet open={Boolean(profile)} onClose={onClose}>
      <div className="space-y-3">
        <h3 className="text-lg font-bold">Report profile</h3>
        <p className="text-sm text-fg-muted">
          Why are you reporting {profile?.full_name ?? "this profile"}?
        </p>
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
