/**
 * FAST NUCES schools (UAT-008). Individual degrees were collapsed into the three
 * schools; `profiles.department` now stores one of these full names. The picker
 * asks for your school, not your programme.
 */
export const DEPARTMENTS = [
  "Fast School of Computing",
  "Fast School of Engineering",
  "Fast School of Management",
] as const;

/** UI noun for `profiles.department` after the schools change (UAT-008). */
export const SCHOOL_FIELD_LABEL = "School";

/** Semesters 1–8 cover a standard four-year program. */
export const SEMESTERS = Array.from({ length: 8 }, (_, i) => i + 1);

/**
 * Sentinel `profiles.semester` value meaning "graduated" — pre-2023 batches
 * signing up with legacy @nu.edu.pk emails are alumni and have no current
 * semester. 13 sits above every real semester (DB check allows 1–13, mig 0098)
 * so distance-based Discover affinity degrades gracefully to zero.
 */
export const ALUMNI_SEMESTER = 13;

/** "6" → "6th Semester", ALUMNI_SEMESTER → "Alumni" (UISpec V3 wording). */
export function semesterLabel(n: number): string {
  if (n === ALUMNI_SEMESTER) return "Alumni";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]} Semester`;
}

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

/** Interest tags shown as selectable glass pills (pick a handful). */
export const INTERESTS = [
  "Coding",
  "Gaming",
  "Music",
  "Sports",
  "Gym",
  "Art",
  "Photography",
  "Reading",
  "Movies",
  "Anime",
  "Startups",
  "Hackathons",
  "Robotics",
  "AI/ML",
  "Design",
  "Volunteering",
  "Travel",
  "Food",
  "Debating",
  "Cricket",
  "Football",
  "Cooking",
] as const;

export const MIN_INTERESTS = 3;
export const MAX_INTERESTS = 8;
export const BIO_MAX = 300;

/**
 * Identity-vector options (Refactor Phase 2). These feed the Discover
 * compatibility engine and profile completeness. All are optional at the field
 * level; the wizard nudges but never blocks on them.
 */

/** Personality descriptors (multi-select). */
export const PERSONALITY_TRAITS = [
  "Introvert",
  "Extrovert",
  "Competitive",
  "Creative",
  "Calm",
  "Funny",
  "Leader",
  "Night Owl",
  "Morning Person",
  "Book Lover",
  "Gym Enthusiast",
  "Coffee Lover",
  "Adventurous",
  "Ambitious",
] as const;
export const MAX_PERSONALITY = 6;

/** Languages spoken (multi-select). */
export const LANGUAGES = [
  "English",
  "Urdu",
  "Punjabi",
  "Pashto",
  "Sindhi",
  "Balochi",
  "Saraiki",
  "Arabic",
] as const;
export const MAX_LANGUAGES = 5;

/** Hostel vs day-scholar status. */
export const HOSTEL_STATUS = [
  { value: "hostelite", label: "Hostelite" },
  { value: "day_scholar", label: "Day Scholar" },
] as const;

/** What the user is on the platform for — steers Discover. */
export const RELATIONSHIP_PREFS = [
  { value: "friends", label: "Friends" },
  { value: "dating", label: "Dating" },
  { value: "networking", label: "Networking" },
  { value: "study", label: "Study partners" },
] as const;

/** Plausible graduation years, derived at render time from the current year. */
export function graduationYears(span = 6): number[] {
  const start = new Date().getFullYear();
  return Array.from({ length: span }, (_, i) => start + i);
}
