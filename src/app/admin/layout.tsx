import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin shell. Role-gated: only profiles with is_admin = true may enter; anyone
 * else is bounced to the app. No floating dock here (UI Spec §4: dock hidden on
 * /admin). Feature-specific admin views live as slices under this group.
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
    <div className="min-h-full bg-bg">
      <header className="border-b border-glass-border px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <Link href="/admin" className="font-bold">
            <span className="gradient-brand-text">FAST SOCIO</span> Admin
          </Link>
          <nav className="flex gap-3 text-sm text-fg-muted">
            <Link href="/admin/reports?type=profile" className="hover:text-fg">
              Reports
            </Link>
          </nav>
          <Link href="/home" className="ml-auto text-sm text-fg-muted hover:text-fg">
            Exit
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-6">{children}</div>
    </div>
  );
}
