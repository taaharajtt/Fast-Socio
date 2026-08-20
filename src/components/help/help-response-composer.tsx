"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { AnonymousToggle } from "@/components/ui/composer-action";
import { GlassButton } from "@/components/ui/glass-button";
import { respondToHelp } from "@/app/(student)/help/actions";

/**
 * Offer-help composer: a textarea, the shared Anonymous toggle, and a single
 * "Respond" button — no "I can help" shortcut. Shown only when the viewer can
 * actually respond (signed in, not the author, request open); that gate is
 * decided server-side. Responding anonymously hides the helper's identity from
 * the seeker (school + semester still show), while their id is kept server-side.
 *
 * The Anonymous control is `AnonymousToggle`, the same component the home
 * composer uses — this screen used to draw its own crossed-out-eye capsule, so
 * the one switch that decides whether your name is attached looked like two
 * different features depending on where you met it.
 *
 * Respond is the brand purple, and it is the only coloured thing in here: the
 * well around it stays neutral, and the disabled state drops to an inert grey
 * fill rather than a dimmed purple, so "nothing to send yet" and "send this"
 * are not the same button at two brightnesses.
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
    <div className="rounded-[14px] border border-glass-border bg-input p-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 2000))}
        placeholder="Write a response — share notes, a tip, or how you can help…"
        rows={3}
        className="w-full resize-none bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <AnonymousToggle
          pressed={anonymous}
          onToggle={() => setAnonymous((v) => !v)}
        />
        <GlassButton
          size="sm"
          variant="brand"
          className="shrink-0"
          onClick={respond}
          disabled={pending || body.trim().length === 0}
        >
          <Send className="h-4 w-4" aria-hidden /> Respond
        </GlassButton>
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
