"use client";

import { AlertTriangle } from "lucide-react";

/**
 * The app's one glass confirm dialog — extracted from the destructive-action
 * confirms on Discover team rooms and society announcements so there is a
 * single implementation instead of one per feature.
 *
 * Purely presentational: callers own their own `open`/`pending`/`error`
 * state and the async action itself. Backdrop click and Escape both cancel,
 * but are ignored while `pending` so an in-flight action can't be interrupted.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
  error?: string | null;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={() => !pending && onCancel()}
    >
      <div
        className="glass w-full max-w-md rounded-[20px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-error" aria-hidden />
          <span id="confirm-dialog-title" className="text-base font-bold tracking-tight">
            {title}
          </span>
        </p>
        <p className="mt-1.5 text-sm text-fg-muted">{description}</p>

        {error && <p className="mt-2 text-xs font-medium text-error">{error}</p>}

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="w-full rounded-full bg-error px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="glass w-full rounded-full px-4 py-2.5 text-sm font-semibold text-fg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
