import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AccountSettings } from "@/components/settings/account-settings";

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: p } = await supabase
    .from("profiles")
    .select("username, deactivated_at")
    .eq("id", user!.id)
    .single();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/settings"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight">Account</h1>
      </div>

      <AccountSettings
        currentUsername={p?.username ?? null}
        deactivated={Boolean(p?.deactivated_at)}
      />
    </main>
  );
}
