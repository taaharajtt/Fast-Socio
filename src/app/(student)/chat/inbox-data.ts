import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import type { IncomingRequest } from "@/components/chat/request-row";
import type { OutgoingRequest } from "@/components/chat/sent-request-row";
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
    { data: acceptedIncomingRows },
    { data: joinedRows },
    { data: ownedRows },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, user_low, user_high, created_at, last_message_at, closed_at")
      .or(`user_low.eq.${me},user_high.eq.${me}`)
      // A conversation closed by an unmatch (mig 0182) leaves the inbox for
      // both parties. The thread and its history survive — report evidence
      // points at those rows — but it takes no new messages and stops
      // occupying the list. `closed_at` is selected rather than filtered in
      // PostgREST so this keeps working against a pre-0182 database, where the
      // column is simply absent and every row reads as open.
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
    // Requests WE sent. Two jobs, and the second one is new (UAT-02): once
    // we've initiated a conversation with a match they drop out of the "new
    // matches" list, AND the rows themselves are now rendered, so a sender can
    // see that their request exists and what became of it. Bounded because a
    // prolific sender should not make the Chat tab unbounded; the cap is well
    // above the messageRequest rate limit's reach for any real account.
    supabase
      .from("message_requests")
      .select("id, recipient_id, message, status, created_at")
      .eq("sender_id", me)
      .order("created_at", { ascending: false })
      .limit(50),
    // Requests we ACCEPTED. Needed for the same reason as the accepted outgoing
    // ones: the conversation they created is empty until someone speaks, and
    // without this it shows on neither panel (see `started` below).
    supabase
      .from("message_requests")
      .select("sender_id")
      .eq("recipient_id", me)
      .eq("status", "accepted")
      .limit(200),
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

  const conversations = (convRows ?? []).filter(
    (c) => !(c as { closed_at?: string | null }).closed_at
  );
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
          .select(
            "conversation_id, body, sender_id, created_at, deleted_at, read_at"
          )
          .in("conversation_id", convIds)
          .eq("hidden", false)
          .order("created_at", { ascending: false })
          .limit(300)
          .then((r) => r.data)
      : Promise.resolve(null),
    // Unread count per conversation: incoming messages the viewer hasn't read.
    // Queried separately (not from the 300-row preview page) so the count is
    // exact even in a very busy thread.
    //
    // Aggregated in SQL (migration 0172). This used to select one ROW PER
    // UNREAD MESSAGE with no limit and count them into a Map here — a query
    // whose cost grew without bound as threads went unread, on the critical
    // path of the Chat tab. `conversation_unread_counts()` returns one row per
    // conversation instead. It takes no arguments: RLS on `messages` scopes it
    // to the viewer's own conversations, which is exactly `convIds` (the
    // conversations query above is unfiltered and unlimited), so the result set
    // is identical.
    convIds.length > 0
      ? supabase.rpc("conversation_unread_counts").then((r) => r.data)
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
  // MY newest message per conversation, for the Sent/Seen status line. Read off
  // the same descending page as the preview, so it costs no extra query.
  const lastOutgoing = new Map<
    string,
    { createdAt: string; readAt: string | null }
  >();
  for (const m of lastMsgRows ?? []) {
    if (m.sender_id === me && !lastOutgoing.has(m.conversation_id)) {
      lastOutgoing.set(m.conversation_id, {
        createdAt: m.created_at as string,
        readAt: (m.read_at as string | null) ?? null,
      });
    }
    if (lastMsg.has(m.conversation_id)) continue;
    const prefix = m.sender_id === me ? "You: " : "";
    // A deleted message keeps its row (read receipts reference it) but its body
    // is blanked, so it must not preview as an empty line (UAT-009).
    const text = m.deleted_at
      ? "Message deleted"
      : (m.body || "Sent an attachment");
    lastMsg.set(m.conversation_id, `${prefix}${text}`);
  }

  // One row per conversation now, already counted (see the RPC above). The
  // column names are the function's (`conv_id` / `unread_count`) — a `returns
  // table` output column cannot share a name with the column it selects from.
  const unread = new Map<string, number>();
  for (const r of (unreadRows ?? []) as {
    conv_id: string;
    unread_count: number;
  }[]) {
    unread.set(r.conv_id, Number(r.unread_count ?? 0));
  }

  // Resolve referenced profiles in one query.
  const otherIds = new Set<string>();
  conversations.forEach((c) =>
    otherIds.add(c.user_low === me ? c.user_high : c.user_low)
  );
  requests.forEach((r) => otherIds.add(r.sender_id));
  (outgoingReqRows ?? []).forEach((r) => otherIds.add(r.recipient_id as string));
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
        .select("id, full_name, avatar_url, gender, department, read_receipts")
        .in("id", ids),
      supabase.from("profile_presence").select("id, last_seen_at").in("id", ids),
    ]);
    const seen = new Map(
      (presRows ?? []).map((r) => [r.id as string, r.last_seen_at as string | null])
    );
    for (const p of profRows ?? []) {
      profiles[p.id] = {
        ...p,
        last_seen_at: seen.get(p.id) ?? null,
        // Absent column (older database) is treated as ON, matching the
        // thread's own default.
        read_receipts: (p as { read_receipts?: boolean }).read_receipts !== false,
      };
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
  //
  // UAT-02 adds a third reason a conversation belongs in Messages: an ACCEPTED
  // request. Acceptance removes the row from Requests (it is no longer pending)
  // while the conversation is still empty, so under the old two-clause rule the
  // thread existed in the database and appeared on NEITHER panel — which is
  // exactly the "accepted requests vanish" report. An accepted pair is a
  // conversation whether or not anyone has spoken yet.
  const acceptedPartners = new Set(
    (outgoingReqRows ?? [])
      .filter((r) => r.status === "accepted")
      .map((r) => r.recipient_id as string)
  );
  for (const r of acceptedIncomingRows ?? [])
    acceptedPartners.add(r.sender_id as string);

  const started = new Set(
    conversations
      .filter(
        (c) =>
          lastMsg.has(c.id as string) ||
          acceptedPartners.has(
            (c.user_low === me ? c.user_high : c.user_low) as string
          ) ||
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
          lastOutgoing: lastOutgoing.get(convId) ?? null,
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
    (outgoingReqRows ?? [])
      .filter((r) => r.status !== "declined")
      .map((r) => r.recipient_id as string)
  );
  const newMatches = matches
    .map((m) => (m.user_low === me ? m.user_high : m.user_low))
    .filter((id) => !startedOtherIds.has(id) && !initiatedIds.has(id));

  // Sent requests, newest first. An accepted one carries the conversation id so
  // the row opens the real thread; once that thread has a message it graduates
  // to Messages and drops out of this list, which is the visible hand-off.
  const convByOther = new Map(
    conversations.map((c) => [
      (c.user_low === me ? c.user_high : c.user_low) as string,
      c.id as string,
    ])
  );
  const outgoing: OutgoingRequest[] = (outgoingReqRows ?? [])
    .filter((r) => {
      if (r.status !== "accepted") return true;
      const convId = convByOther.get(r.recipient_id as string);
      return !convId || !lastMsg.has(convId);
    })
    .map((r) => {
      const p = profiles[r.recipient_id as string];
      return {
        id: r.id as string,
        message: r.message as string,
        status: r.status as OutgoingRequest["status"],
        createdAt: r.created_at as string,
        recipientName: p?.full_name ?? "Student",
        recipientAvatar: resolveAvatarUrl(p?.avatar_url, p?.gender),
        conversationId: convByOther.get(r.recipient_id as string) ?? null,
      };
    });

  return { me, threads, newMatches, profiles, incoming, outgoing };
}
