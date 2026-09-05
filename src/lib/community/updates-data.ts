import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { resolveAvatarUrl } from "@/lib/avatar";
import { timeAgo } from "@/lib/time";
import { notificationView } from "@/lib/notifications/view";
import { isNotificationType, notificationSegments } from "@/lib/notifications/copy";
import {
  isActionableUpdate,
  UPDATES_PAGE_SIZE,
  type CommunityUpdate,
} from "@/lib/community/updates";

/**
 * Reading the Community Updates list.
 *
 * THE SOURCE IS THE VIEW, NOT A HAND-BUILT QUERY. `public.community_updates`
 * (migration 0183) is the same set `community_badge_count()` counts, and it
 * already applies:
 *
 *   * the type allow-list — chat and platform-wide creation events are absent;
 *   * the subject cascade — an update never outlives the community, event, post
 *     or announcement it points at (it is built on `notifications_live`);
 *   * liveness — a join request that another manager has since decided, a post
 *     already approved, or a queue the reader no longer manages, all drop out;
 *   * RLS — the view is `security_invoker`, so the policy on `notifications`
 *     scopes it to the caller and nothing here has to re-derive "mine".
 *
 * So a row rendered here is a row counted there, by construction. The count is
 * NOT derived from the loaded page: `total` and `unread` come from separate
 * exact counts, so paging never changes the badge.
 *
 * Copy and destinations come from `notificationView` — the app's one notif copy
 * and URL builder — rather than a second set of strings that could drift from
 * the Activity panel's.
 */

type Row = {
  id: string;
  actor_id: string | null;
  type: string;
  data: Record<string, unknown>;
  group_count: number | null;
  read_at: string | null;
  created_at: string;
};

const COLUMNS = "id, actor_id, type, data, group_count, read_at, created_at";

export type UpdatesPage = {
  items: CommunityUpdate[];
  /** More rows exist after the last one returned. */
  hasMore: boolean;
  /** Cursor for the next page — the last row's (created_at, id). */
  cursor: string | null;
};

export type UpdatesData = UpdatesPage & {
  /** Authoritative unread count for ALL accessible updates, not just this page. */
  unread: number;
};

/**
 * UNREAD FIRST, then read — newest first within each half.
 *
 * PostgREST cannot express "nulls first on read_at, then created_at desc"
 * across a keyset cursor cleanly, so the two halves are paged SEPARATELY and
 * the cursor names which half it is in (`unread|<ts>` / `read|<ts>`). That
 * matters for the student this screen is most for: with 40 unread updates, a
 * naive "unread page then read page" would hand back 25 unread and then page
 * only the read half, stranding the other 15 where nothing could reach them
 * while the badge still counted them. Here the unread half is exhausted first,
 * and only then does paging move on to the read half.
 *
 * The unread COUNT never comes from any of this — it is its own exact count, so
 * paging cannot change the badge.
 */
export async function loadCommunityUpdates(
  cursor?: string | null
): Promise<UpdatesData> {
  const supabase = await createClient();
  const me = await getAuthUserId();
  if (!me) return { items: [], hasMore: false, cursor: null, unread: 0 };

  const [{ count: unreadCount }, page] = await Promise.all([
    supabase
      .from("community_updates")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
    fetchPage(supabase, cursor ?? null),
  ]);

  const rows = page.rows;
  const actorIds = [
    ...new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[]),
  ];
  const actors = new Map<string, { name: string | null; avatar: string | null }>();
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, gender")
      .in("id", actorIds);
    for (const p of profs ?? []) {
      actors.set(p.id, {
        name: p.full_name,
        avatar: resolveAvatarUrl(p.avatar_url, p.gender),
      });
    }
  }

  return {
    items: rows.map((row) => toUpdate(row, actors)),
    hasMore: page.hasMore,
    cursor: page.cursor,
    unread: unreadCount ?? 0,
  };
}

type Client = Awaited<ReturnType<typeof createClient>>;
type Half = "unread" | "read";

/** `<half>|<created_at>` — the half is part of the cursor because the two are
 *  paged independently and a bare timestamp could not say which. */
function parseCursor(cursor: string | null): { half: Half; at: string } | null {
  if (!cursor) return null;
  const [half, ...rest] = cursor.split("|");
  if (half !== "unread" && half !== "read") return null;
  // An EMPTY timestamp is legal and means "the start of this half" — it is what
  // the handover cursor carries when a page ends exactly on the last unread row.
  return { half, at: rest.join("|") };
}

/** One ordered slice of one half. `+1` row answers "is there more" without a
 *  second count query. */
async function slice(
  supabase: Client,
  half: Half,
  before: string | null,
  limit: number
): Promise<{ rows: Row[]; more: boolean }> {
  let q = supabase.from("community_updates").select(COLUMNS);
  q = half === "unread" ? q.is("read_at", null) : q.not("read_at", "is", null);
  if (before) q = q.lt("created_at", before);
  const { data } = await q.order("created_at", { ascending: false }).limit(limit + 1);
  const rows = (data ?? []) as Row[];
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

async function fetchPage(
  supabase: Client,
  rawCursor: string | null
): Promise<{ rows: Row[]; hasMore: boolean; cursor: string | null }> {
  const parsed = parseCursor(rawCursor);
  const inRead = parsed?.half === "read";

  // Still in the unread half (or starting fresh): drain it first.
  if (!inRead) {
    const unread = await slice(
      supabase,
      "unread",
      parsed?.at || null,
      UPDATES_PAGE_SIZE
    );
    if (unread.more) {
      const last = unread.rows[unread.rows.length - 1];
      return {
        rows: unread.rows,
        hasMore: true,
        cursor: `unread|${last.created_at}`,
      };
    }
    // Unread is exhausted; top the page up from the read half.
    const room = UPDATES_PAGE_SIZE - unread.rows.length;
    if (room <= 0) {
      return { rows: unread.rows, hasMore: true, cursor: "read|" };
    }
    const read = await slice(supabase, "read", null, room);
    const last = read.rows[read.rows.length - 1];
    return {
      rows: [...unread.rows, ...read.rows],
      hasMore: read.more,
      cursor: last ? `read|${last.created_at}` : null,
    };
  }

  // Read half, continuing. An empty `at` means "start of the read half".
  const read = await slice(
    supabase,
    "read",
    parsed.at || null,
    UPDATES_PAGE_SIZE
  );
  const last = read.rows[read.rows.length - 1];
  return {
    rows: read.rows,
    hasMore: read.more,
    cursor: last ? `read|${last.created_at}` : null,
  };
}

function toUpdate(
  row: Row,
  actors: Map<string, { name: string | null; avatar: string | null }>
): CommunityUpdate {
  const actor = row.actor_id ? actors.get(row.actor_id) : undefined;
  const view = notificationView(
    row.type,
    actor?.name ?? null,
    row.data ?? {},
    row.group_count ?? 1
  );
  const count = row.group_count ?? 1;
  return {
    id: row.id,
    type: row.type,
    text: view.text,
    // Emphasis is computed HERE, on the server, from the same centralized copy
    // the text came from — so the client renders spans and never parses a
    // sentence or builds markup from user-supplied names.
    segments: isNotificationType(row.type)
      ? notificationSegments(row.type, actor?.name ?? null, row.data ?? {}, count)
      : [{ text: view.text, strong: false }],
    href: view.href,
    unread: row.read_at === null,
    actionable: isActionableUpdate(row.type),
    createdAt: row.created_at,
    timeAgo: `${timeAgo(row.created_at)} ago`,
    actorName: actor?.name ?? null,
    avatar: actor?.avatar ?? null,
  };
}
