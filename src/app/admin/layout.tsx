import { Suspense } from "react";
import { AdminSidebar, AdminTopbar } from "@/components/admin/admin-nav";
import { getAdminContext } from "@/lib/admin/access";
import AdminLoading from "./loading";

/**
 * Admin console shell. Deliberately minimal — a control centre, not a consumer
 * screen (no floating dock; UI Spec §4). Feature slices live under this group.
 *
 * The console is role-tiered: `super_admin` sees the database/infra/broadcast
 * sections, `moderator` does not. Resolving that tier is a query, so it streams
 * — the nav renders immediately at the moderator tier and the super-only
 * sections fill in. Nothing here is a security boundary: middleware keeps
 * non-admins out of /admin entirely, every admin page re-checks its own tier
 * via getAdminContext/requireSuperAdmin, and RLS gates the data itself.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-bg text-fg">
      <Suspense fallback={<AdminTopbar isSuper={false} />}>
        <AdminTopbarSlot />
      </Suspense>
      <div className="flex">
        <Suspense fallback={<AdminSidebar isSuper={false} role="moderator" />}>
          <AdminSidebarSlot />
        </Suspense>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          {/* Same reasoning as the student shell: the console chrome renders
              without waiting on the page's queries. /admin ships a loading.tsx
              that nests below this and covers most sections; deeper segments
              (the table browser, a user detail) fall back to this one. */}
          <div className="mx-auto max-w-5xl">
            <Suspense fallback={<AdminLoading />}>{children}</Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

async function AdminTopbarSlot() {
  const { isSuper } = await getAdminContext();
  return <AdminTopbar isSuper={isSuper} />;
}

async function AdminSidebarSlot() {
  const { role, isSuper } = await getAdminContext();
  return <AdminSidebar isSuper={isSuper} role={role} />;
}
