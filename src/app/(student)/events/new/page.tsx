import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { NewEventForm } from "@/components/events/new-event-form";

/**
 * Reached plainly as /events/new (standalone event), or from a community's
 * Overview tab as /events/new?communityId=... (only linked there for that
 * community's owner/moderator). We re-verify the role here rather than trust
 * the query param — an invalid or forged id just falls back to a standalone
 * event instead of erroring, since "students submit pending events" (RLS)
 * would reject the insert anyway.
 */
export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ communityId?: string }>;
}) {
  const { communityId: requestedId } = await searchParams;

  let communityId: string | null = null;
  let communityName: string | null = null;

  if (requestedId) {
    const supabase = await createClient();
    const me = await getAuthUserId();
    const [{ data: community }, { data: membership }] = await Promise.all([
      supabase.from("communities").select("id, name").eq("id", requestedId).single(),
      me
        ? supabase
            .from("community_members")
            .select("role")
            .eq("community_id", requestedId)
            .eq("user_id", me)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const isMod = membership?.role === "owner" || membership?.role === "moderator";
    if (community && isMod) {
      communityId = community.id;
      communityName = community.name;
    }
  }

  return <NewEventForm communityId={communityId} communityName={communityName} />;
}
