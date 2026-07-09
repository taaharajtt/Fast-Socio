import { redirect } from "next/navigation";
import { FloatingDock } from "@/components/floating-dock";
import { createClient } from "@/lib/supabase/server";

/**
 * Shell for the logged-in student experience. Hosts the floating glass dock and
 * reserves bottom space so scrollable content clears it. All six primary
 * destinations live under this route group. New users who haven't finished
 * onboarding are sent through the profile wizard first.
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, avatar_url")
    .eq("id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  // Chat dock badge: unread incoming messages + pending message requests.
  // RLS scopes messages to the caller's own conversations.
  const [{ count: unreadMsgs }, { count: pendingReqs }] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .neq("sender_id", user.id)
      .is("read_at", null),
    supabase
      .from("message_requests")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .eq("status", "pending"),
  ]);
  const chatBadge = (unreadMsgs ?? 0) + (pendingReqs ?? 0);

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      {/* Ambient brand glow shared across student screens */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(40rem 30rem at 15% -10%, rgba(124,92,255,0.22), transparent), radial-gradient(35rem 25rem at 95% 5%, rgba(200,80,192,0.18), transparent)",
        }}
      />
      <div className="flex-1 pb-20">{children}</div>
      <FloatingDock
        badges={{ "/chat": chatBadge }}
        avatarUrl={profile?.avatar_url}
      />
    </div>
  );
}
