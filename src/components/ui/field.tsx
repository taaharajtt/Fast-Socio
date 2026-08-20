"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A labelled text field: visible label, leading glyph, and — for passwords — a
 * reveal toggle.
 *
 * The auth forms previously carried the label only in `aria-label`, so the
 * field's purpose vanished the moment you typed into it and the placeholder
 * disappeared. A visible label is the difference between "what was this box
 * for?" and knowing (apple.md §16 — if you need to explain a control, the
 * mapping is weak; and §2 in the feedback rules, validate inline).
 *
 * The leading glyph is decorative and `aria-hidden`; the label is a real
 * `<label htmlFor>`, so screen readers and tap-to-focus both work.
 */
export function Field({
  label,
  icon: Icon,
  revealable,
  invalid,
  className,
  id,
  type = "text",
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  label: string;
  icon?: LucideIcon;
  /** Password fields: adds a show/hide toggle inside the field. */
  revealable?: boolean;
  invalid?: boolean;
  type?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const [revealed, setRevealed] = useState(false);
  const resolvedType = revealable && revealed ? "text" : type;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="type-callout px-1 text-fg-muted">
        {label}
      </label>
      <div className="relative">
        {Icon ? (
          <Icon
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fg-muted"
            aria-hidden
          />
        ) : null}
        <input
          id={inputId}
          type={resolvedType}
          aria-invalid={invalid}
          className={cn(
            "h-[52px] w-full rounded-[12px] border border-glass-border bg-input",
            "type-callout text-fg placeholder:text-fg-disabled outline-none",
            "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "focus:border-fg focus:ring-2 focus:ring-fg/15",
            Icon ? "pl-11" : "pl-4",
            revealable ? "pr-12" : "pr-4",
            invalid &&
              "border-error/70 ring-2 ring-error/40 focus:border-error focus:ring-error/50"
          )}
          {...props}
        />
        {revealable ? (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className="pressable focus-ring absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-fg-muted hover:text-fg"
          >
            {revealed ? (
              <EyeOff className="h-[18px] w-[18px]" aria-hidden />
            ) : (
              <Eye className="h-[18px] w-[18px]" aria-hidden />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
