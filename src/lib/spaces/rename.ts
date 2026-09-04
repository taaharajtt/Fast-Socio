// ===========================================================================
// Renaming a "space" — a society, a chat room, or an event.
//
// The three surfaces had the same rule written three times as inline literals
// (2–60 for a community, 2–120 for an event) next to three different copies of
// "who is allowed". This module is the single pure statement of both, so the
// action and the control can be checked against ONE definition.
//
// The DATABASE is still the authority: `rename_community` and `rename_event`
// (both mig 0178) re-validate the bounds and re-check the authority under
// SECURITY DEFINER. Everything here mirrors those functions to drive the UI and
// to return a good message before a round trip — keep the two in step.
// ===========================================================================

/** The kinds of space that can be renamed. */
export type SpaceKind = "community" | "society" | "event";

export type TitleRule = {
  min: number;
  max: number;
  /** What the field is called in messages, e.g. "Name" / "Title". */
  noun: string;
};

/**
 * Bounds are the DB CHECK constraints, not new policy:
 *   communities.name  — `char_length(name) between 2 and 60`   (mig 0009)
 *   events.title      — 2..120, enforced by `rename_event`     (mig 0178)
 */
export const TITLE_RULES: Record<SpaceKind, TitleRule> = {
  community: { min: 2, max: 60, noun: "Name" },
  society: { min: 2, max: 60, noun: "Name" },
  event: { min: 2, max: 120, noun: "Title" },
};

export type TitleCheck =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validate a proposed title against its space's rule.
 *
 * Trims first, exactly as the SQL's `btrim` does, so "  ok  " is measured as
 * the two characters that will actually be stored — not the six that were
 * typed. The returned `value` is what should be sent, so no caller has to
 * remember to trim again.
 */
export function validateTitle(kind: SpaceKind, raw: string): TitleCheck {
  const rule = TITLE_RULES[kind];
  const value = (raw ?? "").trim();
  if (value.length < rule.min || value.length > rule.max)
    return {
      ok: false,
      error: `${rule.noun} must be ${rule.min}–${rule.max} characters.`,
    };
  return { ok: true, value };
}

/** Is this a real edit, or the same name typed back? */
export function isUnchangedTitle(current: string, next: string): boolean {
  return (current ?? "").trim() === (next ?? "").trim();
}

/**
 * Society/room rename authority, mirroring `rename_community` (mig 0178).
 *
 * OWNER OR ADMIN, and deliberately nobody else. This is narrower than
 * `canEditProfile`, which lets a president edit category/bio/banner: UAT-04
 * settled that renaming is an identity change that stays with whoever owns the
 * space, so a president who can rewrite the society's bio still cannot rename
 * it. The RPC refuses everyone else regardless of what the UI shows, and
 * `supabase/tests/uat18_verification.sql` asserts that refusal — so widening
 * this helper without widening the function would only produce a button that
 * always errors.
 */
export function canRenameCommunity(viewer: {
  isOwner: boolean;
  isAdmin: boolean;
}): boolean {
  return viewer.isOwner || viewer.isAdmin;
}

/**
 * Event rename authority, mirroring `rename_event` (mig 0178): the host, a
 * co-organizer, or an admin — the authority that already manages the event.
 */
export function canRenameEvent(viewer: {
  isHost: boolean;
  isOrganizer: boolean;
  isAdmin: boolean;
}): boolean {
  return viewer.isHost || viewer.isOrganizer || viewer.isAdmin;
}
