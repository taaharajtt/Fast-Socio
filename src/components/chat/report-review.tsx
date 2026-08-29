"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, ShieldAlert, X } from "lucide-react";
import { GlassButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { absoluteTime } from "@/lib/time";
import {
  DISCLOSURE_NOTICE,
  DM_REPORT_CATEGORIES,
  MAX_DESCRIPTION_LENGTH,
  MIN_DESCRIPTION_LENGTH,
  evidenceSummary,
  validateDescription,
} from "@/lib/chat/dm-report";
import { submitDmReport } from "@/app/(student)/chat/report-actions";

export type ReviewMessage = {
  id: string;
  body: string | null;
  attachment_type: "image" | "voice" | null;
  shared_post_id: string | null;
  created_at: string;
  senderLabel: string;
};

/**
 * The review-and-confirm step of a selective DM report.
 *
 * A full-screen dialog rather than a GlassSheet: the sheet has been unreliable
 * in this codebase (see the Discover create/edit flow, which moved to its own
 * page for the same reason), and this is the last screen before an
 * irreversible disclosure — it is the wrong place for a component that
 * sometimes fails to open. It is not a route either, because that would put ten
 * message ids in the URL; keeping it in-component keeps the selection in memory.
 */
export function ReportReview({
  conversationId,
  messages,
  onClose,
  onSubmitted,
}: {
  conversationId: string;
  /** The reporter's selection, in thread order. */
  messages: ReviewMessage[];
  onClose: () => void;
  onSubmitted: (reportId: string) => void;
}) {
  const [category, setCategory] = useState<string>("");
  const [description, setDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const headingId = useId();
  const noticeId = useId();
  const descId = useId();
  const errorId = useId();

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Guards against a double submit that beats the `submitting` re-render — a
  // fast double-tap on a slow connection. The RPC's unique index is the real
  // backstop; this stops the second request being sent at all.
  const sentRef = useRef(false);

  const trimmed = description.trim();
  const descriptionState = validateDescription(description);
  const canSubmit =
    Boolean(category) && descriptionState.ok && confirmed && !submitting;

  // Move focus into the dialog on open so a keyboard or screen-reader user is
  // not left behind in the thread underneath.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
      if (e.key !== "Tab") return;
      // Focus trap: this dialog covers an interactive thread, so tabbing out of
      // it would land on controls the user cannot see.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  async function submit() {
    setTouched(true);
    if (!canSubmit || sentRef.current) return;
    sentRef.current = true;
    setSubmitting(true);
    setError(null);

    const res = await submitDmReport({
      conversationId,
      messageIds: messages.map((m) => m.id),
      category,
      description: trimmed,
    });

    if (res.ok) {
      onSubmitted(res.reportId);
      return;
    }
    // Let them fix the problem and try again — the report was not filed.
    sentRef.current = false;
    setSubmitting(false);
    setError(res.error);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-center bg-bg/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      aria-describedby={noticeId}
    >
      <div
        ref={dialogRef}
        className="flex h-full w-full max-w-md flex-col overflow-hidden px-4"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-glass-border py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cancel report"
            className="glass focus-ring flex h-9 w-9 items-center justify-center rounded-full text-fg-muted disabled:opacity-40"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="truncate font-semibold">
              Review report
            </h2>
            <p className="truncate text-[11px] text-fg-muted">
              {messages.length} message{messages.length === 1 ? "" : "s"} selected
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-4">
          {/* 1. Exactly what is being disclosed. */}
          <section aria-labelledby={`${headingId}-evidence`}>
            <h3
              id={`${headingId}-evidence`}
              className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted"
            >
              What will be shared
            </h3>
            <ul className="space-y-2">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className="rounded-[var(--radius-md)] border border-glass-border bg-card px-3 py-2"
                >
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-fg-muted">
                    <span className="font-semibold text-fg">{m.senderLabel}</span>
                    <time dateTime={m.created_at}>
                      {absoluteTime(m.created_at)}
                    </time>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">
                    {evidenceSummary(m)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* 2. Category. */}
          <section aria-labelledby={`${headingId}-category`}>
            <h3
              id={`${headingId}-category`}
              className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted"
            >
              Why are you reporting this?
            </h3>
            <div role="radiogroup" aria-labelledby={`${headingId}-category`} className="space-y-1.5">
              {DM_REPORT_CATEGORIES.map((c) => {
                const selected = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setCategory(c.value)}
                    disabled={submitting}
                    className={cn(
                      "focus-ring flex w-full items-center justify-between rounded-[var(--radius-sm)] border px-4 py-3 text-left text-sm disabled:opacity-40",
                      selected
                        ? "border-fg bg-fill text-fg"
                        : "border-glass-border text-fg-muted hover:text-fg",
                    )}
                  >
                    {c.label}
                    {selected && <Check className="h-4 w-4" aria-hidden />}
                  </button>
                );
              })}
            </div>
            {touched && !category && (
              <p className="mt-1.5 text-xs text-error">Choose a category.</p>
            )}
          </section>

          {/* 3. Description. */}
          <section>
            <label
              htmlFor={descId}
              className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-fg-muted"
            >
              What happened?
            </label>
            <textarea
              id={descId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={submitting}
              rows={4}
              maxLength={MAX_DESCRIPTION_LENGTH}
              aria-describedby={`${descId}-help`}
              aria-invalid={touched && !descriptionState.ok}
              placeholder="Tell moderators what to look for in the messages you selected."
              className="w-full resize-y rounded-[var(--radius-sm)] border border-glass-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-fg disabled:opacity-40"
            />
            <p
              id={`${descId}-help`}
              className={cn(
                "mt-1 text-xs",
                touched && !descriptionState.ok ? "text-error" : "text-fg-muted",
              )}
            >
              {touched && !descriptionState.ok
                ? descriptionState.reason
                : `${trimmed.length}/${MAX_DESCRIPTION_LENGTH} · at least ${MIN_DESCRIPTION_LENGTH} characters`}
            </p>
          </section>

          {/* 4. Disclosure notice — the exact committed wording. */}
          <p
            id={noticeId}
            className="flex gap-2 rounded-[var(--radius-md)] border border-glass-border bg-card px-3 py-3 text-xs leading-relaxed text-fg-muted"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{DISCLOSURE_NOTICE}</span>
          </p>

          {/* 5. Explicit confirmation. */}
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={submitting}
              className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span>
              I understand these {messages.length} message
              {messages.length === 1 ? "" : "s"} will be shared with moderators.
            </span>
          </label>

          {error && (
            <p
              id={errorId}
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-error/40 px-3 py-2 text-sm text-error"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <GlassButton
            type="button"
            variant="danger"
            onClick={submit}
            disabled={!canSubmit}
            aria-describedby={error ? errorId : undefined}
            className="w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Filing report…
              </>
            ) : (
              "Submit report"
            )}
          </GlassButton>
          {/* Announced to screen readers without stealing focus. */}
          <p aria-live="polite" className="sr-only">
            {submitting ? "Filing your report" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Confirmation shown once a case exists, with its id. */
export function ReportFiled({
  reportId,
  onClose,
}: {
  reportId: string;
  onClose: () => void;
}) {
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/95 px-6 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-fill">
          <Check className="h-6 w-6 text-fg" aria-hidden />
        </div>
        <h2 id={headingId} className="text-lg font-semibold">
          Report filed
        </h2>
        <p className="text-sm text-fg-muted">
          Moderators will review the messages you selected. Nothing else from
          this conversation was shared.
        </p>
        <p className="font-mono text-xs text-fg-muted">
          Case {reportId.slice(0, 8)}
        </p>
        <GlassButton
          ref={closeRef}
          type="button"
          variant="secondary"
          onClick={onClose}
          className="w-full"
        >
          Done
        </GlassButton>
      </div>
    </div>
  );
}
