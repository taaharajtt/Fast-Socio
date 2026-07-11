"use client";

import { useState } from "react";
import { UserCheck, AlertCircle } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { checkInAttendee } from "@/app/(student)/events/actions";

type Log = { id: number; ok: boolean; text: string };

const MESSAGES: Record<string, (name: string | null) => string> = {
  checked_in: (n) => `✓ Checked in ${n ?? "attendee"}`,
  already: (n) => `${n ?? "Attendee"} was already checked in`,
  invalid: () => "Invalid code — not a registration for this event",
  not_authorized: () => "You're not authorized to check people in",
};

/**
 * Organizer check-in console (Refactor Phase 6). Attendees present the code from
 * their pass (QR or the copyable string); the organizer enters it to validate.
 * A camera scanner is deferred (PWA permission constraints) — code entry works
 * offline-first and covers the same flow.
 */
export function CheckInScanner({ eventId }: { eventId: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Log[]>([]);
  const [seq, setSeq] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    const res = await checkInAttendee(eventId, value);
    setBusy(false);

    const entry: Log = res.ok
      ? {
          id: seq,
          ok: res.status === "checked_in",
          text: (MESSAGES[res.status] ?? (() => res.status))(res.name),
        }
      : { id: seq, ok: false, text: res.error };
    setSeq((s) => s + 1);
    setLog((l) => [entry, ...l].slice(0, 20));
    if (res.ok && res.status === "checked_in") setCode("");
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter attendee check-in code"
          autoComplete="off"
          spellCheck={false}
          className="glass h-12 w-full rounded-[var(--radius-md)] px-4 font-mono text-sm text-fg outline-none placeholder:text-fg-muted focus:ring-2 focus:ring-aura/40"
        />
        <GlassButton
          type="submit"
          variant="primary"
          className="w-full"
          disabled={busy || code.trim().length === 0}
        >
          <UserCheck className="mr-2 h-4 w-4" aria-hidden />
          {busy ? "Checking…" : "Check in"}
        </GlassButton>
      </form>

      {log.length > 0 && (
        <ul className="space-y-2">
          {log.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm",
                entry.ok
                  ? "bg-success/10 text-fg"
                  : "bg-warning/10 text-fg"
              )}
            >
              {entry.ok ? (
                <UserCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
              )}
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
