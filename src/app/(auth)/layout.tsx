import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Pre-login shell. Auth screens are the only place that use the full-bleed
 * gradient background (UI Spec §2.2 exception); all post-login screens use the
 * flat dark/light glass surfaces.
 *
 * The gradient and halo are identical on every auth screen, so they prerender;
 * only the form inside suspends (/set-password reads the session to decide
 * which state to show). That way the branded backdrop is already on screen
 * while the form resolves, instead of the whole page waiting.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-gradient relative flex min-h-full flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10">
      {/* V3 Screen 1: a single soft purple halo from top-center (the radial
          auth-gradient carries most of it; this deepens the glow). */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full opacity-40 [background:radial-gradient(circle,#7c3aed,transparent_70%)]"
      />
      <div className="relative z-10 flex w-full flex-col items-center">
        <Suspense
          fallback={
            <div className="w-full max-w-sm space-y-4">
              <Skeleton className="mx-auto h-8 w-40" />
              <Skeleton className="h-12 w-full rounded-full" />
              <Skeleton className="h-12 w-full rounded-full" />
            </div>
          }
        >
          {children}
        </Suspense>
      </div>
    </div>
  );
}
