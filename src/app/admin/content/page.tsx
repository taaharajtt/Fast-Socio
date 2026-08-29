import Link from "next/link";
import { PageHeader, field, ctrl } from "@/components/admin/kit";
import { ContentRow, type ContentItem } from "@/components/admin/content-row";
import { getAdminContext } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import type { ContentType } from "@/app/admin/content/actions";

/**
 * Two tabs are gone from this browser, and neither is coming back.
 *
 * "DMs" listed every one-to-one conversation in the product and linked to a
 * full transcript viewer. "Messages" was worse and less obvious: a global,
 * searchable feed of every private message body, with no conversation scoping
 * at all — typing a word into the search box ran an ilike across the whole
 * `messages` table. Both are removed here and the RPCs behind them are dropped
 * or raise (migration 0160).
 *
 * Private messages now reach a moderator only when a participant selects them
 * in a report: /admin/dm-reports. Community chat stays — it is a group surface
 * with a different privacy expectation and is out of scope for that change.
 */
const TABS: { key: ContentType; label: string }[] = [
  { key: "post", label: "Posts" },
  { key: "comment", label: "Comments" },
  { key: "community", label: "Community" },
];
const PAGE_SIZE = 50;

const isContentType = (v: string): v is ContentType =>
  TABS.some((t) => t.key === v);

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  await getAdminContext();
  const { tab: rawTab, q, page } = await searchParams;
  // An old bookmark to ?tab=dm or ?tab=message lands on Posts rather than
  // erroring — the RPC would refuse it anyway.
  const tab: ContentType =
    rawTab && isContentType(rawTab) ? rawTab : "post";
  const pageNum = Math.max(0, Number.parseInt(page ?? "0", 10) || 0);
  const supabase = await createClient();

  const { data } = await supabase.rpc("admin_content_feed", {
    p_type: tab,
    p_search: q ?? null,
    p_limit: PAGE_SIZE,
    p_offset: pageNum * PAGE_SIZE,
  });
  const res = (data ?? { rows: [], total: 0 }) as {
    rows: ContentItem[];
    total: number;
  };
  const items = res.rows;
  const total = res.total;

  const qp = (over: Record<string, string>) => {
    const sp = new URLSearchParams({ tab, ...(q ? { q } : {}), ...over });
    return `/admin/content?${sp}`;
  };

  return (
    <>
      <PageHeader
        title="Content"
        count={total}
        sub="Moderate posts, comments and community chat."
      />

      {/* Tabs */}
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-glass-border">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={`/admin/content?tab=${t.key}`}
            className={
              t.key === tab
                ? "-mb-px border-b-2 border-fg px-3 py-1.5 text-xs font-medium text-fg"
                : "px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
            }
          >
            {t.label}
          </a>
        ))}
      </nav>

      {/* Search */}
      <form method="GET" className="mb-4 flex gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search body text…"
          className={`${field} flex-1`}
        />
        <button type="submit" className={ctrl}>
          Search
        </button>
      </form>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
            No {tab}s.
          </p>
        ) : (
          items.map((it) => <ContentRow key={it.id} item={it} type={tab} />)
        )}
      </div>

      {(pageNum > 0 || (pageNum + 1) * PAGE_SIZE < total) && (
        <div className="mt-4 flex items-center justify-between text-xs text-fg-muted">
          <span className="font-mono">
            {total === 0
              ? "0"
              : `${pageNum * PAGE_SIZE + 1}–${Math.min((pageNum + 1) * PAGE_SIZE, total)}`}{" "}
            of {total}
          </span>
          <div className="flex gap-2">
            {pageNum > 0 && (
              <Link href={qp({ page: String(pageNum - 1) })} className={ctrl}>
                ← Prev
              </Link>
            )}
            {(pageNum + 1) * PAGE_SIZE < total && (
              <Link href={qp({ page: String(pageNum + 1) })} className={ctrl}>
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
