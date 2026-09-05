import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchChatBadge, toBadge, type ChatBadge } from "@/lib/chat/badge-count";
import {
  fetchCommunityBadge,
  toCommunityBadge,
  type CommunityBadge,
} from "@/lib/community/badge-count";
import { activityVisibleTypeList } from "@/lib/notifications/view";
import { getAuthUserId } from "@/lib/auth/user";

export type Announcement = {
  id: string;
  data: Record<string, unknown> | null;
  created_at: string;
};

export type HomeBootstrap = {
  chat: ChatBadge;
  community: CommunityBadge;
  announcements: Announcement[];
  activityUnread: number;
};

/**
 * Every per-viewer read the student shell needs, in ONE round trip.
 *
 * Perf audit follow-up. An authenticated /home render made ~9 PostgREST round
 * trips to Frankfurt; four of them were independent reads that always occur
 * together on the same screen and all key off auth.uid() — the two dock badges,
 * the broadcast announcements and the Activity unread count. Issued in
 * parallel they were still four network legs. `home_bootstrap()` (migration
 * 0174) returns all four.
 *
 * Request-memoised with React `cache`, so the layout shell and the Home page's
 * Activity badge — which stream inside SEPARATE Suspense boundaries — share one
 * call rather than racing two. Memoisation before caching, deliberately: this
 * is per-viewer, RLS-scoped data and must never enter a shared `use cache`
 * scope, where it would be served to whoever asked next.
 *
 * FALLS BACK to the four original reads if the RPC is missing or errors, so
 * this is safe to deploy BEFORE 0174 is applied — the app simply keeps making
 * the round trips it makes today. That fallback is not fail-open in any
 * security sense: every path here is RLS-scoped to the caller either way.
 */
export const getHomeBootstrap = cache(async (): Promise<HomeBootstrap> => {
  const supabase = await createClient();
  const types = activityVisibleTypeList();

  const { data, error } = await supabase.rpc("home_bootstrap", {
    p_activity_types: types,
  });

  if (!error && data && typeof data === "object") {
    const row = data as Record<string, unknown>;
    // The badge helpers own the shape rules (0169's `conversations` marker,
    // 0183's unread-updates count). Reuse them on the embedded payloads rather
    // than re-deriving totals here, so one definition stays authoritative.
    const chat = readChat(row.chat);
    const community = readCommunity(row.community);
    if (chat && community) {
      return {
        chat,
        community,
        announcements: Array.isArray(row.announcements)
          ? (row.announcements as Announcement[])
          : [],
        activityUnread: Number(row.activity_unread ?? 0),
      };
    }
  }

  return legacyBootstrap();
});

/** The pre-0174 path: four reads, exactly as the shell used to make them. */
async function legacyBootstrap(): Promise<HomeBootstrap> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) {
    return { chat: EMPTY_CHAT, community: EMPTY_COMMUNITY, announcements: [], activityUnread: 0 };
  }

  const [chat, community, { data: announcements }, { count }] = await Promise.all([
    fetchChatBadge(supabase, userId),
    fetchCommunityBadge(supabase),
    supabase
      .from("notifications")
      .select("id, data, created_at")
      .eq("user_id", userId)
      .eq("type", "announcement")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("notifications_live")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null)
      .in("type", activityVisibleTypeList()),
  ]);

  return {
    chat,
    community,
    announcements: (announcements ?? []) as Announcement[],
    activityUnread: count ?? 0,
  };
}

const EMPTY_CHAT: ChatBadge = toBadge(0, 0);
const EMPTY_COMMUNITY: CommunityBadge = toCommunityBadge({});

/**
 * Narrow the embedded chat payload; null means "not the shape we expect", which
 * sends the caller to the legacy path rather than rendering a wrong number.
 *
 * The `conversations` check is migration 0169's compatibility marker, and it is
 * the same test src/lib/chat/badge-count.ts makes: its presence proves this is a
 * 0169-or-later database rather than 0166's MESSAGE count wearing the same key.
 * Trusting a 0166 payload here would reintroduce the exact bug 0169 fixed.
 */
function readChat(value: unknown): ChatBadge | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.conversations === undefined) return null;
  const conversations = Number(row.conversations ?? 0);
  const requests = Number(row.requests ?? 0);
  if (!Number.isFinite(conversations) || !Number.isFinite(requests)) return null;
  return toBadge(conversations, requests);
}

/**
 * Narrow the embedded community payload through the SAME rule the direct reader
 * uses — `toCommunityBadge` owns migration 0183's definition (unread Community
 * updates, never chat, never a platform-wide creation count), so it must not be
 * re-derived here.
 *
 * A pre-0183 database answers with 0170's six-part breakdown, which carries no
 * `updates` key and resolves to zero: no badge rather than a wrong one, so this
 * client is safe to deploy before the migration is applied.
 */
function readCommunity(value: unknown): CommunityBadge | null {
  if (!value || typeof value !== "object") return null;
  return toCommunityBadge(value as Record<string, unknown>);
}
