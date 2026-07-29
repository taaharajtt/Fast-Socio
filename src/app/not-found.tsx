import Link from "next/link";
import { SearchX } from "lucide-react";
import { NotFoundGoBack } from "@/components/not-found-go-back";

/**
 * Global 404 — also reused by every segment-level not-found.tsx (fix-022) so
 * "this doesn't exist" and "you no longer have access" render as the exact
 * same screen. Never leak which one it actually is.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-5 text-center">
      <div className="glass w-full rounded-[20px] px-6 py-10">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated text-fg-muted">
          <SearchX className="h-6 w-6" aria-hidden />
        </span>
        <p className="mt-4 text-[15px] font-medium leading-relaxed text-fg">
          We are sorry, this page is unavailable.
        </p>

        <Link
          href="/home"
          className="mt-6 flex w-full items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition active:scale-[0.97]"
        >
          Home
        </Link>
        <NotFoundGoBack />
      </div>
    </main>
  );
}
