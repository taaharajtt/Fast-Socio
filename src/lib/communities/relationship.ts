import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { JoinState } from "@/app/(student)/communities/actions";

/** A student waiting for an owner/moderator to let them participate. */
export type JoinRequestVM = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  gender: string | null;
  created_at: string;
};

/**
 * The pending access queue for a community. RLS (mig 0119) already restricts
 * these rows to the requester and the community's managers, so an ordinary
 * member calling this simply gets nothing back.
 */
export async function getJoinRequests(
  communityId: string
): Promise<JoinRequestVM[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("community_join_requests")
    .select("user_id, created_at, profile:profiles(full_name, username, avatar_url, gender)")
    .eq("community_id", communityId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);

  type Row = {
    user_id: string;
    created_at: string;
    profile: {
      full_name: string | null;
      username: string | null;
      avatar_url: string | null;
      gender: string | null;
    } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    user_id: r.user_id,
    created_at: r.created_at,
    full_name: r.profile?.full_name ?? null,
    username: r.profile?.username ?? null,
    avatar_url: r.profile?.avatar_url ?? null,
    gender: r.profile?.gender ?? null,
  }));
}

/**
 * The viewer's standing in a community — the two-axis model introduced in mig
 * 0119. FOLLOW (spectate broadcasts + notifications) and JOIN (participate in
 * chat, needs approval) are independent, so a viewer can be any combination of
 * following / joined / awaiting a decision.
 */
export type CommunityRelationship = {
  isOwner: boolean;
  /** Has a community_followers row — spectating. */
  isFollowing: boolean;
  /** Has a community_members row — may send messages and post. */
  isMember: boolean;
  /** State of the ask to participate. "joined" once membership exists. */
  joinStatus: JoinState;
  /** Owner, community moderator, society officer, or platform admin. */
  canManage: boolean;
};

/**
 * One parallel round trip for every relationship signal a community surface
 * needs. `ownerId` is passed in because every caller has already loaded the
 * community row, and re-reading it here would be a wasted query.
 */
export async function getCommunityRelationship(
  communityId: string,
  me: string,
  ownerId: string
): Promise<CommunityRelationship> {
  const supabase = await createClient();

  const [{ data: member }, { data: follower }, { data: request }, { data: officer }, { data: prof }] =
    await Promise.all([
      supabase
        .from("community_members")
        .select("role")
        .eq("community_id", communityId)
        .eq("user_id", me)
        .maybeSingle(),
      supabase
        .from("community_followers")
        .select("user_id")
        .eq("community_id", communityId)
        .eq("user_id", me)
        .maybeSingle(),
      supabase
        .from("community_join_requests")
        .select("status")
        .eq("community_id", communityId)
        .eq("user_id", me)
        .maybeSingle(),
      supabase
        .from("society_roles")
        .select("role")
        .eq("society_id", communityId)
        .eq("user_id", me)
        .maybeSingle(),
      supabase.from("profiles").select("admin_role").eq("id", me).single(),
    ]);

  const isOwner = ownerId === me;
  const isMember = isOwner || Boolean(member);
  const isAdmin = Boolean(prof?.admin_role);

  return {
    isOwner,
    // The owner always follows their own community (mig 0119 pins the row).
    isFollowing: isOwner || Boolean(follower),
    isMember,
    joinStatus: isMember
      ? "joined"
      : ((request?.status as JoinState | undefined) ?? "none"),
    canManage:
      isAdmin ||
      isOwner ||
      member?.role === "owner" ||
      member?.role === "moderator" ||
      Boolean(officer),
  };
}
