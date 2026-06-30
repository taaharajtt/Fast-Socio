import { GlassCard } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
      <p className="mt-1 text-fg-muted">Your Aura, communities, and posts</p>

      <GlassCard className="mt-6 space-y-1 p-6">
        <p className="text-sm text-fg-muted">Signed in as</p>
        <p className="text-lg font-medium break-all">{user?.email ?? "—"}</p>
      </GlassCard>

      <GlassCard className="mt-4 p-6">
        <p className="text-sm text-fg-muted">
          The full profile experience ships in Phase 1 (Profiles).
        </p>
      </GlassCard>

      <div className="mt-4">
        <SignOutButton />
      </div>
    </main>
  );
}
