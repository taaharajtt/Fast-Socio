import { GlassCard } from "@/components/ui";
import {
  PageHeader,
  SettingsGroup,
  SettingsRow,
} from "@/components/ui/page-header";
import { SignOutButton } from "@/components/sign-out-button";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { NotificationPrefs } from "@/components/settings/notification-prefs";
import { EnablePush } from "@/components/settings/enable-push";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { InstallApp } from "@/components/settings/install-app";
import { ShieldCheck, UserCog, MonitorSmartphone, Ban } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthEmail, getAuthUserId } from "@/lib/auth/user";

/**
 * Settings.
 *
 * This screen used to be eight stacked `GlassCard`s — one per section — so a
 * list of eleven controls read as eleven containers, and the borders carried
 * more visual weight than the labels inside them. The cards are gone: an
 * uppercase eyebrow introduces each group, space separates the groups, and the
 * page itself is the container.
 *
 * The two surfaces that remain are the ones where containment says something.
 * See the comments at their call sites.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const [userId, email] = await Promise.all([getAuthUserId(), getAuthEmail()]);

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select(
      "matches, messages, likes, events, communities, system, quiet_hours_enabled, quiet_start, quiet_end"
    )
    .eq("user_id", userId!)
    .single();

  return (
    <main className="page-x mx-auto w-full max-w-md py-6">
      <PageHeader title="Settings" backHref="/profile" />

      <SettingsGroup label="Account">
        <p className="type-body break-all text-fg">{email ?? "—"}</p>
        <p className="type-caption mt-1 text-fg-subtle">Signed in</p>
      </SettingsGroup>

      <SettingsGroup label="Privacy &amp; security">
        <SettingsRow href="/settings/privacy" icon={ShieldCheck} label="Privacy" />
        <SettingsRow href="/settings/account" icon={UserCog} label="Account" />
        <SettingsRow
          href="/settings/devices"
          icon={MonitorSmartphone}
          label="Devices &amp; security"
        />
        <SettingsRow href="/settings/blocked" icon={Ban} label="Blocked &amp; muted" />
      </SettingsGroup>

      <SettingsGroup label="FAST SOCIO">
        {/* The permanent, user-initiated install path. The banner is snoozeable
            and the onboarding step is one-shot, so without this a user who
            declined once had no way back. Renders an "Installed" confirmation
            rather than an ask once the app is on the home screen. */}
        <InstallApp />
      </SettingsGroup>

      <SettingsGroup label="Appearance">
        <AppearanceSettings />
      </SettingsGroup>

      <SettingsGroup label="Activity &amp; alerts">
        <EnablePush />
        <div className="mt-2">
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
        </div>
      </SettingsGroup>

      <SettingsGroup label="Session">
        <SignOutButton />
      </SettingsGroup>

      <SettingsGroup label="Danger zone" tone="danger">
        {/*
          The one card kept on this page. Deleting an account is irreversible,
          and a bounded surface is the difference between "another row in a
          list" and "a thing that is separate from the rest of this screen" —
          containment communicating something, which is the only reason to draw
          a box at all.
        */}
        <GlassCard className="p-4">
          <DeleteAccountButton />
        </GlassCard>
      </SettingsGroup>
    </main>
  );
}
