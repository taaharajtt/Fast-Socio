import { CommunityAdminRow, type AdminCommunity } from "@/components/admin/community-admin-row";
import { PageHeader } from "@/components/admin/kit";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/access";

const FILTERS = ["pending", "approved", "rejected", "all"];

export default async function AdminCommunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { isSuper } = await getAdminContext();
  const { status = "pending" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("communities")
    .select("id, name, description, owner_id, member_count, status, created_at, is_society, is_official")
    .order("created_at", { ascending: false });
  if (status !== "all") query = query.eq("status", status);

  const { data: rows } = await query;
  const communities = rows ?? [];

  const ownerIds = [...new Set(communities.map((c) => c.owner_id))];
  const owners = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ownerIds);
    (profs ?? []).forEach((p) => owners.set(p.id, p.full_name ?? ""));
  }

  const items: AdminCommunity[] = communities.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    ownerName: owners.get(c.owner_id) ?? null,
    memberCount: c.member_count ?? 0,
    status: c.status,
    createdAt: `${c.created_at.slice(0, 16).replace("T", " ")} UTC`,
    isSociety: Boolean(c.is_society),
    isOfficial: Boolean(c.is_official),
  }));

  return (
    <>
      <PageHeader title="Communities" count={items.length} sub="Approve, reject or remove communities." />

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-glass-border">
        {FILTERS.map((f) => (
          <a
            key={f}
            href={`/admin/communities?status=${f}`}
            className={
              f === status
                ? "-mb-px border-b-2 border-fg px-3 py-1.5 text-xs font-medium text-fg"
                : "px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
            }
          >
            {f}
          </a>
        ))}
      </nav>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
            No {status === "all" ? "" : status} communities.
          </p>
        ) : (
          items.map((c) => <CommunityAdminRow key={c.id} community={c} isSuper={isSuper} />)
        )}
      </div>
    </>
  );
}
