import {
  MODE_META,
  POST_MODES,
  DISCOVER_MODES,
  type PostMode,
} from "@/lib/smart-match/modes";
import type { ApplicationStatus } from "@/lib/smart-match/types";

// ---------------------------------------------------------------------------
// Pure validation + payload building for smart-match posts. All unit-tested;
// no I/O. The server RPC re-checks the hard constraints (defense in depth), but
// these give fast, friendly client-side feedback and shape the jsonb payload.
// ---------------------------------------------------------------------------

export const validDiscoverModes = DISCOVER_MODES;
export const validPostModes = POST_MODES;

export const MAX_PEOPLE_NEEDED = 20;
export const MIN_PEOPLE_NEEDED = 1;

export type PostFormValues = Record<string, string | string[]>;

/** JSON-ready payload keyed by smart_match_posts columns (RPC jsonb). */
export type PostPayload = Record<string, string | string[] | null>;

/** Normalize a comma-string or array into trimmed, de-duped, capped tags. */
export function normalizeSkills(v: string | string[] | undefined, max = 20): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const t = item.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Accept only a well-formed https URL (hackathon / portfolio links). Returns the
 * normalized href, or null if unsafe/malformed. Never allows javascript:, data:,
 * http:, or anything without a hostname.
 */
export function safeUrl(raw: string | undefined | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!u.hostname || !u.hostname.includes(".")) return null;
  return u.href;
}

/** Parse people_needed → 1..20 or null. `ok:false` when present but invalid. */
export function validatePeopleNeeded(
  v: string | number | undefined | null
): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < MIN_PEOPLE_NEEDED || n > MAX_PEOPLE_NEEDED)
    return { ok: false };
  return { ok: true, value: n };
}

/** True when `v` is empty or a parseable timestamp. */
export function validateScheduledAt(v: string | undefined | null): boolean {
  const s = (v ?? "").trim();
  if (!s) return true;
  return !Number.isNaN(Date.parse(s));
}

function asScalar(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v.join(", ") : (v ?? "");
  const t = s.trim();
  return t ? t : null;
}

/**
 * Fold flat form values onto the smart_match_posts jsonb payload for `mode`.
 * Tag fields become arrays; url fields are https-sanitized; team-member
 * mentions are handled separately (not part of the payload).
 */
export function buildPostPayload(mode: PostMode, values: PostFormValues): PostPayload {
  const payload: PostPayload = {};
  for (const field of MODE_META[mode].fields) {
    if (field.type === "mentions") continue;
    const raw = values[field.key];
    if (field.type === "tags") {
      payload[field.key] = normalizeSkills(raw);
    } else if (field.type === "url") {
      payload[field.key] = safeUrl(asScalar(raw));
    } else {
      payload[field.key] = asScalar(raw);
    }
  }
  // Recruitment anchor (set by the form, not a generic field spec).
  if (mode === "recruitment") {
    payload.society_id = asScalar(values.society_id);
    payload.event_id = asScalar(values.event_id);
  }
  return payload;
}

/** True when every required field for the mode has a value. Pure + tested. */
export function validatePostInput(
  mode: PostMode,
  values: PostFormValues
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  for (const field of MODE_META[mode].fields) {
    if (!field.required) continue;
    const raw = values[field.key];
    const empty =
      raw === undefined ||
      (field.type === "tags"
        ? normalizeSkills(raw).length === 0
        : asScalar(raw) === null);
    if (empty) missing.push(field.label);
  }
  // Recruitment must be anchored to a society or event the author runs.
  if (mode === "recruitment") {
    if (!asScalar(values.society_id) && !asScalar(values.event_id))
      missing.push("Society or event");
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}

// ---------------------------------------------------------------------------
// Application status transitions. The author accepts/declines; the applicant
// cancels. Only a PENDING application can change. Pure + tested; the DB RPCs
// enforce the same rules server-side.
// ---------------------------------------------------------------------------
export type ApplicationAction = "accept" | "decline" | "cancel";

const TRANSITIONS: Record<ApplicationAction, ApplicationStatus> = {
  accept: "accepted",
  decline: "declined",
  cancel: "cancelled",
};

/** The resulting status for an action on a pending app, or null if illegal. */
export function nextApplicationStatus(
  from: ApplicationStatus,
  action: ApplicationAction
): ApplicationStatus | null {
  if (from !== "pending") return null;
  return TRANSITIONS[action];
}

export function canTransition(
  from: ApplicationStatus,
  action: ApplicationAction
): boolean {
  return nextApplicationStatus(from, action) !== null;
}
