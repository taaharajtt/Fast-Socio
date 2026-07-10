"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import {
  redeploy,
  updateAuthConfig,
  upsertEnvVar,
  deleteEnvVar,
  type SbAuthConfig,
} from "@/lib/admin/infra";

type Res = { error: string } | { ok: true };

/** Audit an infra action (best-effort — never block the operation on the log). */
async function audit(action: string, reason: string, metadata: Record<string, unknown>) {
  try {
    const supabase = await createClient();
    await supabase.rpc("log_admin_action", {
      p_action: action,
      p_reason: reason,
      p_metadata: metadata,
    });
  } catch {
    /* ignore */
  }
}

/**
 * Redeploy a build to production. The newest deployment id → plain redeploy;
 * an older READY id → instant rollback. super_admin only; audited.
 */
export async function redeployTo(deploymentId: string, label: string): Promise<Res> {
  const { userId } = await requireSuperAdmin();
  try {
    await redeploy(deploymentId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await audit("infra.redeploy", label, { deploymentId, by: userId });
  revalidatePath("/admin/infra");
  return { ok: true };
}

/** Toggle a Supabase auth setting (e.g. require email confirmation). */
export async function setAuthFlag(
  key: keyof SbAuthConfig,
  value: boolean,
): Promise<Res> {
  await requireSuperAdmin();
  try {
    await updateAuthConfig({ [key]: value } as Partial<SbAuthConfig>);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await audit("infra.auth_config", `${String(key)} = ${value}`, { key, value });
  revalidatePath("/admin/infra");
  return { ok: true };
}

/** Add or overwrite an encrypted Vercel env var. The value is never read back. */
export async function saveEnvVar(
  key: string,
  value: string,
  targets: string[],
): Promise<Res> {
  await requireSuperAdmin();
  if (!/^[A-Z0-9_]+$/i.test(key)) return { error: "Key must be alphanumeric/underscore." };
  if (!value) return { error: "Value is required." };
  if (targets.length === 0) return { error: "Pick at least one environment." };
  try {
    await upsertEnvVar(key, value, targets);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await audit("infra.env_set", key, { key, targets });
  revalidatePath("/admin/infra");
  return { ok: true };
}

export async function removeEnvVar(envId: string, key: string): Promise<Res> {
  await requireSuperAdmin();
  try {
    await deleteEnvVar(envId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await audit("infra.env_delete", key, { key, envId });
  revalidatePath("/admin/infra");
  return { ok: true };
}
