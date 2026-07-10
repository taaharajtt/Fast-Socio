"use client";

import { useState, useTransition } from "react";
import { Tag, ctrl, ctrlDanger } from "@/components/admin/kit";
import { setHidden, deleteContent, type ContentType } from "@/app/admin/content/actions";

export type ContentItem = {
  id: string;
  author_id: string | null;
  author: string;
  body: string | null;
  created_at: string;
  hidden: boolean;
  context: string;
  extra: Record<string, unknown>;
};

function ts(iso: string) {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function ContentRow({ item, type }: { item: ContentItem; type: ContentType }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const canHide = type !== "community";

  function toggleHide() {
    setErr(null);
    start(async () => {
      const res = await setHidden(type, item.id, !item.hidden);
      if ("error" in res) setErr(res.error);
    });
  }
  function remove() {
    if (!window.confirm(`Delete this ${type}? This is logged and cannot be undone.`)) return;
    setErr(null);
    start(async () => {
      const res = await deleteContent(type, item.id);
      if ("error" in res) setErr(res.error);
    });
  }

  const likes = item.extra?.likes as number | undefined;
  const comments = item.extra?.comments as number | undefined;
  const attachment = item.extra?.attachment as string | undefined;

  return (
    <div
      className={`rounded-[4px] border border-glass-border p-3 ${item.hidden ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-fg">{item.author}</span>
            <Tag>{item.context}</Tag>
            {item.hidden && <span className="font-mono text-[10px] uppercase text-warning">hidden</span>}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">
            {item.body || <span className="text-fg-disabled italic">— no text —</span>}
            {attachment && (
              <span className="ml-2 font-mono text-[11px] text-fg-muted">[{attachment}]</span>
            )}
          </p>
          <p className="mt-1 font-mono text-[11px] text-fg-muted">
            {ts(item.created_at)}
            {likes !== undefined && ` · ♥ ${likes} · 💬 ${comments}`}
          </p>
          {err && <p className="mt-1 font-mono text-[11px] text-error">{err}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {canHide && (
            <button type="button" onClick={toggleHide} disabled={pending} className={ctrl}>
              {item.hidden ? "Unhide" : "Hide"}
            </button>
          )}
          <button type="button" onClick={remove} disabled={pending} className={ctrlDanger}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
