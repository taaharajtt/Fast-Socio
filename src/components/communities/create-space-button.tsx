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
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-fg-muted hover:text-fg"
    >
      <Plus className="h-5 w-5" aria-hidden />
    </Link>
  );
}
