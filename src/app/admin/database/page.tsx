import Link from "next/link";
import { PageHeader, Table, Th, Td, Tag, rowClass } from "@/components/admin/kit";
import { requireSuperAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

type TableInfo = {
  name: string;
  kind: "table" | "view" | "matview";
  rows: number;
  size: string;
  columns: number;
};

const nf = new Intl.NumberFormat("en-US");

export default async function DatabasePage() {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_tables");
  const tables = (data ?? []) as TableInfo[];
  const totalRows = tables.reduce((n, t) => n + (t.rows || 0), 0);

  return (
    <>
      <PageHeader
        title="Database"
        count={tables.length}
        sub={`Every table & view · ${nf.format(totalRows)} live rows (est.). super_admin only.`}
      />

      {error ? (
        <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-error">
          {error.message}
        </p>
      ) : (
        <Table minWidth={560}>
          <thead>
            <tr>
              <Th>Relation</Th>
              <Th>Kind</Th>
              <Th className="text-right">Rows (est.)</Th>
              <Th className="text-right">Cols</Th>
              <Th className="text-right">Size</Th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.name} className={rowClass}>
                <Td>
                  <Link
                    href={`/admin/database/${t.name}`}
                    className="font-mono font-medium text-fg hover:underline"
                  >
                    {t.name}
                  </Link>
                </Td>
                <Td>
                  <Tag>{t.kind}</Tag>
                </Td>
                <Td className="text-right font-mono tabular-nums text-fg">
                  {nf.format(t.rows)}
                </Td>
                <Td className="text-right font-mono tabular-nums text-fg-muted">
                  {t.columns}
                </Td>
                <Td className="text-right font-mono text-fg-muted">{t.size}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
