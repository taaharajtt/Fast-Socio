import type { LucideIcon } from "lucide-react";
import { Users, Compass, Trophy, HandHeart, Sparkles } from "lucide-react";

export type SectionLogoName =
  | "community"
  | "discover"
  | "ranks"
  | "leaderboard"
  | "help";

export interface SectionLogoProps {
  /** Explicit LucideIcon component (e.g. `Users`, `Compass`, `Trophy`, `HandHeart`). */
  icon?: LucideIcon;
  /** Section name to automatically map to its navbar icon. */
  name?: SectionLogoName;
  className?: string;
  size?: "md" | "lg";
}

const NAME_TO_ICON: Record<SectionLogoName, LucideIcon> = {
  community: Users,
  discover: Compass,
  ranks: Trophy,
  leaderboard: Trophy,
  help: HandHeart,
};

/**
 * Enhanced section title logo badge matching the Campus Help header style.
 * Displays the page's navbar logo/icon inside a brand-gradient container
 * with interactive hover scaling and soft glow shadow.
 */
export function SectionLogo({
  icon: CustomIcon,
  name,
  className = "",
  size = "md",
}: SectionLogoProps) {
  const Icon = CustomIcon ?? (name ? NAME_TO_ICON[name] : Sparkles);

  const dimensionClasses =
    size === "lg" ? "h-11 w-11 rounded-2xl" : "h-10 w-10 rounded-[14px]";
  const iconSizeClasses = size === "lg" ? "h-[22px] w-[22px]" : "h-5 w-5";

  return (
    <span
      className={`gradient-brand flex ${dimensionClasses} shrink-0 items-center justify-center shadow-[0_8px_24px_rgba(124,92,255,0.35)] transition-all duration-300 hover:scale-105 hover:shadow-[0_12px_28px_rgba(124,92,255,0.5)] ${className}`}
      aria-hidden
    >
      <Icon className={`${iconSizeClasses} text-white drop-shadow-sm`} aria-hidden />
    </span>
  );
}

