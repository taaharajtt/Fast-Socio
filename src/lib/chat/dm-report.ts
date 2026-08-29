/**
 * Selective DM reporting — shared constants and pure validation.
 *
 * These limits are duplicated in SQL (`submit_dm_report`, migration 0161) and
 * that duplication is deliberate: the SQL copy is the enforcement, this copy is
 * the affordance. The UI uses it to disable the submit button and count
 * characters before a round trip; it is not, and must not be treated as, a
 * security control. Anything that matters is re-checked in the RPC against
 * trusted rows.
 */

/** A participant may disclose at most this many messages in one report. */
export const MAX_REPORT_MESSAGES = 10;
export const MIN_REPORT_MESSAGES = 1;

export const MIN_DESCRIPTION_LENGTH = 20;
export const MAX_DESCRIPTION_LENGTH = 1000;

/** Report categories. `value` is what the SQL check constraint accepts. */
export const DM_REPORT_CATEGORIES = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "sexual_content", label: "Unwanted sexual content" },
  { value: "threat_or_violence", label: "Threats or violence" },
  { value: "spam_or_scam", label: "Spam or scam" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Something else" },
] as const;

export type DmReportCategory = (typeof DM_REPORT_CATEGORIES)[number]["value"];

const CATEGORY_VALUES = new Set<string>(
  DM_REPORT_CATEGORIES.map((c) => c.value),
);

export function isDmReportCategory(v: unknown): v is DmReportCategory {
  return typeof v === "string" && CATEGORY_VALUES.has(v);
}

/** The disclosure notice shown before submission. Exported so the test suite
 *  can assert the exact wording the product committed to. */
export const DISCLOSURE_NOTICE =
  "The selected messages, their senders, timestamps, and your description will " +
  "be shared with FAST SOCIO moderators. No other messages from this " +
  "conversation will be shared.";

/**
 * Why a given message cannot be disclosed, or null if it can.
 *
 * A message the sender already unsent has no body left to disclose — the row
 * survives for read receipts but its content was cleared — so selecting it
 * would file empty evidence. An optimistic row that has not been acknowledged
 * by the server yet has no real id to reference.
 */
export function undisclosableReason(m: {
  id: string;
  deleted_at: string | null;
}): string | null {
  if (m.deleted_at) return "This message was deleted, so it can't be reported.";
  if (m.id.startsWith("temp-")) return "This message is still sending.";
  return null;
}

export function canDisclose(m: { id: string; deleted_at: string | null }): boolean {
  return undisclosableReason(m) === null;
}

export type SelectionValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** Whether the current selection is a submittable size. */
export function validateSelection(count: number): SelectionValidation {
  if (count < MIN_REPORT_MESSAGES)
    return { ok: false, reason: "Select at least one message." };
  if (count > MAX_REPORT_MESSAGES)
    return {
      ok: false,
      reason: `Select at most ${MAX_REPORT_MESSAGES} messages.`,
    };
  return { ok: true };
}

/** Whether the typed description is submittable. Trims before measuring, so
 *  whitespace cannot pad a report to the minimum. */
export function validateDescription(raw: string): SelectionValidation {
  const text = raw.trim();
  if (text.length < MIN_DESCRIPTION_LENGTH)
    return {
      ok: false,
      reason: `Describe what happened in at least ${MIN_DESCRIPTION_LENGTH} characters.`,
    };
  if (text.length > MAX_DESCRIPTION_LENGTH)
    return {
      ok: false,
      reason: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`,
    };
  return { ok: true };
}

/**
 * Normalize a selection for submission: unique, and capped.
 *
 * The cap is applied after deduplication so that a selection containing
 * repeats is not silently truncated to fewer distinct messages than the user
 * chose. Order is preserved — the RPC re-derives evidence order from the
 * messages' own timestamps, so this ordering is presentational only.
 */
export function normalizeSelection(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, MAX_REPORT_MESSAGES);
}

/** Human summary of what a selected message will disclose, for the review step. */
export function evidenceSummary(m: {
  body: string | null;
  attachment_type: "image" | "voice" | null;
  shared_post_id: string | null;
}): string {
  if (m.body && m.body.trim().length > 0) return m.body;
  if (m.attachment_type === "image") return "Photo attachment";
  if (m.attachment_type === "voice") return "Voice note";
  if (m.shared_post_id) return "Shared post";
  return "Empty message";
}
