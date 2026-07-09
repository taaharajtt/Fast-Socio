import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Messages | Community segmented pills (UISpec V3 Screens 10–11). The two
 * views live at separate routes (/chat and /communities); these pills navigate
 * between them, so exactly one is active per screen.
 */
export function ChatCommunityTabs({ active }: { active: "messages" | "community" }) {
  return (
    <div className="mt-4 flex gap-2">
      <Pill href="/chat" label="Messages" active={active === "messages"} />
      <Pill href="/communities" label="Community" active={active === "community"} />
    </div>
  );
}

function Pill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95",
        active
          ? "gradient-brand text-white shadow-[0_4px_16px_rgba(124,58,237,0.4)]"
          : "bg-card text-fg-muted hover:text-fg"
      )}
    >
      {label}
    </Link>
  );
}
