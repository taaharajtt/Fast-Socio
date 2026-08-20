import { VenetianMask } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One composer affordance: a glyph over a label, chrome-free at rest.
 *
 * Lifted out of the home composer so Campus Help can use the same control. The
 * two screens had grown different Anonymous toggles — a masked-face glyph with
 * a label here, a crossed-out-eye capsule there — which meant the single most
 * consequential switch in the product (does my name go on this?) looked like
 * two different features depending on where you met it.
 *
 * `pressed` is passed through as `aria-pressed` for real toggles and left
 * undefined for buttons that merely open something — a file picker has no
 * on/off state to announce. A pressed toggle shows as a neutral raised fill,
 * the same "selected" language the tabs and segmented controls use; it is a
 * state, not an action, so it does not take the brand colour.
 */
export function ComposerAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  pressed,
  className,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        // shrink-0: these labels must never truncate. The row is sized to fit
        // all three plus the primary CTA at 360px, the narrowest phone we
        // support.
        "pressable focus-ring flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] px-1",
        "type-caption font-medium disabled:opacity-40",
        pressed ? "bg-surface-active text-fg" : "text-fg-muted hover:text-fg",
        className
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      {label}
    </button>
  );
}

/**
 * The Anonymous toggle — the same component on Home and on Campus Help.
 * A thin wrapper rather than a prop convention, so the glyph and the wording
 * cannot drift apart again.
 */
export function AnonymousToggle({
  pressed,
  onToggle,
  disabled,
  className,
}: {
  pressed: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ComposerAction
      icon={VenetianMask}
      label="Anonymous"
      onClick={onToggle}
      disabled={disabled}
      pressed={pressed}
      className={className}
    />
  );
}
