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
  return (
    <GlassSheet
      open={Boolean(profile)}
      onClose={onClose}
      label="Report profile"
      className="flex max-h-[75vh] flex-col"
    >
      {/* Mounts fresh each time the sheet opens, so state starts clean. */}
      {profile && <ReportSheetContent profile={profile} onClose={onClose} />}
    </GlassSheet>
  );
}

function ReportSheetContent({
  profile,
  onClose,
}: {
  profile: DiscoverProfile;
  onClose: () => void;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <h3 className="shrink-0 text-lg font-bold">Report profile</h3>
      <p className="mt-1 shrink-0 text-sm text-fg-muted">
        Why are you reporting {profile.full_name ?? "this profile"}?
      </p>
      {/* Keeps finger-scrolling while the sheet panel claims the drag gesture. */}
      <div data-sheet-scroll className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
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
      <div className="shrink-0 pt-3">
        <GlassButton
          variant="danger"
          size="lg"
          className="w-full"
          disabled={!reason || pending || done}
          onClick={submit}
        >
          {done ? "Reported ✓" : pending ? "Submitting…" : "Submit report"}
        </GlassButton>
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
      </div>
    </div>
  );
}
