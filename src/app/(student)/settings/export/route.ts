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

  const uid = user.id;
  const [
    profile,
    aura,
    prefs,
    blocks,
    reports,
    posts,
    comments,
    likes,
    swipes,
    matches,
    memberships,
    events,
    rsvps,
    messages,
    requests,
    notifications,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).single(),
    supabase.from("aura_transactions").select("*").eq("user_id", uid),
    supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", uid)
      .single(),
    supabase.from("blocked_users").select("*").eq("blocker_id", uid),
    supabase.from("reports").select("*").eq("reporter_id", uid),
    // Own content (base posts table SELECT is revoked, but RLS-scoped tables
    // below are readable for the owner).
    supabase.from("feed_posts").select("*").eq("author_id", uid),
    supabase.from("post_comments").select("*").eq("author_id", uid),
    supabase.from("post_likes").select("*").eq("user_id", uid),
    supabase.from("swipes").select("*").eq("swiper_id", uid),
    supabase.from("matches").select("*").or(`user_low.eq.${uid},user_high.eq.${uid}`),
    supabase.from("community_members").select("*").eq("user_id", uid),
    supabase.from("events").select("*").eq("host_id", uid),
    supabase.from("event_attendees").select("*").eq("user_id", uid),
    // DMs the user SENT (their own message content).
    supabase.from("messages").select("*").eq("sender_id", uid),
    supabase
      .from("message_requests")
      .select("*")
      .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`),
    supabase.from("notifications").select("*").eq("user_id", uid),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at },
    profile: profile.data,
    aura_transactions: aura.data ?? [],
    notification_preferences: prefs.data,
    blocked_users: blocks.data ?? [],
    reports_filed: reports.data ?? [],
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    likes_given: likes.data ?? [],
    swipes: swipes.data ?? [],
    matches: matches.data ?? [],
    community_memberships: memberships.data ?? [],
    events_hosted: events.data ?? [],
    event_rsvps: rsvps.data ?? [],
    messages_sent: messages.data ?? [],
    message_requests: requests.data ?? [],
    notifications: notifications.data ?? [],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="fast-socio-data.json"',
    },
  });
}
