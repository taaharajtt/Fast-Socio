"use client";

import { useState, useTransition } from "react";
import { ctrl } from "@/components/admin/kit";
import { setReportedMessageHidden } from "@/app/admin/dm-reports/actions";
import type { Evidence } from "@/app/admin/dm-reports/[id]/page";

/**
 * One disclosed message.
 *
 * The tombstone control is scoped to this case: the RPC behind it refuses any
 * message that is not evidence in this report, so it is not a general "hide any
 * DM" button. It also cannot un-send: hiding removes the message from both
 * participants' threads and does nothing about screenshots, notifications
 * already delivered, offline clients, or backups. The copy below says so
 * rather than implying a deletion the product cannot perform.
 */
export function EvidenceRow({
  reportId,
  evidence,
  signedUrl,
}: {
  reportId: string;
  evidence: Evidence;
  signedUrl: string | null;
}) {
  const [hidden, setHidden] = useState(evidence.source_hidden ?? false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const gone = evidence.source_message_id === null;

  function toggle() {
    if (!evidence.source_message_id) return;
    const next = !hidden;
    if (
      next &&
      !window.confirm(
        "Hide this message from both participants? It will disappear from their threads. This cannot retract screenshots, delivered notifications, or backups.",
      )
    )
      return;
    setErr(null);
    start(async () => {
      const res = await setReportedMessageHidden(
        reportId,
        evidence.source_message_id!,
        next,
      );
      if (res.ok) setHidden(next);
      else setErr(res.error);
    });
  }

  return (
    <div className="rounded-[4px] border border-glass-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] text-fg-muted">
            <span className="font-semibold text-fg">{evidence.sender_name}</span>
            {" → "}
            {evidence.recipient_name} ·{" "}
            {evidence.original_created_at.slice(0, 16).replace("T", " ")} UTC
            {hidden && (
              <span className="ml-2 uppercase text-warning">hidden</span>
            )}
          </p>

          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">
            {evidence.body || (
              <span className="italic text-fg-disabled">— no text —</span>
            )}
          </p>

          {evidence.attachment_type && (
            <p className="mt-1.5">
              {signedUrl ? (
                evidence.attachment_type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={signedUrl}
                    alt="Disclosed attachment"
                    className="max-h-64 rounded-[4px]"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <audio src={signedUrl} controls className="w-full max-w-xs" />
                )
              ) : (
                <span className="font-mono text-[11px] text-fg-muted">
                  [{evidence.attachment_type} · unavailable]
                </span>
              )}
            </p>
          )}

          {evidence.shared_post_id && (
            <p className="mt-1 font-mono text-[11px] text-fg-muted">
              [shared post {evidence.shared_post_id.slice(0, 8)}]
            </p>
          )}

          {gone && (
            <p className="mt-1 font-mono text-[11px] text-fg-muted">
              Original message row no longer exists; this snapshot is retained.
            </p>
          )}

          {err && <p className="mt-1 font-mono text-[11px] text-error">{err}</p>}
        </div>

        {!gone && (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            className={ctrl}
          >
            {hidden ? "Restore" : "Hide"}
          </button>
        )}
      </div>
    </div>
  );
}
