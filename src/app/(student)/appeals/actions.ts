"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const SUBJECTS = [
  "strike",
  "posting_restriction",
  "suspension",
  "shadow_ban",
  "content",
  "ban",
] as const;

/** File an appeal against a moderation action (Refactor Phase 9). */
export async function submitAppeal(input: {
  subject: string;
  explanation: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!SUBJECTS.includes(input.subject as (typeof SUBJECTS)[number]))
    return { ok: false, error: "Pick what you're appealing." };
  const explanation = input.explanation.trim();
  if (explanation.length < 10 || explanation.length > 1000)
    return { ok: false, error: "Explanation must be 10–1000 characters." };

  // One open appeal per subject at a time.
  const { data: existing } = await supabase
    .from("appeals")
    .select("id")
    .eq("user_id", user.id)
    .eq("subject", input.subject)
    .eq("status", "open")
    .maybeSingle();
  if (existing)
    return { ok: false, error: "You already have an open appeal for this." };

  const { error } = await supabase.from("appeals").insert({
    user_id: user.id,
    subject: input.subject,
    explanation,
    status: "open",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/appeals");
  return { ok: true };
}
