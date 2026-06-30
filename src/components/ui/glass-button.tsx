import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const glassButton = cva(
  "inline-flex items-center justify-center gap-2 font-medium select-none " +
    "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura/60",
  {
    variants: {
      variant: {
        /** Primary gradient-fill pill CTA (UI Spec §5: large gradient CTA). */
        primary: "gradient-brand text-white shadow-[0_8px_24px_rgba(124,92,255,0.35)]",
        /** Frosted glass pill — social logins, secondary actions. */
        glass: "glass text-fg hover:bg-glass-strong",
        /** Transparent text/icon button. */
        ghost: "bg-transparent text-fg-muted hover:text-fg",
        /** Destructive actions (report, delete) — UI Spec uses Error color. */
        danger: "bg-error/90 text-white hover:bg-error",
      },
      size: {
        sm: "h-9 px-4 text-sm rounded-[var(--radius-pill)]",
        md: "h-11 px-6 text-[15px] rounded-[var(--radius-pill)]",
        lg: "h-14 px-8 text-base rounded-[var(--radius-pill)]",
        icon: "h-11 w-11 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

type GlassButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof glassButton>;

/** Pill-shaped button covering the UI Spec's CTA and glass-action language. */
export function GlassButton({
  className,
  variant,
  size,
  ...props
}: GlassButtonProps) {
  return (
    <button
      className={cn(glassButton({ variant, size }), className)}
      {...props}
    />
  );
}

export { glassButton };
