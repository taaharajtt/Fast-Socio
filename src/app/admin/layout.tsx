import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSidebar, AdminTopbar } from "@/components/admin/admin-nav";

/**
 * Admin console shell. Role-gated: only profiles with is_admin = true may enter;
 * anyone else is bounced to the app. Deliberately minimal — a control centre, not
 * a consumer screen (no floating dock; UI Spec §4). Feature slices live under
 * this group and share the sidebar/topbar nav.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) redirect("/home");

  return (
    <div className="min-h-full bg-bg text-fg">
      <AdminTopbar />
      <div className="flex">
        <AdminSidebar />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
