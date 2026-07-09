import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AdminRole = "moderator" | "super_admin";

export type AdminContext = {
  userId: string;
  role: AdminRole;
  isSuper: boolean;
};

/**
 * Resolve the current admin's role, redirecting non-admins out. Used by the
 * admin layout and by every admin page/action that needs the caller's tier.
 * `super_admin` unlocks the database browser, SQL console and infra tier;
 * `moderator` gets content/user/report moderation only.
 */
export async function getAdminContext(): Promise<AdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("admin_role")
    .eq("id", user.id)
    .single();

  const role = (data?.admin_role ?? null) as AdminRole | null;
  if (!role) redirect("/home");

  return { userId: user.id, role, isSuper: role === "super_admin" };
}

/** Gate a page/action to super_admin only; moderators bounce to the console home. */
export async function requireSuperAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx.isSuper) redirect("/admin");
  return ctx;
}
