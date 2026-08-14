import Link from "next/link";
import { PageHeader, Table, Th, Td, field, ctrl, rowClass } from "@/components/admin/kit";
import { createClient } from "@/lib/supabase/server";
import { orIlike } from "@/lib/postgrest/search";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  // The list is capped, but the HEADER MUST REPORT THE TRUE TOTAL. It used to
  // show `rows.length`, i.e. how many rows this page happened to fetch, so it
  // read "50" for any population above 50 — the count looked like a user total
  // and was really a page size. `count: "exact"` gives the number of rows the
  // filter matches, independent of the limit.
  const PAGE_SIZE = 50;
  const term = q?.trim() ?? "";

  let query = supabase
    .from("profiles")
    .select("id, full_name, username, department, aura_score, is_banned", {
      count: "exact",
    })
    .order("aura_score", { ascending: false })
    .limit(PAGE_SIZE);
  // Search covers the roll number too: 41 profiles have no full_name, and a
  // name-only filter made them unreachable from this page.
  //
  // `term` comes straight off the query string, so it goes through orIlike
  // rather than into the template directly: a bare `%` here would drop the
  // filter to a full-table ilike scan, and a comma would append an extra
  // condition to the or() group. orIlike returns null when nothing usable is
  // left, which correctly means "show the unfiltered list".
  const search = orIlike(["full_name", "username"], term);
  if (search) query = query.or(search);

  const { data: users, count } = await query;
  const rows = users ?? [];
  const total = count ?? rows.length;
  const truncated = total > rows.length;

  return (
    <>
      <PageHeader
        title="Users"
        count={total}
        sub={
          truncated
            ? `Showing the top ${rows.length} by aura of ${total}${term ? " matching" : ""}. Search to narrow it down.`
            : "Search a student to view or adjust their record."
        }
      />

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
                  {/* The roll number identifies the 41 profiles that have no
                      full_name, which otherwise all read as "Unnamed". */}
                  {u.username && (
                    <span className="ml-1.5 font-mono text-[11px] text-fg-muted">
                      {u.username}
                    </span>
                  )}
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
