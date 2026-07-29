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

export type Viewer = {
  role: SocietyRole | null;
  isAdmin: boolean;
  /** Present where a self-vs-other check is needed (canResignRole). */
  me?: string;
};

/** Can this viewer reach /societies/[id]/manage? */
export function canManageSociety(viewer: Viewer): boolean {
  return viewer.isAdmin || roleRank(viewer.role) >= MANAGE_MIN_RANK;
}

/**
 * Can this viewer grant `targetRole`? fix-024: appointment is the OWNER's alone
 * — a president or any other officer may no longer appoint. Mirrors
 * assign_society_role() as rewritten in mig 0131.
 */
export function canAssignRole(viewer: Viewer): boolean {
  return viewer.isAdmin || viewer.role === "owner";
}

/**
 * Can this viewer demote someone holding `targetRole`? The owner (or an admin)
 * only. An officer resigning their OWN role is a separate affordance — see
 * canResignRole — and is allowed by remove_society_role() in mig 0131.
 */
export function canRemoveRole(viewer: Viewer): boolean {
  return viewer.isAdmin || viewer.role === "owner";
}

/** An officer may always step down from their own role (fix-024 default). */
export function canResignRole(viewer: Viewer, targetUserId: string): boolean {
  return viewer.me === targetUserId && isOfficerRole(viewer.role);
}

/** Officer roles this viewer is allowed to hand out (for the role picker UI). */
export function assignableRoles(viewer: Viewer): SocietyOfficerRole[] {
  return canAssignRole(viewer) ? [...SOCIETY_OFFICER_ROLES] : [];
}

/** Can this viewer post announcements? Any officer or the owner (or admin). */
export function canPostAnnouncement(viewer: Viewer): boolean {
  return canManageSociety(viewer);
}

/**
 * Can this viewer edit the society's own identity — category, bio, logo,
 * banner, links, recruiting? President and up (or admin), the same rank that
 * gates officer appointments. A moderator works the queues but never rewrites
 * the society itself; upsert_society_profile() enforces the identical rank in
 * mig 0120, so hiding the editor is not the only guard.
 */
export function canEditProfile(viewer: Viewer): boolean {
  return viewer.isAdmin || roleRank(viewer.role) >= ROLE_ADMIN_MIN_RANK;
}

/**
 * Can this viewer act on submitted content and access queues — pending posts,
 * join requests, removing an ordinary member? Any officer, including a
 * moderator. Mirrors can_manage_community() in mig 0119.
 */
export function canModerateContent(viewer: Viewer): boolean {
  return canManageSociety(viewer);
}
