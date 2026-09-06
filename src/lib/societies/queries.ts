import "server-only";
import { createClient } from "@/lib/supabase/server";
import { roleRank, type SocietyRole } from "@/lib/societies/logic";
import {
  groupReactionsByMessage,
  type MessageReaction,
} from "@/lib/chat/reactions";
import { HISTORY_PAGE_SIZE } from "@/lib/chat/history";
import { olderThanFilter } from "@/lib/chat/keyset";
import type { MessageCursor } from "@/lib/chat/message-merge";
import type { OfficerVM, AnnouncementRow } from "@/lib/societies/types";

export type SocietyEvent = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  /** Known campus place id (mig 0138) — set when the host pinned a location. */
  place_id: string | null;
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
    .select("id, full_name, username, avatar_url, gender")
    .in("id", ids);
  const byId = new Map(
    (profs ?? []).map((p) => [
      p.id as string,
      p as {
        id: string;
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
        gender: string | null;
      },
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
      gender: p?.gender ?? null,
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
      gender: p?.gender ?? null,
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
    .select("id, title, starts_at, location, place_id, cover_url, attendee_count, capacity, status")
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
    .select("id, title, starts_at, location, place_id, cover_url, attendee_count, capacity, status")
    .eq("community_id", id)
    .eq("status", "approved")
    .lte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as SocietyEvent[];
}

/**
 * Announcements through the visibility-enforcing definer feed view.
 *
 * STRICTLY NEWEST-FIRST, and the `pinned` sort key is deliberately gone. The
 * broadcast channel renders as a conversation, which reverses this list into
 * chronological order — and with pinned rows floated to the head of a
 * newest-first list, reversing put them at the END, i.e. a pinned message from
 * last term appeared as the most recent thing anyone had said. Pinning is
 * surfaced by the thread's pinned bar instead, which is where a chat surface
 * puts it.
 */
export async function getSocietyAnnouncements(
  id: string,
  limit = 30
): Promise<AnnouncementRow[]> {
  return (await getSocietyAnnouncementPage(id, { limit })).items;
}

/**
 * One page of broadcasts, newest-first, with the flag that drives the
 * "Load earlier messages" capsule.
 *
 * `id` is the second sort key and the tiebreaker in the cursor: two broadcasts
 * posted in the same microsecond would otherwise swap places between requests,
 * and a timestamp-only cursor would either serve one of them twice or step over
 * it. Access is unchanged — `society_announcement_feed` is the definer feed view
 * that already enforces broadcast visibility, and the cursor only narrows rows
 * the caller can see. Nothing here touches who may POST or moderate.
 */
export async function getSocietyAnnouncementPage(
  id: string,
  options: { limit?: number; before?: MessageCursor | null } = {}
): Promise<{ items: AnnouncementRow[]; hasMore: boolean }> {
  const { limit = HISTORY_PAGE_SIZE, before = null } = options;
  const supabase = await createClient();

  let query = supabase
    .from("society_announcement_feed")
    .select("*")
    .eq("society_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (before) query = query.or(olderThanFilter(before));

  const { data } = await query;
  const fetched = (data ?? []) as AnnouncementRow[];
  const hasMore = fetched.length > limit;
  // Newest-first is this function's contract — the thread reverses it — so the
  // extra probe row is dropped from the END.
  return { items: hasMore ? fetched.slice(0, limit) : fetched, hasMore };
}

/**
 * Reactions on a page of broadcasts, for the first paint.
 *
 * Read on the server so the channel does not open with no chips and grow them
 * a round trip later, which reads as the reactions having been lost.
 */
export async function getAnnouncementReactions(
  ids: string[]
): Promise<Record<string, MessageReaction[]>> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("society_announcement_reactions")
    .select("message_id:announcement_id, emoji, user_id")
    .in("announcement_id", ids);
  return groupReactionsByMessage(
    (data ?? []) as unknown as {
      message_id: string;
      emoji: string;
      user_id: string;
    }[],
    ids
  );
}
