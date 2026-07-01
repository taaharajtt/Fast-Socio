import {
  CommunityModRow,
  type PendingCommunity,
} from "@/components/admin/community-mod-row";
import { createClient } from "@/lib/supabase/server";

export default async function AdminCommunitiesPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("communities")
    .select("id, name, description, owner_id, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const communities = rows ?? [];

  const ownerIds = [...new Set(communities.map((c) => c.owner_id))];
  const owners = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ownerIds);
    (profs ?? []).forEach((p) => owners.set(p.id, p.full_name ?? ""));
  }

  const items: PendingCommunity[] = communities.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    ownerName: owners.get(c.owner_id) ?? null,
    createdAt: `${c.created_at.slice(0, 16).replace("T", " ")} UTC`,
  }));

  return (
    <main>
      <h1 className="text-2xl font-bold tracking-tight">Communities</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {items.length} pending approval
      </p>
      <div className="mt-5 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing to review.</p>
        ) : (
          items.map((c) => <CommunityModRow key={c.id} community={c} />)
        )}
      </div>
    </main>
  );
}
