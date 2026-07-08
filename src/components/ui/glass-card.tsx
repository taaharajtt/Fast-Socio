import { cn } from "@/lib/utils";

const radiusMap = {
  sm: "rounded-[10px]",
  md: "rounded-[14px]",
  lg: "rounded-[20px]",
  card: "rounded-[14px]",
} as const;

type GlassCardProps = React.ComponentProps<"div"> & {
  /** Corner radius from the UI Spec §2.5 scale. */
  radius?: keyof typeof radiusMap;
  /** Use the stronger blur/opacity variant for elevated surfaces. */
  strong?: boolean;
};

/**
 * Floating glass surface — the base panel of the design system.
 * Carries blur, soft transparency, subtle border, and soft shadow (UI Spec §2.6).
 */
export function GlassCard({
  className,
  radius = "md",
  strong = false,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        strong ? "glass-strong" : "glass",
        radiusMap[radius],
        className
      )}
      {...props}
    />
  );
}
