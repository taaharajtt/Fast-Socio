import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrivacySettings } from "@/components/settings/privacy-settings";

export default async function PrivacySettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: p } = await supabase
    .from("profiles")
    .select(
      "discoverable, searchable, show_online, read_receipts, show_aura, show_department, show_semester, profile_visibility"
    )
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
        <h1 className="text-xl font-extrabold tracking-tight">Privacy</h1>
      </div>

      <PrivacySettings
        initial={{
          discoverable: p?.discoverable ?? true,
          searchable: p?.searchable ?? true,
          show_online: p?.show_online ?? true,
          read_receipts: p?.read_receipts ?? true,
          show_aura: p?.show_aura ?? true,
          show_department: p?.show_department ?? true,
          show_semester: p?.show_semester ?? true,
        }}
        initialVisibility={
          (p?.profile_visibility as "public" | "university") ?? "public"
        }
      />
    </main>
  );
}
