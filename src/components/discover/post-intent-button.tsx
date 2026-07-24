import Link from "next/link";
import { Plus } from "lucide-react";
import type { MyDiscoverData } from "@/lib/smart-match/types";

/**
 * The only control on Discover besides the deck itself: post yourself into it.
 * Navigates to the full /discover/post page — creating and managing posts is a
 * considered action, not a quick sheet you dismiss by tapping outside it.
 */
export function PostIntentButton({ data }: { data: MyDiscoverData }) {
  const pending = data.incoming.length;

  return (
    <Link
      href="/discover/post"
      className="relative flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-sm font-semibold text-white active:scale-95"
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
