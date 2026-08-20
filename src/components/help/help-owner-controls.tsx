"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, RotateCcw, Pencil } from "lucide-react";
import { resolveRequest, reopenRequest } from "@/app/(student)/help/actions";
import type { HelpStatus } from "@/lib/help/logic";

/**
 * Owner (or admin) controls on the detail page: edit an open request, mark it
 * resolved, or reopen it. Selecting a helper lives on the response cards.
 */
export function HelpOwnerControls({
  requestId,
  status,
  canEdit,
}: {
  requestId: string;
  status: HelpStatus;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-6">
      <p className="text-xs font-medium text-fg-muted">Your request</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {status === "open" ? (
          <button
            type="button"
            onClick={() => run(() => resolveRequest(requestId))}
            disabled={pending}
            className="pressable focus-ring flex items-center gap-1.5 rounded-[10px] bg-success/15 px-4 py-2 text-sm font-semibold text-success disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Mark resolved
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run(() => reopenRequest(requestId))}
            disabled={pending}
            className="pressable focus-ring flex items-center gap-1.5 rounded-[10px] bg-fill px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Reopen
          </button>
        )}
        {canEdit && (
          <Link
            href={`/help/${requestId}/edit`}
            className="pressable focus-ring flex items-center gap-1.5 rounded-[10px] bg-fill px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg"
          >
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </Link>
        )}
      </div>
      {status === "open" && (
        <p className="mt-2.5 text-xs text-fg-muted">
          Someone helped? Pick their response below to resolve and thank them.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
