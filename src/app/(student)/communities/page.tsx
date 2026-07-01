import Link from "next/link";
import { Plus, Users, Clock } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

type Community = {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  status: string;
  owner_id: string;
};

export default async function CommunitiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  // Approved communities (RLS also returns my own pending ones).
  const { data: rows } = await supabase
    .from("communities")
    .select("id, name, description, member_count, status, owner_id")
    .order("member_count", { ascending: false });
  const communities = (rows ?? []) as Community[];

  const approved = communities.filter((c) => c.status === "approved");
  const myPending = communities.filter(
    (c) => c.status === "pending" && c.owner_id === me
  );

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Communities</h1>
        <Link
          href="/communities/new"
          className="glass flex h-10 w-10 items-center justify-center rounded-full text-fg-muted hover:text-fg"
          aria-label="Create community"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Link>
      </div>

      {myPending.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-medium text-fg-muted">
            Awaiting approval
          </h2>
          <div className="space-y-2">
            {myPending.map((c) => (
              <GlassCard key={c.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="text-xs text-fg-muted">
                    Pending admin review
                  </p>
                </div>
                <GlassChip tone="warning">
                  <Clock className="mr-1 h-3 w-3" aria-hidden /> pending
                </GlassChip>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-medium text-fg-muted">Discover</h2>
        {approved.length === 0 ? (
          <GlassCard className="p-5">
            <p className="text-sm text-fg-muted">
              No communities yet. Be the first to start one.
            </p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {approved.map((c) => (
              <Link key={c.id} href={`/communities/${c.id}`} className="block">
                <GlassCard className="flex items-center gap-3 p-4">
                  <div className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                    <Users className="h-5 w-5 text-fg-muted" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    {c.description && (
                      <p className="truncate text-xs text-fg-muted">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-fg-muted">
                    {c.member_count} member{c.member_count === 1 ? "" : "s"}
                  </span>
                </GlassCard>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
