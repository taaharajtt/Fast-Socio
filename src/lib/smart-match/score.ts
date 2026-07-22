import type { PostMode } from "@/lib/smart-match/modes";
import type {
  MatchReason,
  SmartMatchPost,
  SmartMatchViewer,
} from "@/lib/smart-match/types";

// ===========================================================================
// Transparent, mode-aware post scoring.
//
// Pure + deterministic → fully unit-testable, and it leaks NOTHING a viewer
// shouldn't see: it consumes only the post fields get_smart_match_posts already
// returned (DB-gated) plus the VIEWER's own profile facts. Reasons are
// deliberately generic and safe — never gender, never an exact address, never
// the raw application state. Every score starts from a BASELINE (everyone here
// already passed the eligibility gate) and accrues capped, explainable points.
// ===========================================================================

const BASELINE = 30;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Case-insensitive intersection, order preserved from `a`. */
function overlap(a: string[], b: string[]): string[] {
  const bs = new Set(b.map(norm));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of a) {
    const n = norm(x);
    if (bs.has(n) && !seen.has(n)) {
      seen.add(n);
      out.push(x);
    }
  }
  return out;
}

/** Whole days from `from` to `to` (may be negative if `to` is in the past). */
function daysBetween(from: number, to: number): number {
  return (to - from) / 86_400_000;
}

/**
 * Score one post for one mode. Returns a 0–100 score and the ordered list of
 * privacy-safe "why this fits" chips that justify it. `now` is injected so
 * recency/deadline logic stays pure.
 */
export function scorePost(
  mode: PostMode,
  viewer: SmartMatchViewer,
  post: SmartMatchPost,
  now: number = Date.now()
): { score: number; reasons: MatchReason[] } {
  let raw = BASELINE;
  const reasons: MatchReason[] = [];

  // --- General factors (shared by every mode) ------------------------------
  const sameDept =
    !!viewer.department &&
    !!post.authorDepartment &&
    norm(viewer.department) === norm(post.authorDepartment);
  if (sameDept) {
    raw += 14;
    reasons.push({ key: "dept", label: "Same department" });
  }

  const targetSem = post.semester ?? post.authorSemester;
  if (viewer.semester != null && targetSem != null) {
    const gap = Math.abs(viewer.semester - targetSem);
    raw += Math.max(0, 12 - gap * 4);
    if (gap === 0) reasons.push({ key: "sem", label: "Same semester" });
    else if (gap === 1) reasons.push({ key: "sem", label: "Nearby semester" });
  }

  const sharedInterests = overlap(viewer.interests, post.interests);
  if (sharedInterests.length) {
    raw += Math.min(sharedInterests.length, 4) * 5;
    reasons.push({
      key: "interests",
      label:
        sharedInterests.length === 1
          ? `Shared interest: ${sharedInterests[0]}`
          : `${sharedInterests.length} shared interests`,
    });
  }

  const skillFit = overlap(viewer.skills, post.skillsNeeded);
  if (skillFit.length) {
    raw += Math.min(skillFit.length, 4) * 8;
    reasons.unshift({
      key: "skill",
      label:
        skillFit.length === 1
          ? `They need ${skillFit[0]} — you have it`
          : `You have ${skillFit.length} skills they need`,
    });
  }

  // People-needed urgency ("3 booked, need a 4th").
  if (post.peopleNeeded != null) {
    raw += Math.max(0, 6 - post.peopleNeeded);
    if (post.peopleNeeded <= 2)
      reasons.push({
        key: "urgency",
        label: post.peopleNeeded === 1 ? "Needs just 1 more" : "Needs 2 more",
      });
  }

  // Recency (newer surfaces a little higher).
  const ageDays = Math.max(0, daysBetween(new Date(post.createdAt).getTime(), now));
  raw += Math.max(0, 4 - ageDays * 0.5);

  // Deadline soon.
  if (post.deadline) {
    const d = daysBetween(now, new Date(post.deadline).getTime());
    if (d >= 0 && d <= 7) {
      raw += 8;
      reasons.push({ key: "deadline", label: "Deadline soon" });
    }
  }

  if (post.authorVerified) raw += 4;

  // Already applied → push down so fresh opportunities surface first.
  if (post.myApplicationStatus === "pending" || post.myApplicationStatus === "accepted")
    raw -= 20;

  // --- Mode-specific overlays ---------------------------------------------
  switch (mode) {
    case "project_partner": {
      if (skillFit.length) raw += Math.min(skillFit.length, 3) * 3;
      break;
    }
    case "fyp_teammate": {
      if (sharedInterests.length) {
        raw += Math.min(sharedInterests.length, 3) * 6;
        reasons.unshift({
          key: "domain",
          label: `Same FYP domain: ${sharedInterests[0]}`,
        });
      }
      if (
        viewer.graduationYear != null &&
        post.authorGraduationYear != null &&
        viewer.graduationYear === post.authorGraduationYear
      ) {
        raw += 8;
        reasons.push({ key: "grad", label: "Same graduating year" });
      }
      break;
    }
    case "hackathon_team": {
      const roleFill = overlap(viewer.skills, post.rolesNeeded);
      if (roleFill.length) {
        raw += Math.min(roleFill.length, 2) * 7;
        reasons.unshift({ key: "role", label: `Can fill: ${roleFill[0]}` });
      }
      break;
    }
    case "sports": {
      if (post.scheduledAt) {
        const d = daysBetween(now, new Date(post.scheduledAt).getTime());
        if (d >= 0 && d <= 1) {
          raw += 10;
          reasons.unshift({ key: "when", label: "Starting soon" });
        } else if (d > 1 && d <= 3) {
          raw += 5;
          reasons.push({ key: "when", label: "This week" });
        }
      }
      break;
    }
    case "recruitment": {
      const roleFill = overlap(viewer.skills, post.rolesNeeded);
      if (roleFill.length) {
        raw += Math.min(roleFill.length, 2) * 8;
        reasons.unshift({ key: "role", label: `Can help with ${roleFill[0]}` });
      }
      if (post.mutualCommunities > 0) {
        raw += 8;
        reasons.push({ key: "society", label: "A society you follow" });
      }
      break;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, reasons: reasons.slice(0, 4) };
}
