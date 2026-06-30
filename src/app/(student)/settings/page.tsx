import Link from "next/link";
import { GlassCard } from "@/components/ui";
import { glassButton } from "@/components/ui/glass-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-medium text-fg-muted">Account</h2>
        <GlassCard className="space-y-1 p-5">
          <p className="text-sm text-fg-muted">Signed in as</p>
          <p className="break-all font-medium">{user?.email ?? "—"}</p>
        </GlassCard>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-sm font-medium text-fg-muted">Appearance</h2>
        <GlassCard className="p-5">
          <ThemeToggle />
        </GlassCard>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-sm font-medium text-fg-muted">Your data</h2>
        <GlassCard className="space-y-3 p-5">
          <p className="text-sm text-fg-muted">
            Download a copy of your FAST SOCIO data as JSON.
          </p>
          <Link
            href="/settings/export"
            prefetch={false}
            download
            className={glassButton({ variant: "glass", size: "md" })}
          >
            Export my data
          </Link>
        </GlassCard>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-sm font-medium text-fg-muted">Session</h2>
        <GlassCard className="p-5">
          <SignOutButton />
        </GlassCard>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-sm font-medium text-error">Danger zone</h2>
        <GlassCard className="p-5">
          <DeleteAccountButton />
        </GlassCard>
      </section>
    </main>
  );
}
