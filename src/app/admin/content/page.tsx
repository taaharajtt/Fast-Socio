import Link from "next/link";
import { PageHeader, field, ctrl } from "@/components/admin/kit";
import { ContentRow, type ContentItem } from "@/components/admin/content-row";
import { getAdminContext } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import type { ContentType } from "@/app/admin/content/actions";

const TABS: { key: string; label: string }[] = [
  { key: "post", label: "Posts" },
  { key: "comment", label: "Comments" },
  { key: "message", label: "Messages" },
  { key: "community", label: "Community" },
  { key: "dm", label: "DMs" },
];
const PAGE_SIZE = 50;

type Convo = {
  id: string;
  low_name: string;
  high_name: string;
  last_message_at: string | null;
  count: number;
};

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  await getAdminContext();
  const { tab = "post", q, page } = await searchParams;
  const pageNum = Math.max(0, Number.parseInt(page ?? "0", 10) || 0);
  const supabase = await createClient();

  const isDm = tab === "dm";
  let items: ContentItem[] = [];
  let convos: Convo[] = [];
  let total = 0;

  if (isDm) {
    const { data } = await supabase.rpc("admin_dm_conversations", {
      p_search: q ?? null,
      p_limit: PAGE_SIZE,
      p_offset: pageNum * PAGE_SIZE,
    });
    convos = (data ?? []) as Convo[];
  } else {
    const { data } = await supabase.rpc("admin_content_feed", {
      p_type: tab,
      p_search: q ?? null,
      p_limit: PAGE_SIZE,
      p_offset: pageNum * PAGE_SIZE,
    });
    const res = (data ?? { rows: [], total: 0 }) as { rows: ContentItem[]; total: number };
    items = res.rows;
    total = res.total;
  }

  const qp = (over: Record<string, string>) => {
    const sp = new URLSearchParams({ tab, ...(q ? { q } : {}), ...over });
    return `/admin/content?${sp}`;
  };

  return (
    <>
      <PageHeader
        title="Content"
        count={isDm ? convos.length : total}
        sub="Moderate posts, comments, messages, community chat and DMs."
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
          placeholder={isDm ? "Search by participant name…" : "Search body text…"}
          className={`${field} flex-1`}
        />
        <button type="submit" className={ctrl}>
          Search
        </button>
      </form>

      {isDm ? (
        <div className="space-y-2">
          {convos.length === 0 ? (
            <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
              No conversations.
            </p>
          ) : (
            convos.map((c) => (
              <Link
                key={c.id}
                href={`/admin/content/dm/${c.id}`}
                className="flex items-center justify-between rounded-[4px] border border-glass-border px-4 py-3 hover:bg-card/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {c.low_name} <span className="text-fg-muted">↔</span> {c.high_name}
                  </p>
                  <p className="font-mono text-[11px] text-fg-muted">
                    {c.count} messages
                    {c.last_message_at
                      ? ` · last ${c.last_message_at.slice(0, 16).replace("T", " ")} UTC`
                      : ""}
                  </p>
                </div>
                <span className="text-fg-disabled">›</span>
              </Link>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
                No {tab}s.
              </p>
            ) : (
              items.map((it) => <ContentRow key={it.id} item={it} type={tab as ContentType} />)
            )}
          </div>

          {(pageNum > 0 || (pageNum + 1) * PAGE_SIZE < total) && (
            <div className="mt-4 flex items-center justify-between text-xs text-fg-muted">
              <span className="font-mono">
                {total === 0 ? "0" : `${pageNum * PAGE_SIZE + 1}–${Math.min((pageNum + 1) * PAGE_SIZE, total)}`} of {total}
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
      )}
    </>
  );
}
