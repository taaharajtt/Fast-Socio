import { ShieldAlert } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Public landing shown to suspended/banned accounts. The middleware redirects
 * any banned user here from every protected route (CR-014).
 */
export default function BannedPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <GlassCard className="w-full p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error/15 text-error">
          <ShieldAlert className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold">Account suspended</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Your access to FAST SOCIO has been suspended by a moderator. If you
          think this is a mistake, contact the admin team.
        </p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </GlassCard>
    </main>
  );
}
