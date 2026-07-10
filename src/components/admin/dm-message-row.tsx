"use client";

import { useState, useTransition } from "react";
import { ctrlDanger } from "@/components/admin/kit";
import { deleteMessage } from "@/app/admin/content/actions";

export type DmMessage = {
  id: string;
  sender_id: string | null;
  sender: string;
  body: string | null;
  attachment_type: string | null;
  attachment_url: string | null;
  shared_post_id: string | null;
  hidden: boolean;
  created_at: string;
};

export function DmMessageRow({
  msg,
  conversationId,
}: {
  msg: DmMessage;
  conversationId: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function remove() {
    if (!window.confirm("Delete this message? This is logged.")) return;
    setErr(null);
    start(async () => {
      const res = await deleteMessage(msg.id, conversationId);
      if ("error" in res) setErr(res.error);
    });
  }

  return (
    <div className={`rounded-[4px] border border-glass-border p-3 ${msg.hidden ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg">
            {msg.sender}
            {msg.hidden && <span className="ml-2 font-mono text-[10px] uppercase text-warning">hidden</span>}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">
            {msg.body || <span className="text-fg-disabled italic">— no text —</span>}
            {msg.attachment_type && (
              <span className="ml-2 font-mono text-[11px] text-fg-muted">[{msg.attachment_type}]</span>
            )}
            {msg.shared_post_id && (
              <span className="ml-2 font-mono text-[11px] text-fg-muted">[shared post]</span>
            )}
          </p>
          <p className="mt-1 font-mono text-[11px] text-fg-muted">
            {`${msg.created_at.slice(0, 16).replace("T", " ")} UTC`}
          </p>
          {err && <p className="mt-1 font-mono text-[11px] text-error">{err}</p>}
        </div>
        <button type="button" onClick={remove} disabled={pending} className={ctrlDanger}>
          Delete
        </button>
      </div>
    </div>
  );
}
