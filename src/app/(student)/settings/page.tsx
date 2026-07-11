import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { glassButton } from "@/components/ui/glass-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { NotificationPrefs } from "@/components/settings/notification-prefs";
import { EnablePush } from "@/components/settings/enable-push";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select(
      "matches, messages, likes, events, communities, system, quiet_hours_enabled, quiet_start, quiet_end"
    )
    .eq("user_id", user!.id)
    .single();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/profile"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight">Settings</h1>
      </div>

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
        <h2 className="text-sm font-medium text-fg-muted">Activity &amp; alerts</h2>
        <GlassCard className="p-5">
          <EnablePush />
        </GlassCard>
        <GlassCard className="px-5 py-1">
          <NotificationPrefs
            initial={{
              matches: prefs?.matches ?? true,
              messages: prefs?.messages ?? true,
              likes: prefs?.likes ?? true,
              events: prefs?.events ?? true,
              communities: prefs?.communities ?? true,
              system: prefs?.system ?? true,
            }}
            quiet={{
              enabled: prefs?.quiet_hours_enabled ?? false,
              start: prefs?.quiet_start ?? 22,
              end: prefs?.quiet_end ?? 7,
            }}
          />
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
