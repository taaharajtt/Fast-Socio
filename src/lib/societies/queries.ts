import "server-only";
import { createClient } from "@/lib/supabase/server";
import { roleRank, type SocietyRole } from "@/lib/societies/logic";
import type { OfficerVM, AnnouncementRow } from "@/lib/societies/types";

export type SocietyEvent = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  cover_url: string | null;
  attendee_count: number;
  capacity: number | null;
  status: string;
};

/** Owner + officer overlay, joined to safe profile fields, ranked high→low. */
export async function getSocietyOfficers(id: string): Promise<OfficerVM[]> {
  const supabase = await createClient();
  const [{ data: roleRows }, { data: comm }] = await Promise.all([
    supabase
      .from("society_roles")
      .select("user_id, role, title")
      .eq("society_id", id),
    supabase.from("communities").select("owner_id").eq("id", id).single(),
  ]);

  const ownerId = comm?.owner_id as string | undefined;
  const rows = (roleRows ?? []) as { user_id: string; role: SocietyRole; title: string | null }[];
  const ids = [...new Set([ownerId, ...rows.map((r) => r.user_id)].filter(Boolean))] as string[];
  if (ids.length === 0) return [];

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .in("id", ids);
  const byId = new Map(
    (profs ?? []).map((p) => [
      p.id as string,
      p as { id: string; full_name: string | null; username: string | null; avatar_url: string | null },
    ])
  );

  const officers: OfficerVM[] = [];
  if (ownerId) {
    const p = byId.get(ownerId);
    officers.push({
      user_id: ownerId,
      role: "owner",
      title: null,
      full_name: p?.full_name ?? null,
      username: p?.username ?? null,
      avatar_url: p?.avatar_url ?? null,
    });
  }
  for (const r of rows) {
    if (r.user_id === ownerId) continue; // owner already listed at the top
    const p = byId.get(r.user_id);
    officers.push({
      user_id: r.user_id,
      role: r.role,
      title: r.title,
      full_name: p?.full_name ?? null,
      username: p?.username ?? null,
      avatar_url: p?.avatar_url ?? null,
    });
  }
  return officers.sort((a, b) => roleRank(b.role) - roleRank(a.role));
}

/** Approved, upcoming events hosted by this society. */
export async function getUpcomingSocietyEvents(
  id: string,
  limit = 20
): Promise<SocietyEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, title, starts_at, location, cover_url, attendee_count, capacity, status")
    .eq("community_id", id)
    .eq("status", "approved")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as SocietyEvent[];
}

/** Past/approved events hosted by this society (most recent first). */
export async function getPastSocietyEvents(
  id: string,
  limit = 20
): Promise<SocietyEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, title, starts_at, location, cover_url, attendee_count, capacity, status")
    .eq("community_id", id)
    .eq("status", "approved")
    .lte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as SocietyEvent[];
}

/** Announcements through the visibility-enforcing definer feed view. */
export async function getSocietyAnnouncements(
  id: string,
  limit = 30
): Promise<AnnouncementRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("society_announcement_feed")
    .select("*")
    .eq("society_id", id)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AnnouncementRow[];
}
