"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { GlassButton, GlassSheet } from "@/components/ui";
import { sendMessageRequest } from "@/app/(student)/chat/actions";
import {
  MESSAGE_REQUEST_MAX,
  validateMessageRequest,
} from "@/lib/chat/message-request";

/**
 * The one composer behind both first-contact entry points (UAT-01).
 *
 * Discover's person card and the profile page render DIFFERENT triggers — a
 * message bubble on the card, a labelled button on the profile — but the sheet,
 * the 250-character rule, the disabled states, the success copy and the error
 * mapping are this component's, once. That is the whole point: the two paths
 * cannot behave differently because there is only one implementation of the
 * behaviour.
 *
 * The send is idempotent server-side, so the guard here is about the UI not
 * looking broken on a double tap, not about correctness.
 */
export function RequestToChatSheet({
  open,
  name,
  recipientId,
  onClose,
}: {
  open: boolean;
  name: string | null;
  recipientId: string | null;
  onClose: () => void;
}) {
  return (
    <GlassSheet open={open} onClose={onClose}>
      {/* The form is a CHILD keyed by recipient, and it is only mounted while
          the sheet is open.
          That is the reset: a sheet reopened for someone else mounts a fresh
          component with fresh state, rather than an effect racing to clear the
          previous recipient's draft after the first paint — the same stale
          -modal-state failure UAT-13 is about for the composer's anonymity
          toggle, and one an effect can only ever paper over. */}
      {open && recipientId && (
        <RequestForm
          key={recipientId}
          name={name}
          recipientId={recipientId}
          onClose={onClose}
        />
      )}
    </GlassSheet>
  );
}

function RequestForm({
  name,
  recipientId,
  onClose,
}: {
  name: string | null;
  recipientId: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const check = validateMessageRequest(message);
  const tooLong = message.trim().length > MESSAGE_REQUEST_MAX;

  async function send() {
    if (!recipientId || sending || sent) return;
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setSending(true);
    setError(null);
    const res = await sendMessageRequest(recipientId, message);
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(true);
    setMessage("");
    setTimeout(() => {
      setSent(false);
      onClose();
    }, 1200);
  }

  return (
    <div className="space-y-3">
      <h3 className="type-title">Request to chat</h3>
        <p className="type-callout text-fg-muted">
          Send {name ?? "them"} a short opening message. They&apos;ll see it in
          Requests and can accept or decline — the chat opens only if they accept.
        </p>
        <textarea
          // A textarea rather than a single-line input: 250 characters is a
          // paragraph on a phone, and a one-line field hides everything but the
          // tail of what you wrote while you are writing it.
          aria-label="Your message"
          placeholder="Hey! We're both in the robotics society…"
          value={message}
          rows={3}
          // No `maxLength`: hard-truncating at the cap silently eats keystrokes.
          // The counter turns red and the button disables instead, so the reason
          // the send is unavailable is visible.
          onChange={(e) => setMessage(e.target.value)}
          disabled={sending || sent}
          className="focus-ring w-full resize-none rounded-[14px] bg-fill px-3.5 py-3 text-[15px] text-fg placeholder:text-fg-disabled disabled:opacity-60"
        />
        <div className="flex items-center justify-between">
          <span
            className={`text-xs ${tooLong ? "text-error" : "text-fg-muted"}`}
            aria-live="polite"
          >
            {message.trim().length}/{MESSAGE_REQUEST_MAX}
          </span>
          <GlassButton
            size="md"
            onClick={send}
            disabled={sending || sent || !check.ok}
          >
            {sent ? "Sent ✓" : sending ? "Sending…" : "Send request"}
          </GlassButton>
        </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The profile page's entry point (UAT-01, path 2).
 *
 * Replaces the inert "Match to chat" caption, which told a student what they
 * could not do and offered no way to do it. First contact never required a
 * match — `message_requests` has been the intended path since mig 0004 — the
 * profile simply never surfaced it.
 */
export function RequestToChatButton({
  recipientId,
  name,
}: {
  recipientId: string;
  name: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable focus-ring flex shrink-0 items-center gap-1.5 rounded-[10px] bg-fill px-4 py-2 text-sm font-semibold text-fg"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        Request to chat
      </button>
      <RequestToChatSheet
        open={open}
        name={name}
        recipientId={recipientId}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
