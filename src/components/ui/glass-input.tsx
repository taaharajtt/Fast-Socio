import { cn } from "@/lib/utils";

type GlassInputProps = React.ComponentProps<"input"> & {
  /** Render in error state (e.g. invalid FAST email domain) — UI Spec §5.1. */
  invalid?: boolean;
};

/** Glass text field — rounded, frosted, inline error styling (no modal). */
export function GlassInput({ className, invalid, ...props }: GlassInputProps) {
  return (
    <input
      aria-invalid={invalid}
      className={cn(
        // A field is an input well, not a raised card: it reads as recessed
        // (darker than the surface it sits on) with a hairline, and emphasis
        // appears only on focus — where it actually means something.
        "h-[52px] w-full rounded-[12px] border border-glass-border bg-input " +
          "px-4 type-callout text-fg placeholder:text-fg-disabled outline-none " +
          "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] " +
          "focus:border-fg focus:ring-2 focus:ring-fg/15",
        invalid && "border-error/70 ring-2 ring-error/40 focus:border-error focus:ring-error/50",
        className
      )}
      {...props}
    />
  );
}
