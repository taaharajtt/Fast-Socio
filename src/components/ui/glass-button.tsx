import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The app's button system.
 *
 * Every feature used to grow its own filled-purple pill, so "purple" stopped
 * meaning "this is the important one" and started meaning "this is a button" —
 * at which point the screen had no primary action at all, just a field of
 * identical purple capsules.
 *
 * The variants below are an emphasis ladder, not a palette:
 *
 *   primary    off-white on near-black. The highest contrast available in a
 *              dark interface, and neutral — so the one action that matters is
 *              unmistakable WITHOUT spending the brand colour. At most one per
 *              screen.
 *   secondary  neutral fill. The default for anything that isn't THE action.
 *   ghost      no surface at all. Edit, links, contextual actions.
 *   brand      FAST SOCIO purple. Spent deliberately, on the actions the
 *              product wants to be recognised by — Install, an enabled Post,
 *              an enabled Respond — never as the generic colour of "button".
 *   danger     destructive, and nothing else.
 *
 * Radius is 12px rather than a full pill: a pill is a shape with a meaning
 * (a chip, a count, a filter), and making every button one drained it.
 */
const glassButton = cva(
  // `pressable` carries the shared tactile contract: feedback on pointer-DOWN,
  // 120ms, no tap-highlight flash, and a reduced-motion path.
  "pressable focus-ring inline-flex items-center justify-center gap-2 " +
    "font-semibold select-none disabled:pointer-events-none",
  {
    variants: {
      variant: {
        // Disabled drops the light fill entirely rather than fading it: an
        // off-white button at 40% opacity is still a solid mid-grey block, so
        // it kept the visual weight of the primary action while being inert.
        primary:
          "bg-emphasis text-emphasis-fg hover:opacity-90 " +
          "disabled:bg-fill disabled:text-fg-disabled",
        secondary: "bg-fill text-fg hover:bg-fill-strong disabled:opacity-40",
        ghost: "bg-transparent text-fg-muted hover:text-fg disabled:opacity-40",
        // Disabled drops to the same inert neutral fill `primary` uses, for the
        // same reason: a purple button at 40% opacity is still a purple button,
        // so an unsendable Post and a sendable one looked like the same
        // control with the lights dimmed.
        brand:
          "bg-accent text-white hover:bg-accent-light " +
          "disabled:bg-fill disabled:text-fg-disabled",
        danger: "bg-error/90 text-white hover:bg-error disabled:opacity-40",
        /** @deprecated Card-surface pill. Prefer `secondary`. */
        glass: "glass text-fg hover:bg-glass-strong disabled:opacity-40",
        /** @deprecated Purple-tinted. Prefer `ghost` or `secondary`. */
        tinted: "bg-fill text-fg hover:bg-fill-strong disabled:opacity-40",
      },
      size: {
        sm: "h-9 rounded-[10px] px-3.5 text-sm",
        md: "h-11 rounded-[12px] px-5 text-[15px]",
        lg: "h-[52px] rounded-[14px] px-6 text-base",
        icon: "h-11 w-11 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

type GlassButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof glassButton>;

/** Button covering the app's emphasis ladder (see `glassButton` above). */
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
