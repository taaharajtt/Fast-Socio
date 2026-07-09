import Link from "next/link";
import { PageHeader, Table, Th, Td, field, ctrl, rowClass } from "@/components/admin/kit";
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
    .select("id, full_name, department, aura_score, is_banned")
    .order("aura_score", { ascending: false })
    .limit(50);
  if (q && q.trim()) query = query.ilike("full_name", `%${q.trim()}%`);

  const { data: users } = await query;
  const rows = users ?? [];

  return (
    <>
      <PageHeader title="Users" count={rows.length} sub="Search a student to view or adjust their record." />

      <form method="GET" className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name…"
          className={`${field} flex-1`}
        />
        <button type="submit" className={ctrl}>
          Search
        </button>
      </form>

      <Table minWidth={560}>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Department</Th>
            <Th>Status</Th>
            <Th className="text-right">Aura</Th>
            <Th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Td className="text-fg-muted" >
                No users found.
              </Td>
              <Td /><Td /><Td /><Td />
            </tr>
          ) : (
            rows.map((u) => (
              <tr key={u.id} className={rowClass}>
                <Td>
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="font-medium text-fg hover:underline"
                  >
                    {u.full_name ?? "Unnamed"}
                  </Link>
                </Td>
                <Td className="text-fg-muted">{u.department ?? "—"}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-xs text-fg">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        u.is_banned ? "bg-error" : "bg-success"
                      }`}
                    />
                    {u.is_banned ? "Banned" : "Active"}
                  </span>
                </Td>
                <Td className="text-right font-mono tabular-nums text-fg">
                  {u.aura_score}
                </Td>
                <Td className="text-right text-fg-disabled">
                  <Link href={`/admin/users/${u.id}`} aria-label="Open">
                    ›
                  </Link>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </>
  );
}
