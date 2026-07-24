import { EyeOff } from "lucide-react";

/** Small "Anonymous" capsule shown beside a name when the viewer is looking at
 * their own request/response that was posted anonymously — a reminder that
 * everyone else sees it masked. */
export function HelpAnonBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-aura/15 px-1.5 py-0.5 text-[10px] font-semibold text-aura">
      <EyeOff className="h-2.5 w-2.5" aria-hidden /> Anonymous
    </span>
  );
}
