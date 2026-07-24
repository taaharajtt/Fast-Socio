import type { PostMode } from "@/lib/smart-match/modes";

/** Lifecycle of an application (interest / request-to-join) on a post. */
export type ApplicationStatus = "pending" | "accepted" | "declined" | "cancelled";

/** A privacy-safe "current team member" chip (Project / Hackathon). */
export type TeamMember = {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

/**
 * One opportunity as returned by get_smart_match_posts (camelCased). Carries the
 * post's own columns plus privacy-safe author fields the RPC already gated, the
 * tagged team members, and the viewer's own application status for this post.
 */
export type SmartMatchPost = {
  id: string;
  mode: PostMode;
  authorId: string;
  authorName: string | null;
  authorAvatar: string | null;
  authorUsername: string | null;
  authorDepartment: string | null;
  authorSemester: number | null;
  authorGraduationYear: number | null;
  authorVerified: boolean;
  authorAura: number;
  title: string;
  description: string | null;
  courseCode: string | null;
  degree: string | null;
  semester: number | null;
  peopleNeeded: number | null;
  skillsNeeded: string[];
  interests: string[];
  rolesNeeded: string[];
  place: string | null;
  scheduledAt: string | null;
  hackathonName: string | null;
  hackathonUrl: string | null;
  meetingPreference: string | null;
  preferredCommitment: string | null;
  skillLevel: string | null;
  /** Free text, contributor cards ("weekends, after 5pm"). */
  availability: string | null;
  /** https-only portfolio link on contributor cards. */
  portfolioUrl: string | null;
  deadline: string | null;
  /** When set and past, the post has aged out of the feed. */
  expiresAt: string | null;
  societyId: string | null;
  societyName: string | null;
  eventId: string | null;
  eventTitle: string | null;
  teamMembers: TeamMember[];
  teamMemberCount: number;
  mutualCommunities: number;
  applicationCount: number;
  myApplicationStatus: ApplicationStatus | null;
  myApplicationId: string | null;
  createdAt: string;
};

/** A privacy-safe "why this fits" chip. */
export type MatchReason = { key: string; label: string };

/** A post after mode-aware scoring. */
export type ScoredPost = SmartMatchPost & { score: number; reasons: MatchReason[] };

/** The viewer facts the scorer reads from their own profile. */
export type SmartMatchViewer = {
  department: string | null;
  semester: number | null;
  graduationYear: number | null;
  interests: string[];
  skills: string[];
};

/** A single privacy-safe meta row rendered on a card. */
export type DisplayRow = { key: string; label: string };

/** An incoming application on one of the viewer's own posts (author view). */
export type IncomingApplication = {
  id: string;
  postId: string;
  postTitle: string;
  status: ApplicationStatus;
  message: string | null;
  createdAt: string;
  applicantId: string;
  applicantName: string | null;
  applicantUsername: string | null;
  applicantAvatar: string | null;
};

/** One of the viewer's own posts (author view). */
export type PostStatus = "open" | "closed" | "expired" | "filled";

export type MyPost = {
  id: string;
  mode: PostMode;
  title: string;
  status: PostStatus;
  peopleNeeded: number | null;
  createdAt: string;
  pendingCount: number;
};

/** A society/event the viewer may recruit for (create-post anchor). */
export type RecruitAnchor = {
  kind: "society" | "event";
  id: string;
  name: string;
};

/** Everything the unified Discover feed needs on first render. */
export type DiscoverFeedData = {
  /** Render clock, stamped once on the server so scoring stays pure. */
  now: number;
  viewer: SmartMatchViewer;
  posts: SmartMatchPost[];
  myPosts: MyPost[];
  incoming: IncomingApplication[];
  recruitAnchors: RecruitAnchor[];
};
