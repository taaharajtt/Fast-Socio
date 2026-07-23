import { Wrench } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { SignOutButton } from "@/components/sign-out-button";
import { getMaintenanceState } from "@/lib/flags";

/**
 * Maintenance interstitial (Refactor Phase 1). Shown to non-admin users while
 * `app_settings.maintenance.enabled` is true. Super-admins bypass this gate in
 * the student layout so they can keep operating the console during a window.
 */
export default async function MaintenancePage() {
  const { message } = await getMaintenanceState();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <GlassCard className="w-full p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Wrench className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold">We&apos;ll be right back</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {message?.trim()
            ? message
            : "FAST SOCIO is undergoing scheduled maintenance. Please check back in a little while."}
        </p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </GlassCard>
    </main>
  );
}
