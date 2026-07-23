"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Send, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { respondToHelp } from "@/app/(student)/help/actions";

/**
 * Offer-help composer: a textarea, an "Anonymous" capsule toggle, and a single
 * "Respond" button — no "I can help" shortcut. Shown only when the viewer can
 * actually respond (signed in, not the author, request open); that gate is
 * decided server-side. Responding anonymously hides the helper's identity from
 * the seeker (school + semester still show), while their id is kept server-side.
 */
export function HelpResponseComposer({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function respond() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await respondToHelp(requestId, body, "answer", anonymous);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      setAnonymous(false);
      setDone("Response sent");
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
          role="switch"
          aria-checked={anonymous}
          onClick={() => setAnonymous((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-all active:scale-95",
            anonymous ? "bg-aura text-white" : "bg-card text-fg-muted hover:text-fg"
          )}
        >
          <EyeOff className="h-4 w-4" aria-hidden /> Anonymous
        </button>
        <button
          type="button"
          onClick={respond}
          disabled={pending || body.trim().length === 0}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40",
            "gradient-brand"
          )}
        >
          <Send className="h-4 w-4" aria-hidden /> Respond
        </button>
      </div>
      {anonymous && (
        <p className="mt-2 text-xs text-fg-muted">
          The seeker will see only your school and semester, not your name.
        </p>
      )}
      {done && <p className="mt-2 text-sm text-success">{done}</p>}
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
