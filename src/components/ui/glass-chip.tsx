import { cn } from "@/lib/utils";

type GlassChipProps = React.ComponentProps<"span"> & {
  tone?: "neutral" | "aura" | "cyan" | "success" | "warning" | "error";
};

const toneMap = {
  neutral: "text-fg",
  aura: "text-aura",
  cyan: "text-cyan",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
} as const;

/**
 * Small glass chip — the shared "card-with-overlay-chip" pattern
 * (Discover compatibility/Aura chips, Event date badge). UI Spec §10.2:
 * 12–13px caption text, 12–16px inset from card corner.
 */
export function GlassChip({
  className,
  tone = "neutral",
  ...props
}: GlassChipProps) {
  return (
    <span
      className={cn(
        "glass inline-flex items-center gap-1 rounded-[var(--radius-pill)] " +
          "px-3 py-1 text-xs font-medium leading-none",
        toneMap[tone],
        className
      )}
      {...props}
    />
  );
}
