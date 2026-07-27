import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";

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
 *
 * Request-memoized: the console shell resolves the role in two places (the
 * sidebar and the mobile topbar stream independently) and every admin page
 * calls it again, so without `cache` one render fanned out into several
 * identical round trips.
 */
export const getAdminContext = cache(async (): Promise<AdminContext> => {
  const supabase = await createClient();
  // Verified locally from the session JWT — no Auth API round trip. Middleware
  // has already blocked non-admins from /admin, and the admin_role read below
  // plus RLS remain the authority on what this user may actually do.
  const userId = await getAuthUserId();
  if (!userId) redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("admin_role")
    .eq("id", userId)
    .single();

  const role = (data?.admin_role ?? null) as AdminRole | null;
  if (!role) redirect("/home");

  return { userId, role, isSuper: role === "super_admin" };
});

/** Gate a page/action to super_admin only; moderators bounce to the console home. */
export async function requireSuperAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx.isSuper) redirect("/admin");
  return ctx;
}
