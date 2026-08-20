"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { HelpReportSheet } from "./help-report-sheet";

/**
 * "Report this request" — the only destructive-semantics control on the Campus
 * Help detail page, and therefore the only red one. Bare glyph, no well: the
 * colour already says what it is, and a surface under it would give a
 * secondary action the weight of a primary one.
 */
export function HelpRequestReportButton({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report request"
        className="pressable focus-ring flex h-9 w-9 items-center justify-center rounded-full text-error transition-colors hover:bg-error/10"
      >
        <Flag className="h-4 w-4" aria-hidden />
      </button>
      <HelpReportSheet
        open={open}
        onClose={() => setOpen(false)}
        targetType="help_request"
        targetId={requestId}
        targetLabel="request"
      />
    </>
  );
}
