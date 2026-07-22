/**
 * Pure society domain logic — no React, Supabase, or lucide imports so it stays
 * unit-testable and shared between server and client. The DATABASE (mig 0103) is
 * the real authority on every permission; these helpers mirror those rank rules
 * to drive the UI and are covered by logic.test.ts.
 */

export const SOCIETY_CATEGORIES = [
  "academic",
  "sports",
  "arts",
  "tech",
  "volunteer",
  "departmental",
  "cultural",
  "religious",
  "other",
] as const;
export type SocietyCategory = (typeof SOCIETY_CATEGORIES)[number];

export function isSocietyCategory(v: unknown): v is SocietyCategory {
  return typeof v === "string" && (SOCIETY_CATEGORIES as readonly string[]).includes(v);
}

/** Officer roles that live in the society_roles overlay (excludes owner/member). */
export const SOCIETY_OFFICER_ROLES = [
  "president",
  "vice_president",
  "officer",
  "event_manager",
  "media",
  "moderator",
] as const;
export type SocietyOfficerRole = (typeof SOCIETY_OFFICER_ROLES)[number];

/** Every role a viewer can hold relative to a society. */
export type SocietyRole = "owner" | SocietyOfficerRole | "member";

export function isOfficerRole(v: unknown): v is SocietyOfficerRole {
  return (
    typeof v === "string" &&
    (SOCIETY_OFFICER_ROLES as readonly string[]).includes(v)
  );
}

/**
 * Numeric hierarchy — kept identical to society_role_name_rank() in mig 0103.
 * Higher outranks lower. `member` is a follower with no officer powers.
 */
export const ROLE_RANK: Record<SocietyRole, number> = {
  owner: 100,
  president: 90,
  vice_president: 80,
  officer: 60,
  event_manager: 50,
  media: 40,
  moderator: 30,
  member: 10,
};

export function roleRank(role: SocietyRole | null | undefined): number {
  return role ? (ROLE_RANK[role] ?? 0) : 0;
}

/** Rank at or above which a role may open the management dashboard. */
export const MANAGE_MIN_RANK = ROLE_RANK.moderator; // 30 — any officer or the owner
/** Rank required to assign/remove officer roles (president & up, or admin). */
export const ROLE_ADMIN_MIN_RANK = ROLE_RANK.president; // 90

export type Viewer = { role: SocietyRole | null; isAdmin: boolean };

/** Can this viewer reach /societies/[id]/manage? */
export function canManageSociety(viewer: Viewer): boolean {
  return viewer.isAdmin || roleRank(viewer.role) >= MANAGE_MIN_RANK;
}

/**
 * Can this viewer grant `targetRole`? You must be president+ (or admin) and you
 * can never grant a role at or above your own. Mirrors assign_society_role().
 */
export function canAssignRole(
  viewer: Viewer,
  targetRole: SocietyOfficerRole
): boolean {
  if (viewer.isAdmin) return true;
  const mine = roleRank(viewer.role);
  return mine >= ROLE_ADMIN_MIN_RANK && roleRank(targetRole) < mine;
}

/**
 * Can this viewer remove someone currently holding `targetRole`? Same rule as
 * assigning: president+/admin, and never someone at or above your own rank.
 * Mirrors remove_society_role().
 */
export function canRemoveRole(viewer: Viewer, targetRole: SocietyRole): boolean {
  if (viewer.isAdmin) return true;
  const mine = roleRank(viewer.role);
  return mine >= ROLE_ADMIN_MIN_RANK && roleRank(targetRole) < mine;
}

/** Officer roles this viewer is allowed to hand out (for the role picker UI). */
export function assignableRoles(viewer: Viewer): SocietyOfficerRole[] {
  return SOCIETY_OFFICER_ROLES.filter((r) => canAssignRole(viewer, r));
}

/** Can this viewer post announcements? Any officer or the owner (or admin). */
export function canPostAnnouncement(viewer: Viewer): boolean {
  return canManageSociety(viewer);
}

/** Can this viewer edit the society profile? Any officer or the owner (or admin). */
export function canEditProfile(viewer: Viewer): boolean {
  return canManageSociety(viewer);
}
