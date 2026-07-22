"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { HelpReportSheet } from "./help-report-sheet";

/** Overflow "report this request" affordance for non-owners on the detail page. */
export function HelpRequestReportButton({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report request"
        className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:text-error"
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
