"use client";

import { useState } from "react";
import { QrCode, Copy, Check } from "lucide-react";

/**
 * The attendee's check-in pass (Refactor Phase 6): a QR of their unguessable
 * per-registration code plus the code in copyable text (organizers who can't
 * scan can type it into the check-in page). `checkedIn` flips it to a
 * confirmation state.
 */
export function EventTicket({
  qrDataUrl,
  code,
  checkedIn,
}: {
  qrDataUrl: string | null;
  code: string;
  checkedIn: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the code is still visible to type */
    }
  }

  if (checkedIn) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-success/10 p-4 ring-1 ring-success/30">
        <Check className="h-5 w-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-fg">Checked in</p>
          <p className="text-xs text-fg-muted">Enjoy the event!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
        <QrCode className="h-4 w-4 text-accent" aria-hidden />
        Your check-in pass
      </div>
      {qrDataUrl && (
        <div className="mx-auto w-fit rounded-2xl bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI QR */}
          <img
            src={qrDataUrl}
            alt="Check-in QR code"
            width={200}
            height={200}
            className="h-[200px] w-[200px]"
          />
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        className="mx-auto mt-3 flex items-center gap-2 rounded-full bg-bg-elevated px-3 py-1.5 font-mono text-xs text-fg-muted"
        aria-label="Copy check-in code"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
        {code}
      </button>
      <p className="mt-3 text-center text-xs text-fg-muted">
        Show this to the organizer to check in.
      </p>
    </div>
  );
}
