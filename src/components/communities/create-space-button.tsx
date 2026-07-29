import Link from "next/link";
import { Plus } from "lucide-react";

/**
 * Header `+`. This used to open a GlassSheet that asked "chat room or society?"
 * before navigating; the sheet was an extra failure point in front of a form
 * that already asks the same question, so it now goes straight to the full
 * creation page and the choice is made there.
 */
export function CreateSpaceButton() {
  return (
    <Link
      href="/communities/new"
      aria-label="Create a space"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-aura text-white hover:bg-aura/90 active:bg-aura/80"
    >
      <Plus className="h-5 w-5" aria-hidden />
    </Link>
  );
}
