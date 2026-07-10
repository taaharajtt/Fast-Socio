"use client";

import { useState, useTransition } from "react";
import { Tag, ctrlDanger } from "@/components/admin/kit";
import { unmatch, deleteRequest } from "@/app/admin/matching/actions";

function useAction() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error: string } | void>, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return;
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res?.error) setErr(res.error);
    });
  };
  return { pending, err, run };
}

export function MatchRow({
  match,
}: {
  match: { id: string; a: string; b: string; createdAt: string };
}) {
  const { pending, err, run } = useAction();
  return (
    <div className="flex items-center justify-between gap-3 rounded-[4px] border border-glass-border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm text-fg">
          {match.a} <span className="text-fg-muted">↔</span> {match.b}
        </p>
        <p className="font-mono text-[11px] text-fg-muted">{match.createdAt}</p>
        {err && <p className="font-mono text-[11px] text-error">{err}</p>}
      </div>
      <button
        className={ctrlDanger}
        disabled={pending}
        onClick={() => run(() => unmatch(match.id), "Break this match? Both users lose the connection. Logged.")}
      >
        Unmatch
      </button>
    </div>
  );
}

export function RequestRow({
  request,
}: {
  request: { id: string; sender: string; recipient: string; message: string | null; status: string; createdAt: string };
}) {
  const { pending, err, run } = useAction();
  return (
    <div className="flex items-start justify-between gap-3 rounded-[4px] border border-glass-border p-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
          {request.sender} <span className="text-fg-muted">→</span> {request.recipient}
          <Tag>{request.status}</Tag>
        </p>
        {request.message && <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{request.message}</p>}
        <p className="mt-1 font-mono text-[11px] text-fg-muted">{request.createdAt}</p>
        {err && <p className="font-mono text-[11px] text-error">{err}</p>}
      </div>
      <button
        className={ctrlDanger}
        disabled={pending}
        onClick={() => run(() => deleteRequest(request.id), "Delete this message request? Logged.")}
      >
        Delete
      </button>
    </div>
  );
}
