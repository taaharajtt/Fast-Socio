import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { getCommunityRelationship } from "@/lib/communities/relationship";
import type { SocietyRole } from "@/lib/societies/logic";
import type { SocietyRow } from "@/lib/societies/types";
import type { JoinState } from "@/app/(student)/communities/actions";

export type SocietyViewer = {
  me: string;
  isAdmin: boolean;
  isOwner: boolean;
  /** Spectating: reads broadcasts, gets their notifications. */
  isFollowing: boolean;
  /** Participating: may send messages in the general chat. */
  isMember: boolean;
  /** Where the ask to participate stands. */
  joinStatus: JoinState;
  /** owner · officer role · member · null (neither joined nor an officer). */
  role: SocietyRole | null;
};

export type SocietyContext = { society: SocietyRow; viewer: SocietyViewer };

/**
 * Load a society (a community with is_society = true) plus the viewer's
 * relationship to it. 404s for a missing community or one that hasn't been
 * registered as a society. The DB remains the authority on every mutation;
 * viewer.role only drives which controls are shown.
 *
 * Since mig 0119 following and joining are separate rows, so this returns both
 * axes: a follower sees the broadcast feed but is locked out of the chat
 * composer until an officer approves their join request.
 */
export async function getSocietyContext(id: string): Promise<SocietyContext> {
  const supabase = await createClient();
  const me = (await getAuthUserId())!;

  const { data: c } = await supabase
    .from("communities")
    .select(
      "id, name, description, avatar_url, cover_url, member_count, follower_count, society_category, is_official, recruitment_open, contact_email, instagram_url, website_url, owner_id, status, is_society"
    )
    .eq("id", id)
    .single();
  if (!c || !c.is_society) notFound();

  const [rel, { data: roleRow }, { data: prof }] = await Promise.all([
    getCommunityRelationship(id, me, c.owner_id, true),
    supabase
      .from("society_roles")
      .select("role")
      .eq("society_id", id)
      .eq("user_id", me)
      .maybeSingle(),
    supabase.from("profiles").select("admin_role").eq("id", me).single(),
  ]);

  const role: SocietyRole | null = rel.isOwner
    ? "owner"
    : ((roleRow?.role as SocietyRole | undefined) ?? (rel.isMember ? "member" : null));

  return {
    society: c as SocietyRow,
    viewer: {
      me,
      isAdmin: Boolean(prof?.admin_role),
      isOwner: rel.isOwner,
      isFollowing: rel.isFollowing,
      isMember: rel.isMember,
      joinStatus: rel.joinStatus,
      role,
    },
  };
}
