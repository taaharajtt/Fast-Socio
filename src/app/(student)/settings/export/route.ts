import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Self-serve data export (Phase 1 data policy). Returns the caller's own data
 * as a downloadable JSON file. RLS scopes every query to the authenticated
 * user, so this only ever exposes the requester's own rows.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const [profile, aura, prefs, blocks, reports] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("aura_transactions").select("*").eq("user_id", user.id),
    supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .single(),
    supabase.from("blocked_users").select("*").eq("blocker_id", user.id),
    supabase.from("reports").select("*").eq("reporter_id", user.id),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at },
    profile: profile.data,
    aura_transactions: aura.data ?? [],
    notification_preferences: prefs.data,
    blocked_users: blocks.data ?? [],
    reports_filed: reports.data ?? [],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="fast-socio-data.json"',
    },
  });
}
