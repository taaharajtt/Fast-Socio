import {
  Heart,
  FolderKanban,
  GraduationCap,
  Code2,
  Dumbbell,
  Megaphone,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Discover modes — SOCIO is the founder's original date/social swipe deck and
// is ALWAYS the default. The five secondary modes are the focused, post-based
// campus-matching tools. `mode` is a shareable ?mode= query param.
//
// The DB CHECK constraints (mig 0105) mirror POST_MODES exactly — adding a mode
// is: add it here + to the two CHECK constraints. SOCIO is NOT a smart_match
// mode (it never touches smart_match_posts); it renders the swipe deck.
// ---------------------------------------------------------------------------
export const POST_MODES = [
  "project_partner",
  "fyp_teammate",
  "hackathon_team",
  "sports",
  "recruitment",
] as const;

export type PostMode = (typeof POST_MODES)[number];

export const DISCOVER_MODES = ["socio", ...POST_MODES] as const;

export type DiscoverMode = (typeof DISCOVER_MODES)[number];

export const DEFAULT_DISCOVER_MODE: DiscoverMode = "socio";

export function isDiscoverMode(x: unknown): x is DiscoverMode {
  return typeof x === "string" && (DISCOVER_MODES as readonly string[]).includes(x);
}

export function isPostMode(x: unknown): x is PostMode {
  return typeof x === "string" && (POST_MODES as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// Field specs. A mode's create/edit form is generated from these. `key` is the
// smart_match_posts column name so buildPostPayload maps straight onto the RPC
// jsonb. Required fields render first; `advanced` fields collapse below.
// 'mentions' (team members) and the recruitment society/event anchor are
// handled specially by the form component, not by a generic spec.
// ---------------------------------------------------------------------------
export type FieldType =
  | "text"
  | "textarea"
  | "tags"
  | "select"
  | "number"
  | "datetime"
  | "url"
  | "mentions";

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  options?: string[];
  required?: boolean;
  advanced?: boolean;
};

export type ModeMeta = {
  mode: PostMode;
  label: string;
  /** Three-second "what this mode is for". */
  tagline: string;
  icon: LucideIcon;
  /** Create-button copy, e.g. "Post a project request". */
  createLabel: string;
  /** Heading of the create form. */
  formTitle: string;
  /** CTA on a card, e.g. "Request to Join". */
  cta: string;
  /** Empty-browse copy. */
  emptyLabel: string;
  fields: FieldSpec[];
};

const DEGREE: FieldSpec = {
  key: "degree",
  label: "Degree",
  type: "text",
  placeholder: "e.g. BS Computer Science",
  advanced: true,
};
const SEMESTER: FieldSpec = {
  key: "semester",
  label: "Semester",
  type: "number",
  placeholder: "1–12",
  advanced: true,
};

export const MODE_META: Record<PostMode, ModeMeta> = {
  project_partner: {
    mode: "project_partner",
    label: "Project Partner",
    tagline: "Find the missing teammate for a course project or side build.",
    icon: FolderKanban,
    createLabel: "Post a project request",
    formTitle: "Find a project partner",
    cta: "Request to Join",
    emptyLabel: "No project requests yet. Post yours — someone's looking to build.",
    fields: [
      {
        key: "title",
        label: "What you need",
        type: "text",
        placeholder: "e.g. Need a 4th for our DB project",
        required: true,
      },
      {
        key: "course_code",
        label: "Course",
        type: "text",
        placeholder: "e.g. CS-302 Databases",
        required: true,
      },
      {
        key: "people_needed",
        label: "People still needed",
        type: "number",
        placeholder: "e.g. 1",
        help: "3 booked, need a 4th? Enter 1.",
        required: true,
      },
      {
        key: "team_members",
        label: "Current team members",
        type: "mentions",
        help: "Tag the people already on the team.",
      },
      {
        key: "skills_needed",
        label: "Skills you need",
        type: "tags",
        placeholder: "React, Supabase, Figma",
        required: true,
      },
      {
        key: "description",
        label: "What you're building",
        type: "textarea",
        placeholder: "A sentence about the project…",
      },
      DEGREE,
      SEMESTER,
      {
        key: "meeting_preference",
        label: "Meeting preference",
        type: "text",
        placeholder: "e.g. on-campus, evenings",
        advanced: true,
      },
      { key: "deadline", label: "Deadline", type: "datetime", advanced: true },
    ],
  },
  fyp_teammate: {
    mode: "fyp_teammate",
    label: "FYP Teammate",
    tagline: "Build your final-year-project team around a real idea.",
    icon: GraduationCap,
    createLabel: "Post an FYP teammate search",
    formTitle: "Find an FYP teammate",
    cta: "Request to Team Up",
    emptyLabel: "No FYP searches yet. Share your idea and find your team.",
    fields: [
      {
        key: "title",
        label: "FYP title / idea",
        type: "text",
        placeholder: "e.g. On-device sign-language translator",
        required: true,
      },
      {
        key: "description",
        label: "Idea vision",
        type: "textarea",
        placeholder: "Where you want to take it…",
        required: true,
      },
      {
        key: "interests",
        label: "Domains",
        type: "tags",
        placeholder: "NLP, IoT, fintech",
        required: true,
      },
      {
        key: "skills_needed",
        label: "Skills you need",
        type: "tags",
        placeholder: "backend, research, hardware",
        required: true,
      },
      {
        key: "preferred_commitment",
        label: "Commitment",
        type: "select",
        options: ["casual", "serious", "all-in"],
        advanced: true,
      },
      DEGREE,
      SEMESTER,
    ],
  },
  hackathon_team: {
    mode: "hackathon_team",
    label: "Hackathon Team",
    tagline: "Complete your team for a specific hackathon.",
    icon: Code2,
    createLabel: "Create a hackathon team request",
    formTitle: "Build a hackathon team",
    cta: "Request to Join",
    emptyLabel: "No hackathon teams recruiting yet. Start one.",
    fields: [
      {
        key: "title",
        label: "What you need",
        type: "text",
        placeholder: "e.g. Need a backend dev for NaSCon",
        required: true,
      },
      {
        key: "hackathon_name",
        label: "Hackathon",
        type: "text",
        placeholder: "e.g. NaSCon 2026",
        required: true,
      },
      {
        key: "people_needed",
        label: "People still needed",
        type: "number",
        placeholder: "e.g. 1",
        help: "3 booked, need a 4th? Enter 1.",
        required: true,
      },
      {
        key: "skills_needed",
        label: "Skills you need",
        type: "tags",
        placeholder: "Next.js, Python, ML",
        required: true,
      },
      {
        key: "team_members",
        label: "Current team members",
        type: "mentions",
        help: "Tag the people already on the team.",
      },
      {
        key: "roles_needed",
        label: "Roles needed",
        type: "tags",
        placeholder: "backend, designer, PM",
        advanced: true,
      },
      {
        key: "hackathon_url",
        label: "Hackathon link",
        type: "url",
        placeholder: "https://…",
        advanced: true,
      },
      {
        key: "description",
        label: "Details",
        type: "textarea",
        placeholder: "The idea, the vibe, anything useful…",
        advanced: true,
      },
      { key: "deadline", label: "Event / signup date", type: "datetime", advanced: true },
    ],
  },
  sports: {
    mode: "sports",
    label: "Sports",
    tagline: "Find people to play — or join a plan already on.",
    icon: Dumbbell,
    createLabel: "Create a sports plan",
    formTitle: "Start a sports plan",
    cta: "I'm In",
    emptyLabel: "No sports plans yet. Start one and fill your team.",
    fields: [
      {
        key: "title",
        label: "Sport / activity",
        type: "text",
        placeholder: "e.g. Football, Badminton, Gym",
        required: true,
      },
      {
        key: "place",
        label: "Where",
        type: "text",
        placeholder: "e.g. Main ground, Gym block",
        required: true,
      },
      {
        key: "scheduled_at",
        label: "When",
        type: "datetime",
        required: true,
      },
      {
        key: "people_needed",
        label: "People needed",
        type: "number",
        placeholder: "e.g. 4",
        advanced: true,
      },
      {
        key: "skill_level",
        label: "Skill level",
        type: "select",
        options: ["any", "beginner", "intermediate", "advanced"],
        advanced: true,
      },
      {
        key: "description",
        label: "Notes",
        type: "textarea",
        placeholder: "Anything to know…",
        advanced: true,
      },
    ],
  },
  recruitment: {
    mode: "recruitment",
    label: "Recruitment",
    tagline: "Society & event heads: find students to help run it.",
    icon: Megaphone,
    createLabel: "Post a recruitment call",
    formTitle: "Recruit contributors",
    cta: "I can contribute",
    emptyLabel: "No open recruitment calls right now.",
    fields: [
      {
        key: "title",
        label: "What you're recruiting for",
        type: "text",
        placeholder: "e.g. Volunteers for our tech gala",
        required: true,
      },
      {
        key: "roles_needed",
        label: "Roles needed",
        type: "tags",
        placeholder: "decor, logistics, photography",
        required: true,
      },
      {
        key: "description",
        label: "Details",
        type: "textarea",
        placeholder: "What contributors will do…",
      },
      {
        key: "skills_needed",
        label: "Helpful skills",
        type: "tags",
        placeholder: "design, social media, video",
        advanced: true,
      },
      {
        key: "people_needed",
        label: "People needed",
        type: "number",
        placeholder: "e.g. 6",
        advanced: true,
      },
      { key: "deadline", label: "Apply by", type: "datetime", advanced: true },
    ],
  },
};

/** All modes for the tab strip: SOCIO first, then the five post modes. */
export const DISCOVER_TABS: { mode: DiscoverMode; label: string; icon: LucideIcon }[] = [
  { mode: "socio", label: "SOCIO", icon: Heart },
  ...POST_MODES.map((m) => ({ mode: m, label: MODE_META[m].label, icon: MODE_META[m].icon })),
];

export function modeMeta(mode: PostMode): ModeMeta {
  return MODE_META[mode];
}

export function modeLabel(mode: DiscoverMode): string {
  return mode === "socio" ? "SOCIO" : MODE_META[mode].label;
}

/** Modes whose forms include the team-member mention picker. */
export function modeUsesTeamMembers(mode: PostMode): boolean {
  return mode === "project_partner" || mode === "hackathon_team";
}
