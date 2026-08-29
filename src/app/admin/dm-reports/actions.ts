"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/access";

type Result = { ok: true } | { ok: false; error: string };

export type DmCaseStatus = "pending" | "reviewing" | "actioned" | "dismissed";

/**
 * Case-scoped moderation actions.
 *
 * There is deliberately no action here for banning, striking, suspending or
 * shadow-banning. Those already exist as audited RPCs behind
 * `src/app/admin/moderation-actions.ts` and `/admin/users/[id]`, and the case
 * page links to them. Reimplementing them here would mean two code paths that
 * have to stay in agreement about what an escalating strike does, and the
 * second one always drifts.
 */

/** Set case status (pending / reviewing / actioned / dismissed). Audited in SQL. */
export async function setCaseStatus(
  reportId: string,
  status: DmCaseStatus,
): Promise<Result> {
  await getAdminContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_dm_report_update", {
    p_report_id: reportId,
    p_status: status,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/dm-reports/${reportId}`);
  revalidatePath("/admin/dm-reports");
  return { ok: true };
}

/** Assign the case to the acting moderator, or clear the assignment. Audited. */
export async function setCaseAssignment(
  reportId: string,
  assign: boolean,
): Promise<Result> {
  const ctx = await getAdminContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_dm_report_update", {
    p_report_id: reportId,
    p_assign_to: assign ? ctx.userId : null,
    p_clear_assignee: !assign,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/dm-reports/${reportId}`);
  return { ok: true };
}

/** Append an internal note to the case history. Audited (stored as the audit
 *  row's reason, where the rest of the trail keeps its rationale). */
export async function addCaseNote(
  reportId: string,
  note: string,
): Promise<Result> {
  await getAdminContext();
  const text = note.trim();
  if (text.length < 3) return { ok: false, error: "Write a note first." };
  if (text.length > 2000) return { ok: false, error: "Note is too long." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_dm_report_update", {
    p_report_id: reportId,
    p_note: text,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/dm-reports/${reportId}`);
  return { ok: true };
}

/**
 * Hide or restore a reported message.
 *
 * The RPC refuses any message that is not evidence in this case, so this
 * cannot be used as a general "hide any DM" control — that capability was
 * removed in migration 0160 and is not coming back through this door.
 *
 * Hiding removes the message from both participants' threads. It does not and
 * cannot retract a screenshot, an already-delivered notification, an offline
 * client's copy, or a database backup.
 */
export async function setReportedMessageHidden(
  reportId: string,
  messageId: string,
  hidden: boolean,
): Promise<Result> {
  await getAdminContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_dm_report_hide_message", {
    p_report_id: reportId,
    p_message_id: messageId,
    p_hidden: hidden,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/dm-reports/${reportId}`);
  return { ok: true };
}
