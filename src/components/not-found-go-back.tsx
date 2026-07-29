"use client";

import { useRouter } from "next/navigation";

/**
 * "Go back" needs `router.back()`, which is client-only — kept as its own
 * small client component so the not-found screen itself can stay a plain
 * Server Component (fix-022).
 */
export function NotFoundGoBack() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="glass mt-3 w-full rounded-full px-6 py-3 text-sm font-semibold text-fg-muted transition active:scale-[0.97]"
    >
      Go back
    </button>
  );
}
