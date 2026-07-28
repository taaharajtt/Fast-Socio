import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import type { IncomingRequest } from "@/components/chat/request-row";
import { resolveAvatarUrl } from "@/lib/avatar";
import {
  EPOCH,
  type InboxData,
  type InboxProfile,
  type InboxSpace,
  type InboxThread,
} from "@/lib/chat/inbox-types";

// Re-exported so server callers can keep importing the loader and its types
// from one place.
export type {
  InboxData,
  InboxProfile,
  InboxSpace,
  InboxThread,
} from "@/lib/chat/inbox-types";

/**
 * The inbox read, extracted from the page so it has exactly one implementation.
 *
 * It is called from two places: the /chat page (first render) and the
 * `refreshInbox` server action (when realtime says something changed). Before
 * this split, "something changed" meant `router.refresh()` — a full RSC
 * re-render of the layout AND the page — several times a minute in an active
 * conversation. Now a new message re-runs only these queries and replaces one
 * list's state.
 *
 * Everything returned is plain JSON so it can cross the server/client boundary
 * and live in client state. RLS scopes every query to the caller.
 */

export async function loadInbox(): Promise<InboxData> {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip; RLS is authoritative.
  const me = (await getAuthUserId())!;

  const [
    { data: convRows },
    { data: reqRows },
    { data: matchRows },
    { data: outgoingReqRows },
    { data: joinedRows },
    { data: ownedRows },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, user_low, user_high, last_message_at")
      .or(`user_low.eq.${me},user_high.eq.${me}`)
      .order("last_message_at", { ascending: false }),
    supabase
      .from("message_requests")
      .select("id, message, sender_id, created_at")
      .eq("recipient_id", me)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("matches")
      .select("id, user_low, user_high, created_at")
      .or(`user_low.eq.${me},user_high.eq.${me}`)
      .order("created_at", { ascending: false }),
    // Requests WE sent (UAT-018): once we've initiated a conversation with a
    // match, they should drop out of the "new matches" list.
    supabase
      .from("message_requests")
      .select("recipient_id")
      .eq("sender_id", me),
    // Community rooms you've been approved into are conversations too, so they
    // belong in this inbox rather than behind the Community tab. Owned spaces
    // are unioned in because an owner participates without necessarily holding
    // a community_members row.
    supabase
      .from("community_members")
      .select(
        "community:communities(id, name, avatar_url, cover_url, is_society, status)"
      )
      .eq("user_id", me),
    supabase
      .from("communities")
      .select("id, name, avatar_url, cover_url, is_society, status")
      .eq("owner_id", me),
  ]);

  const spaces = new Map<string, InboxSpace>();
  for (const r of (joinedRows ?? []) as unknown as {
    community: InboxSpace | null;
  }[]) {
    if (r.community?.status === "approved") spaces.set(r.community.id, r.community);
  }
  for (const c of (ownedRows ?? []) as unknown as InboxSpace[]) {
    if (c.status === "approved") spaces.set(c.id, c);
  }
  const spaceIds = [...spaces.keys()];

  const conversations = convRows ?? [];
  const requests = reqRows ?? [];
  const matches = matchRows ?? [];
  const convIds = conversations.map((c) => c.id);

  // The three follow-up reads depend only on the ids gathered above, so they go
  // out together rather than one after another.
  const [spacePreviewRows, lastMsgRows, unreadRows] = await Promise.all([
    // Newest message per room, for the row preview and the recency sort. Read
    // through community_chat_view so an anonymous sender stays masked here too.
    spaceIds.length > 0
      ? supabase
          .from("community_chat_view")
          .select(
            "community_id, sender_id, sender_name, body, is_anonymous, created_at"
          )
          .in("community_id", spaceIds)
          .order("created_at", { ascending: false })
          .limit(400)
          .then((r) => r.data)
      : Promise.resolve(null),
    convIds.length > 0
      ? supabase
          .from("messages")
          .select("conversation_id, body, sender_id, created_at, deleted_at")
          .in("conversation_id", convIds)
          .eq("hidden", false)
          .order("created_at", { ascending: false })
          .limit(300)
          .then((r) => r.data)
      : Promise.resolve(null),
    // Unread count per conversation: incoming messages the viewer hasn't read.
    // Queried separately (not from the 300-row preview page) so the count is
    // exact even in a very busy thread.
    convIds.length > 0
      ? supabase
          .from("messages")
          .select("conversation_id")
          .in("conversation_id", convIds)
          .neq("sender_id", me)
          .is("read_at", null)
          .eq("hidden", false)
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const spacePreview = new Map<string, { text: string; ts: string }>();
  for (const m of spacePreviewRows ?? []) {
    if (spacePreview.has(m.community_id)) continue;
    const who = m.is_anonymous
      ? m.sender_id === me
        ? "You (anonymous)"
        : "Anonymous"
      : m.sender_id === me
        ? "You"
        : (m.sender_name ?? "Member");
    spacePreview.set(m.community_id, {
      text: `${who}: ${m.body || "Shared a poll"}`,
      ts: m.created_at,
    });
  }

  const lastMsg = new Map<string, string>();
  for (const m of lastMsgRows ?? []) {
    if (lastMsg.has(m.conversation_id)) continue;
    const prefix = m.sender_id === me ? "You: " : "";
    // A deleted message keeps its row (read receipts reference it) but its body
    // is blanked, so it must not preview as an empty line (UAT-009).
    const text = m.deleted_at
      ? "Message deleted"
      : (m.body || "Sent an attachment");
    lastMsg.set(m.conversation_id, `${prefix}${text}`);
  }

  const unread = new Map<string, number>();
  for (const m of unreadRows ?? []) {
    unread.set(m.conversation_id, (unread.get(m.conversation_id) ?? 0) + 1);
  }

  // Resolve referenced profiles in one query.
  const otherIds = new Set<string>();
  conversations.forEach((c) =>
    otherIds.add(c.user_low === me ? c.user_high : c.user_low)
  );
  requests.forEach((r) => otherIds.add(r.sender_id));
  matches.forEach((m) =>
    otherIds.add(m.user_low === me ? m.user_high : m.user_low)
  );

  const profiles: Record<string, InboxProfile> = {};
  if (otherIds.size > 0) {
    const ids = [...otherIds];
    // Presence lives in profile_presence (mig 0092) and is RLS-gated on the
    // owner's show_online, so this returns rows only for people who publish it.
    // Anyone who has it switched off is simply absent → last_seen_at null →
    // rendered offline. The list used to read profiles.last_seen_at and show an
    // online dot regardless of the setting.
    const [{ data: profRows }, { data: presRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, avatar_url, gender, department")
        .in("id", ids),
      supabase.from("profile_presence").select("id, last_seen_at").in("id", ids),
    ]);
    const seen = new Map(
      (presRows ?? []).map((r) => [r.id as string, r.last_seen_at as string | null])
    );
    for (const p of profRows ?? []) {
      profiles[p.id] = { ...p, last_seen_at: seen.get(p.id) ?? null };
    }
  }

  const incoming: IncomingRequest[] = requests.map((r) => {
    const p = profiles[r.sender_id];
    return {
      id: r.id,
      message: r.message,
      senderName: p?.full_name ?? "Student",
      senderAvatar: resolveAvatarUrl(p?.avatar_url, p?.gender),
      senderDept: p?.department ?? null,
    };
  });

  // One recency-sorted inbox holding both kinds of conversation. Community
  // rooms sit inline with direct messages — same row shape, distinguished by a
  // small capsule — because Chat now owns every live conversation in the app.
  const threads: InboxThread[] = [
    ...conversations.map((c): InboxThread => {
      const convId = c.id as string;
      return {
        kind: "dm",
        ts: c.last_message_at ?? EPOCH,
        convId,
        otherId: c.user_low === me ? c.user_high : c.user_low,
        preview: lastMsg.get(convId) ?? null,
        unread: unread.get(convId) ?? 0,
      };
    }),
    ...[...spaces.values()].map((space): InboxThread => {
      const p = spacePreview.get(space.id);
      return {
        kind: "space",
        ts: p?.ts ?? EPOCH,
        space,
        preview: p?.text ?? null,
      };
    }),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  // Matches that don't yet have a conversation AND that we haven't already
  // reached out to — surfaced so a chat can start. A match we've messaged (open
  // conversation or a pending outgoing request) is removed here (UAT-018).
  const convOtherIds = new Set(
    conversations.map((c) => (c.user_low === me ? c.user_high : c.user_low))
  );
  const initiatedIds = new Set(
    (outgoingReqRows ?? []).map((r) => r.recipient_id as string)
  );
  const newMatches = matches
    .map((m) => (m.user_low === me ? m.user_high : m.user_low))
    .filter((id) => !convOtherIds.has(id) && !initiatedIds.has(id));

  return { me, threads, newMatches, profiles, incoming };
}
