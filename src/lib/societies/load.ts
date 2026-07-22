import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import type { SocietyRole } from "@/lib/societies/logic";
import type { SocietyRow } from "@/lib/societies/types";

export type SocietyViewer = {
  me: string;
  isAdmin: boolean;
  isOwner: boolean;
  isFollowing: boolean;
  /** owner · officer role · member · null (not following). */
  role: SocietyRole | null;
};

export type SocietyContext = { society: SocietyRow; viewer: SocietyViewer };

/**
 * Load a society (a community with is_society = true) plus the viewer's
 * relationship to it. 404s for a missing community or one that hasn't been
 * registered as a society. The DB remains the authority on every mutation;
 * viewer.role only drives which controls are shown.
 */
export async function getSocietyContext(id: string): Promise<SocietyContext> {
  const supabase = await createClient();
  const me = (await getAuthUserId())!;

  const { data: c } = await supabase
    .from("communities")
    .select(
      "id, name, description, avatar_url, cover_url, member_count, society_category, is_official, recruitment_open, contact_email, instagram_url, website_url, owner_id, status, is_society"
    )
    .eq("id", id)
    .single();
  if (!c || !c.is_society) notFound();

  const [{ data: mem }, { data: roleRow }, { data: prof }] = await Promise.all([
    supabase
      .from("community_members")
      .select("user_id")
      .eq("community_id", id)
      .eq("user_id", me)
      .maybeSingle(),
    supabase
      .from("society_roles")
      .select("role")
      .eq("society_id", id)
      .eq("user_id", me)
      .maybeSingle(),
    supabase.from("profiles").select("admin_role").eq("id", me).single(),
  ]);

  const isOwner = c.owner_id === me;
  const isFollowing = isOwner || Boolean(mem);
  const isAdmin = Boolean(prof?.admin_role);
  const role: SocietyRole | null = isOwner
    ? "owner"
    : ((roleRow?.role as SocietyRole | undefined) ?? (mem ? "member" : null));

  return {
    society: c as SocietyRow,
    viewer: { me, isAdmin, isOwner, isFollowing, role },
  };
}
