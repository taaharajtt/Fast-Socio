import Link from "next/link";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, full_name, department, aura_score")
    .order("aura_score", { ascending: false })
    .limit(30);
  if (q && q.trim()) query = query.ilike("full_name", `%${q.trim()}%`);

  const { data: users } = await query;

  return (
    <main>
      <h1 className="text-2xl font-bold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Search a student to view or adjust their Aura.
      </p>

      <form method="GET" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name…"
          className="glass h-10 flex-1 rounded-[var(--radius-pill)] px-4 text-sm text-fg outline-none placeholder:text-fg-muted"
        />
        <button
          type="submit"
          className="rounded-[var(--radius-pill)] bg-aura px-4 text-sm text-white"
        >
          Search
        </button>
      </form>

      <div className="mt-5 space-y-2">
        {(users ?? []).map((u) => (
          <Link key={u.id} href={`/admin/users/${u.id}`} className="block">
            <GlassCard className="flex items-center justify-between p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {u.full_name ?? "Unnamed"}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  {u.department ?? "—"}
                </p>
              </div>
              <span className="text-sm text-aura">★ {u.aura_score}</span>
            </GlassCard>
          </Link>
        ))}
        {(users ?? []).length === 0 && (
          <p className="text-sm text-fg-muted">No users found.</p>
        )}
      </div>
    </main>
  );
}
