"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import { redeploy } from "@/lib/admin/infra";

/**
 * Redeploy a build to production. The newest deployment id → plain redeploy;
 * an older READY id → instant rollback. super_admin only; audited.
 */
export async function redeployTo(
  deploymentId: string,
  label: string,
): Promise<{ error: string } | { ok: true }> {
  const { userId } = await requireSuperAdmin();
  try {
    await redeploy(deploymentId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  // Audit (best-effort — never block the deploy on the log).
  try {
    const supabase = await createClient();
    await supabase.rpc("log_admin_action", {
      p_action: "infra.redeploy",
      p_reason: label,
      p_metadata: { deploymentId, by: userId },
    });
  } catch {
    /* ignore */
  }
  revalidatePath("/admin/infra");
  return { ok: true };
}
