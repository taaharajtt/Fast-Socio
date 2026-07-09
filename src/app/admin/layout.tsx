import { AdminSidebar, AdminTopbar } from "@/components/admin/admin-nav";
import { getAdminContext } from "@/lib/admin/access";

/**
 * Admin console shell. Role-gated via getAdminContext: non-admins bounce to the
 * app; the resolved tier (moderator vs super_admin) drives which nav sections
 * appear. Deliberately minimal — a control centre, not a consumer screen (no
 * floating dock; UI Spec §4). Feature slices live under this group.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, isSuper } = await getAdminContext();

  return (
    <div className="min-h-full bg-bg text-fg">
      <AdminTopbar isSuper={isSuper} />
      <div className="flex">
        <AdminSidebar isSuper={isSuper} role={role} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
