"use client";

import { useState, useTransition } from "react";
import { Flag, MoreHorizontal } from "lucide-react";
import { GlassSheet } from "@/components/ui";
import { reportSociety } from "@/app/(student)/societies/actions";

const REASONS = [
  "Impersonation / fake society",
  "Spam or scam",
  "Harassment or hate",
  "Inappropriate content",
  "Other",
];

/** Overflow menu on the society hero: report the society. */
export function SocietyReportButton({ societyId }: { societyId: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(reason: string) {
    setError(null);
    start(async () => {
      const res = await reportSociety(societyId, reason);
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="More"
        onClick={() => {
          setDone(false);
          setError(null);
          setOpen(true);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>

      <GlassSheet open={open} onClose={() => setOpen(false)} label="Report society">
        {done ? (
          <div className="py-6 text-center">
            <Flag className="mx-auto h-8 w-8 text-accent" aria-hidden />
            <p className="mt-3 font-semibold">Thanks for the report</p>
            <p className="mt-1 text-sm text-fg-muted">
              Our moderators will take a look.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 rounded-full bg-card px-6 py-2.5 text-sm font-semibold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold">Report this society</h2>
            <p className="mt-1 text-sm text-fg-muted">Why are you reporting it?</p>
            <div className="mt-4 space-y-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={pending}
                  onClick={() => submit(r)}
                  className="w-full rounded-[12px] bg-card px-4 py-3 text-left text-sm font-medium disabled:opacity-60"
                >
                  {r}
                </button>
              ))}
            </div>
            {error && <p className="mt-3 text-sm text-error">{error}</p>}
          </>
        )}
      </GlassSheet>
    </>
  );
}
