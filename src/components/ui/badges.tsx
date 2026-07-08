import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Verified badge (UISpec V3 §2.7) — blue check in a filled circle, shown inline
 * after a name. Default 16px; pass a size for larger contexts (e.g. discover card).
 */
export function VerifiedBadge({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-label="Verified"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-verified text-white",
        className
      )}
      style={{ width: size, height: size }}
    >
      <Check
        strokeWidth={3}
        style={{ width: size * 0.62, height: size * 0.62 }}
        aria-hidden
      />
    </span>
  );
}

/**
 * Online presence dot (UISpec V3 §2.8) — 10px green dot with a 2px app-bg ring,
 * positioned bottom-right of an avatar. Wrap the avatar in `relative`.
 */
export function OnlineDot({ className }: { className?: string }) {
  return (
    <span
      aria-label="Online"
      className={cn(
        "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-bg",
        className
      )}
    />
  );
}

/**
 * Unread count badge (UISpec V3 §2.9) — purple pill, min 20px, 11px bold white.
 * Renders nothing when count <= 0.
 */
export function UnreadBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold leading-none text-white",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
