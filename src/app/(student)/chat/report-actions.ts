"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import {
  isDmReportCategory,
  normalizeSelection,
  validateDescription,
  validateSelection,
} from "@/lib/chat/dm-report";

export type SubmitDmReportResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string };

/**
 * File a selective DM report.
 *
 * Note what this function does NOT send: no sender ids, no recipient ids, no
 * timestamps, no message bodies. It forwards a conversation, a set of message
 * ids, a category and the reporter's prose, and `submit_dm_report` (migration
 * 0161) copies every identity, body and timestamp from the `messages` and
 * `conversations` rows it reads itself. A browser that lies about who said
 * what has nothing to lie with.
 *
 * The checks below are the fast path, not the guarantee — participation, the
 * 1..10 bound, cross-conversation ids, the description limits, the daily cap
 * and the duplicate guard are all re-enforced inside the transaction.
 */
export async function submitDmReport(input: {
  conversationId: string;
  messageIds: string[];
  category: string;
  description: string;
}): Promise<SubmitDmReportResult> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const ids = normalizeSelection(input.messageIds ?? []);
  const selection = validateSelection(ids.length);
  if (!selection.ok) return { ok: false, error: selection.reason };

  if (!isDmReportCategory(input.category))
    return { ok: false, error: "Choose a report category." };

  const description = (input.description ?? "").trim();
  const described = validateDescription(description);
  if (!described.ok) return { ok: false, error: described.reason };

  // App-level limiter, shared with the other report surfaces. The RPC keeps its
  // own 5-per-24h cap on DM cases specifically, which is the one that holds if
  // someone calls the RPC directly with an anon-key client.
  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds,
  );
  if (!allowed)
    return { ok: false, error: "You've filed too many reports recently." };

  const { data, error } = await supabase.rpc("submit_dm_report", {
    p_conversation_id: input.conversationId,
    p_message_ids: ids,
    p_category: input.category,
    p_description: description,
  });

  if (error) {
    // The RPC's exceptions are written to be shown to the reporter verbatim
    // ("you already have an open report for this conversation"), so surfacing
    // the message is intentional here rather than a leak — none of them
    // disclose anything the caller does not already know.
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "Could not file the report." };

  return { ok: true, reportId: data as string };
}
