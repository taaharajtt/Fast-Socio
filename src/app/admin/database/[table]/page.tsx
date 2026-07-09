import Link from "next/link";
import { notFound } from "next/navigation";
import { TableBrowser } from "@/components/admin/table-browser";
import { requireSuperAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

export type ColumnMeta = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
};

type TableMeta = {
  columns: ColumnMeta[];
  pk: string[];
  indexes: { name: string; def: string }[];
  fks: Record<string, string>;
};

const PAGE_SIZE = 50;

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string }>;
  searchParams: Promise<{ page?: string; q?: string; sort?: string; dir?: string }>;
}) {
  await requireSuperAdmin();
  const { table } = await params;
  const { page, q, sort, dir } = await searchParams;
  const supabase = await createClient();

  const { data: metaData, error: metaErr } = await supabase.rpc("admin_table_meta", {
    p_table: table,
  });
  if (metaErr || !metaData) notFound();
  const meta = metaData as TableMeta;

  const pageNum = Math.max(0, Number.parseInt(page ?? "0", 10) || 0);
  const { data: rowsData } = await supabase.rpc("admin_table_rows", {
    p_table: table,
    p_limit: PAGE_SIZE,
    p_offset: pageNum * PAGE_SIZE,
    p_search: q ?? null,
    p_order_by: sort ?? null,
    p_order_dir: dir ?? "asc",
  });

  const result = (rowsData ?? { rows: [], total: 0 }) as {
    rows: Record<string, unknown>[];
    total: number;
  };

  // Only single-column PK tables support inline edit/delete; views are read-only.
  const pkCol = meta.pk.length === 1 ? meta.pk[0] : null;
  const isView = false; // views are excluded from row editing at the RPC level anyway

  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Link
          href="/admin/database"
          className="font-mono text-[11px] uppercase tracking-wide text-fg-muted hover:text-fg"
        >
          ← Database
        </Link>
      </div>

      <TableBrowser
        table={table}
        columns={meta.columns}
        pkCol={pkCol}
        fks={meta.fks}
        isView={isView}
        rows={result.rows}
        total={result.total}
        pageSize={PAGE_SIZE}
        page={pageNum}
        q={q ?? ""}
        sort={sort ?? ""}
        dir={dir === "desc" ? "desc" : "asc"}
        indexes={meta.indexes}
      />
    </>
  );
}
