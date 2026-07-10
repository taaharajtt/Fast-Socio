import { PageHeader } from "@/components/admin/kit";
import { SqlConsole } from "@/components/admin/sql-console";
import { requireSuperAdmin } from "@/lib/admin/access";

export default async function SqlConsolePage() {
  await requireSuperAdmin();

  return (
    <>
      <PageHeader
        title="SQL console"
        sub="Run one statement against production. Reads are capped at 1000 rows; writes need the confirm toggle. Every query is audited. super_admin only."
      />
      <SqlConsole />
    </>
  );
}
