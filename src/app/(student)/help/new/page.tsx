import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { HelpComposer } from "@/components/help/help-composer";

export const metadata = { title: "Ask for help · FAST SOCIO" };

export default async function NewHelpPage() {
  const uid = await getAuthUserId();
  if (!uid) redirect("/login");

  const supabase = await createClient();
  // Prefill department/semester from the profile so the common case is one tap.
  const { data: profile } = await supabase
    .from("profiles")
    .select("department, semester")
    .eq("id", uid)
    .single();

  return (
    <HelpComposer
      defaults={{
        department: profile?.department ?? null,
        semester:
          typeof profile?.semester === "number" ? profile.semester : null,
      }}
    />
  );
}
