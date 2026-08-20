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
        // Overlay chips almost always sit ON a photo, where a solid card fill
        // reads as a sticker. A dark translucent material with a blur belongs
        // to the image underneath it instead (apple.md §12).
        "material-bar inline-flex items-center gap-1 rounded-[var(--radius-pill)] " +
          "border border-white/10 px-2.5 py-1 type-caption font-semibold leading-none",
        toneMap[tone],
        className
      )}
      {...props}
    />
  );
}
