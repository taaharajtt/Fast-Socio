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
        "glass h-[52px] w-full rounded-xl px-4 text-[15px] text-fg " +
          "placeholder:text-fg-disabled outline-none " +
          "transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
          "focus:border-accent/50 focus:ring-2 focus:ring-accent/30",
        invalid && "border-error/70 ring-2 ring-error/40 focus:border-error focus:ring-error/50",
        className
      )}
      {...props}
    />
  );
}
