"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { HandHeart, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { respondToHelp } from "@/app/(student)/help/actions";

/**
 * Response composer for a help request. Two ways to help: a one-tap "I can help"
 * offer, or a written answer. Shown only when the viewer can actually respond
 * (signed in, not the author, request open) — that gate is decided server-side.
 */
export function HelpResponseComposer({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function send(kind: "offer" | "answer") {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await respondToHelp(requestId, kind === "answer" ? body : "", kind);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      setDone(kind === "offer" ? "Offer sent 🙌" : "Response posted");
      router.refresh();
    });
  }

  return (
    <div className="glass rounded-[14px] p-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 2000))}
        placeholder="Write a response — share notes, a tip, or how you can help…"
        rows={3}
        className="w-full resize-none bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => send("offer")}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-sm font-semibold text-fg-muted transition-colors hover:text-fg disabled:opacity-60"
        >
          <HandHeart className="h-4 w-4" aria-hidden /> I can help
        </button>
        <button
          type="button"
          onClick={() => send("answer")}
          disabled={pending || body.trim().length === 0}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40",
            "gradient-brand"
          )}
        >
          <Send className="h-4 w-4" aria-hidden /> Respond
        </button>
      </div>
      {done && <p className="mt-2 text-sm text-success">{done}</p>}
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
