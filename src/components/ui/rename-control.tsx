"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";

/**
 * Inline rename, shared by every surface that has an owner and a name (UAT-08).
 *
 * One component because the rules are the same everywhere and the failure modes
 * are the same everywhere: a trimmed name, a length bound, an unchanged value
 * that must not cost a write, an empty value that must not be submittable, and
 * a concurrent edit whose refusal has to be shown rather than swallowed.
 *
 * It is UX only. Every `onSave` behind it is a SECURITY DEFINER RPC that
 * re-checks authority and touches exactly one column, so hiding the pencil is
 * never what stops someone renaming a space they do not own.
 */
export function RenameControl({
  value,
  label,
  minLength = 2,
  maxLength = 60,
  onSave,
  className,
}: {
  value: string;
  /** Accessible name for the control, e.g. "event title". */
  label: string;
  minLength?: number;
  maxLength?: number;
  onSave: (next: string) => Promise<{ ok: true; value?: string } | { ok: false; error: string }>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Rename ${label}`}
        className={`focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg ${className ?? ""}`}
      >
        <Pencil className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  // Keyed remount: entering edit mode always starts from the CURRENT name, and
  // cancelling then re-opening never shows the abandoned draft.
  return (
    <RenameForm
      key={value}
      value={value}
      label={label}
      minLength={minLength}
      maxLength={maxLength}
      onSave={onSave}
      onDone={() => setEditing(false)}
    />
  );
}

function RenameForm({
  value,
  label,
  minLength,
  maxLength,
  onSave,
  onDone,
}: {
  value: string;
  label: string;
  minLength: number;
  maxLength: number;
  onSave: (next: string) => Promise<{ ok: true; value?: string } | { ok: false; error: string }>;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const trimmed = draft.trim();
  const tooShort = trimmed.length < minLength;
  const tooLong = trimmed.length > maxLength;
  const unchanged = trimmed === value.trim();
  const canSave = !pending && !tooShort && !tooLong;

  function submit() {
    if (!canSave) return;
    // An unchanged name is a no-op, not a write: it would bump timestamps and
    // fire a realtime event for nothing.
    if (unchanged) {
      onDone();
      return;
    }
    setError(null);
    start(async () => {
      const res = await onSave(trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          aria-label={label}
          aria-invalid={tooShort || tooLong || Boolean(error)}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            // Escape abandons the edit — the expected way out of an inline
            // field, and the only one available without a visible Cancel on a
            // hardware keyboard.
            if (e.key === "Escape") onDone();
          }}
          className="glass focus-ring h-9 min-w-0 flex-1 rounded-[10px] px-3 text-[15px] text-fg outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          aria-label="Save name"
          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
        >
          <Check className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          aria-label="Cancel rename"
          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {(tooShort || tooLong || error) && (
        <p role="alert" className="type-caption mt-1 text-error">
          {error ??
            (tooShort
              ? `Needs at least ${minLength} characters.`
              : `Keep it under ${maxLength} characters.`)}
        </p>
      )}
    </div>
  );
}
