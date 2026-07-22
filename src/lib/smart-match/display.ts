import type { PostMode } from "@/lib/smart-match/modes";
import type { DisplayRow, SmartMatchPost } from "@/lib/smart-match/types";

// ===========================================================================
// Privacy-safe display mapping. Everything here is the POST AUTHOR's own
// published content (course, skills, place, time) — safe to show. We never
// derive rows from sensitive profile fields (gender, exact location) and never
// surface the raw application state as a meta row.
// ===========================================================================

function capitalize(s: string | null): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function tagList(arr: string[], max = 4): string {
  return arr.slice(0, max).join(", ");
}

/** "3 on the team · needs 1 more" — the author plus tagged members are booked. */
export function teamSummary(post: SmartMatchPost): string {
  const booked = post.teamMemberCount + 1;
  const parts: string[] = [];
  if (post.teamMemberCount > 0) parts.push(`${booked} on the team`);
  if (post.peopleNeeded != null)
    parts.push(`needs ${post.peopleNeeded} more`);
  return parts.join(" · ");
}

/** Short absolute date/time for a timestamp (locale-independent-ish). */
export function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Mode-relevant, privacy-safe meta rows for a card. */
export function safeMatchingDisplay(mode: PostMode, post: SmartMatchPost): DisplayRow[] {
  const rows: DisplayRow[] = [];
  const push = (key: string, label: string) => {
    if (label) rows.push({ key, label });
  };

  switch (mode) {
    case "project_partner":
      if (post.courseCode) push("course", `Course: ${post.courseCode}`);
      push("team", teamSummary(post));
      if (post.skillsNeeded.length) push("skills", `Needs: ${tagList(post.skillsNeeded)}`);
      if (post.meetingPreference) push("meet", post.meetingPreference);
      break;
    case "fyp_teammate":
      if (post.interests.length) push("domain", `Domain: ${tagList(post.interests)}`);
      if (post.skillsNeeded.length) push("skills", `Needs: ${tagList(post.skillsNeeded)}`);
      if (post.preferredCommitment)
        push("commit", `${capitalize(post.preferredCommitment)} commitment`);
      if (post.degree) push("degree", post.degree);
      break;
    case "hackathon_team":
      if (post.hackathonName) push("hack", post.hackathonName);
      push("team", teamSummary(post));
      if (post.skillsNeeded.length) push("skills", `Needs: ${tagList(post.skillsNeeded)}`);
      if (post.rolesNeeded.length) push("roles", `Roles: ${tagList(post.rolesNeeded)}`);
      if (post.deadline) push("deadline", `By ${formatDate(post.deadline)}`);
      break;
    case "sports":
      if (post.place) push("place", post.place);
      if (post.scheduledAt) push("when", formatWhen(post.scheduledAt));
      if (post.peopleNeeded != null) push("people", `${post.peopleNeeded} needed`);
      if (post.skillLevel && post.skillLevel !== "any")
        push("level", `${capitalize(post.skillLevel)} level`);
      break;
    case "recruitment":
      if (post.societyName) push("society", post.societyName);
      else if (post.eventTitle) push("event", post.eventTitle);
      if (post.rolesNeeded.length) push("roles", `Roles: ${tagList(post.rolesNeeded)}`);
      if (post.skillsNeeded.length) push("skills", `Skills: ${tagList(post.skillsNeeded)}`);
      if (post.peopleNeeded != null) push("people", `${post.peopleNeeded} needed`);
      if (post.deadline) push("deadline", `Apply by ${formatDate(post.deadline)}`);
      break;
  }
  return rows;
}

/** Whether a hackathon/portfolio link is safe to render as an anchor. */
export function displayableUrl(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("https://") ? url : null;
}
