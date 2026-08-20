import Link from "next/link";
import { Plus } from "lucide-react";
import type { MyDiscoverData } from "@/lib/smart-match/types";

/**
 * The only control on Discover besides the deck itself: post yourself into it.
 * Navigates to the full /discover/post page — creating and managing posts is a
 * considered action, not a quick sheet you dismiss by tapping outside it.
 *
 * `data` is optional so the button can render in the page shell before the
 * viewer's own posts have been read — the link works either way, and the
 * pending-requests badge (the only part that needs the data) fills in when it
 * arrives without moving anything.
 */
export function PostIntentButton({ data }: { data?: MyDiscoverData }) {
  const pending = data?.incoming.length ?? 0;

  return (
    // Purple: this is the one action on Discover besides swiping, and it is
    // always actionable. The header around it stays neutral so the button is
    // the only coloured thing up here.
    <Link
      href="/discover/post"
      className="pressable focus-ring relative flex items-center gap-1.5 rounded-[10px] bg-accent px-3.5 py-2 text-sm font-semibold text-white"
    >
      <Plus className="h-4 w-4" aria-hidden /> Post
      {pending > 0 && (
        <span
          aria-label={`${pending} pending requests`}
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[11px] font-bold text-white"
        >
          {pending}
        </span>
      )}
    </Link>
  );
}
