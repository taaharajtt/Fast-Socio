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
      .select("id, user_low, user_high, created_at, last_message_at")
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
    // DISCOVER TEAM ROOMS ONLY. A Discover room has no profile page of its own
    // — the conversation is the entire product — so /chat is where it lives.
    // Every other space (community chat room, society/verified community) hosts
    // its conversation on the room itself and is excluded here.
    //
    // The membership read cannot narrow on the embedded flag without an inner-
    // join filter on the embed, which fails the WHOLE query (returning an empty
    // inbox) if PostgREST ever disagrees about the alias. `is_discover_group` is
    // therefore selected and matched immediately below instead — the real
    // column, still in the data layer, and impossible to fail silently. The
    // owned read has no embed, so it narrows in SQL.
    supabase
      .from("community_members")
      .select(
        "community:communities(id, name, avatar_url, cover_url, is_society, is_official, status, is_discover_group, discover_mode, discover_title)"
      )
      .eq("user_id", me),
    supabase
      .from("communities")
      .select(
        "id, name, avatar_url, cover_url, is_society, is_official, status, is_discover_group, discover_mode, discover_title"
      )
      .eq("owner_id", me)
      .eq("is_discover_group", true),
  ]);

  const spaces = new Map<string, InboxSpace>();
  const keepRoom = (c: InboxSpace | null | undefined): c is InboxSpace =>
    Boolean(c) && c!.status === "approved" && c!.is_discover_group === true;
  for (const r of (joinedRows ?? []) as unknown as {
    community: InboxSpace | null;
  }[]) {
    if (keepRoom(r.community)) spaces.set(r.community.id, r.community);
  }
  for (const c of (ownedRows ?? []) as unknown as InboxSpace[]) {
    if (keepRoom(c)) spaces.set(c.id, c);
  }
  const spaceIds = [...spaces.keys()];

  const conversations = convRows ?? [];
  const requests = reqRows ?? [];
  const matches = matchRows ?? [];
  const convIds = conversations.map((c) => c.id);

  // The three follow-up reads depend only on the ids gathered above, so they go
  // out together rather than one after another.
  const [spacePreviewRows, lastMsgRows, unreadRows] = await Promise.all([
    // Newest message per Discover room, for the row preview and the recency
    // sort. Read through community_chat_view so an anonymous sender stays
    // masked here too.
    spaceIds.length > 0
      ? supabase
          .from("community_chat_view")
          .select(
            "community_id, sender_id, sender_name, body, is_anonymous, created_at, deleted_at, attachment_type, poll_id"
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
    // Mirrors the DM preview below. A tombstone and an image both have an empty
    // body (migs 0142/0143), so "empty means poll" is no longer true — without
    // this, a deleted message or a photo would preview as a blank line.
    const what = m.deleted_at
      ? "Message deleted"
      : m.attachment_type === "image"
        ? "Sent a photo"
        : m.body || (m.poll_id ? "Shared a poll" : "Sent an attachment");
    spacePreview.set(m.community_id, {
      text: `${who}: ${what}`,
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

  // A conversation belongs in Messages only once it has actually started.
  // `last_message_at` defaults to the row's creation time and is bumped by the
  // mig-0006 trigger to the newest message's timestamp, so `> created_at` means
  // "at least one message has ever been sent here" — independent of the 300-row
  // preview window above, and independent of hiding/deleting individual
  // messages. The preview map is OR-ed in so a thread we can visibly quote is
  // never demoted, whatever the timestamps say.
  const started = new Set(
    conversations
      .filter(
        (c) =>
          lastMsg.has(c.id as string) ||
          new Date(c.last_message_at as string).getTime() >
            new Date(c.created_at as string).getTime()
      )
      .map((c) => c.id as string)
  );

  // One recency-sorted list of started conversations: direct threads, and
  // Discover team rooms inline beside them. Community chat rooms and verified
  // communities used to be unioned in here too — their conversation now lives
  // inside the room (Community -> Room -> Chat), and `keepRoom` above is what
  // keeps them out.
  //
  // A Discover room is always a Messages row, never a Requests one: Requests is
  // for things that are not conversations yet (pending message requests, new
  // matches), and a room you are in is a conversation whether or not anyone has
  // spoken in it.
  const threads: InboxThread[] = [
    ...conversations
      .filter((c) => started.has(c.id as string))
      .map((c): InboxThread => {
        const convId = c.id as string;
        return {
          kind: "dm",
          ts: c.last_message_at as string,
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

  // Matches with no STARTED conversation. These are the Requests panel's "new
  // match" rows: a match whose conversation row exists but holds no message is
  // still a new match, not a thread, so it is counted here rather than being
  // lost between the two panels. A match we have already reached out to via a
  // pending message request stays hidden (UAT-018).
  const startedOtherIds = new Set(
    conversations
      .filter((c) => started.has(c.id as string))
      .map((c) => (c.user_low === me ? c.user_high : c.user_low))
  );
  const initiatedIds = new Set(
    (outgoingReqRows ?? []).map((r) => r.recipient_id as string)
  );
  const newMatches = matches
    .map((m) => (m.user_low === me ? m.user_high : m.user_low))
    .filter((id) => !startedOtherIds.has(id) && !initiatedIds.has(id));

  return { me, threads, newMatches, profiles, incoming };
}
