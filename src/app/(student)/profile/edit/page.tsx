import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  EditProfileForm,
  type EditableProfile,
} from "@/components/profile/edit-profile-form";

export default async function EditProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, department, degree, gender, interests, bio, avatar_url, cover_url")
    .eq("id", user!.id)
    .single();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/profile"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Edit profile</h1>
      </div>

      <EditProfileForm profile={(profile ?? {}) as EditableProfile} />
    </main>
  );
}
